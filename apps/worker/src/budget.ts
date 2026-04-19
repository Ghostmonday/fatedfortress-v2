/**
 * budget.ts — Budget token verification and quota management in the Fortress Worker.
 *
 * This module runs INSIDE the worker, on the HOST side.
 * It maintains per-participant quota state for liquidity pool rooms.
 *
 * SECURITY CONTRACT (see SECURITY.md Claim 5):
 *   - Tokens are verified against hostPubkeyFromDoc (CRDT doc value), NEVER token.hostPubkey.
 *   - Nonce dedup is in-memory per session — prevents replay within the session window.
 *   - Quota is tracked here — never trusted from the participant side.
 *   - Budget state is ephemeral: cleared when host worker terminates.
 */

import {
  type BudgetToken,
  type SubBudgetToken,
  type PublicKeyBase58,
  verifyBudgetToken,
  generateTokenId,
  generateTokenNonce,
  encodeBudgetTokenSigningMessage,
  isBudgetToken,
  BUDGET_TOKEN_TTL_MS,
  SUB_BUDGET_TOKEN_TTL_MS,
  FFError,
  base64urlEncode,
  base64urlDecode,
  fromBase58,
} from "@fatedfortress/protocol";

const ONE_HOUR_MS = 3_600_000;

export interface QuotaState {
  /** Max tokens granted per participant per hour */
  quotaPerUser: number;
  /** Tokens consumed per participant pubkey in the current hour window */
  consumed: Map<PublicKeyBase58, number>;
  /** Unix ms — start of the current hour window */
  windowStart: number;
}

export interface MintTokenOptions {
  roomId: string;
  participantPubkey: PublicKeyBase58;
  hostPubkey: PublicKeyBase58;
  /** Ed25519 signing CryptoKey for the host — obtained from keystore, non-extractable */
  hostSigningKey: CryptoKey;
  tokensToGrant: number;
}

/** Per-room quota state */
const quotaState = new Map<string, QuotaState>();

/**
 * Global nonce dedup set.
 * All rooms share this set since a nonce is globally unique by construction
 * (16 random bytes = 2^128 collision space).
 */
const seenNonces = new Set<string>();

/**
 * Set of delegates whose sub-budget delegation has been revoked.
 * Keyed by delegatePubkey.
 */
const revokedDelegates = new Set<PublicKeyBase58>();

/**
 * Initializes or resets quota state for a room.
 * Called when the host configures the liquidity pool.
 */
export function initQuota(roomId: string, quotaPerUser: number): void {
  quotaState.set(roomId, {
    quotaPerUser,
    consumed: new Map(),
    windowStart: Date.now(),
  });
}

/**
 * Returns remaining quota for a participant in a room.
 * Automatically resets the window if more than 1 hour has elapsed.
 */
export function getRemainingQuota(
  roomId: string,
  participantPubkey: PublicKeyBase58
): number {
  const state = quotaState.get(roomId);
  if (!state) return 0;

  const now = Date.now();
  if (now - state.windowStart > ONE_HOUR_MS) {
    state.consumed.clear();
    state.windowStart = now;
  }

  const consumed = state.consumed.get(participantPubkey) ?? 0;
  return Math.max(0, state.quotaPerUser - consumed);
}

/**
 * Decrements quota for a participant after a successful generation.
 * Called AFTER token verification succeeds and generation completes.
 * Never called before — quota is not pre-reserved.
 */
export function consumeQuota(
  roomId: string,
  participantPubkey: PublicKeyBase58,
  tokensUsed: number
): void {
  const state = quotaState.get(roomId);
  if (!state) return;
  const current = state.consumed.get(participantPubkey) ?? 0;
  state.consumed.set(participantPubkey, current + tokensUsed);
}

/**
 * Mints a signed budget token for a participant.
 *
 * The token is Ed25519-signed by the host's identity key.
 * Returns null if the participant has exhausted their quota.
 */
export async function mintBudgetToken(
  options: MintTokenOptions
): Promise<BudgetToken | null> {
  const remaining = getRemainingQuota(options.roomId, options.participantPubkey);
  if (remaining <= 0) return null;

  const tokensToGrant = Math.min(options.tokensToGrant, remaining);
  const now = Date.now();
  const nonce = generateTokenNonce();

  const tokenData: Omit<BudgetToken, "id" | "signature"> = {
    roomId: options.roomId,
    participantPubkey: options.participantPubkey,
    hostPubkey: options.hostPubkey,
    tokensGranted: tokensToGrant,
    issuedAt: now,
    expiresAt: now + BUDGET_TOKEN_TTL_MS,
    nonce,
  };

  const message = encodeBudgetTokenSigningMessage(tokenData);

  const sigBuffer = await crypto.subtle.sign(
    "Ed25519",
    options.hostSigningKey, // non-extractable — we sign but never export
    message
  );

  const signature = base64urlEncode(new Uint8Array(sigBuffer)) as BudgetToken["signature"];
  const id = generateTokenId();

  return { ...tokenData, id, signature };
}

/**
 * Verifies a budget token before allowing a provider call.
 *
 * CRITICAL: hostPubkeyFromDoc comes from the Y.js CRDT doc,
 * never from the token itself. This prevents self-signed forgeries.
 *
 * On success: returns tokensGranted and marks nonce as seen.
 * On failure: throws FFError with specific error code.
 */
export async function verifyAndConsumeToken(
  rawToken: unknown,
  hostPubkeyFromDoc: PublicKeyBase58,
  roomId: string
): Promise<number> {
  if (!isBudgetToken(rawToken)) {
    throw new FFError("BudgetTokenForged", "Received object is not a valid BudgetToken shape");
  }

  const token = rawToken as BudgetToken;

  if (token.roomId !== roomId) {
    throw new FFError(
      "BudgetTokenForged",
      `Token roomId mismatch: expected ${roomId}, got ${token.roomId}`
    );
  }

  const result = await verifyBudgetToken(token, {
    hostPubkeyFromDoc,
    seenNonces, // passed by reference — mutated on success inside verifyBudgetToken
  });

  return result.tokensGranted;
}

export interface FuelGaugeState {
  roomId: string;
  participants: Array<{
    pubkey: PublicKeyBase58;
    fraction: number;
    consumed: number;
    quota: number;
  }>;
}

export function getFuelGaugeState(roomId: string): FuelGaugeState {
  const state = quotaState.get(roomId);
  if (!state) return { roomId, participants: [] };

  const participants: FuelGaugeState["participants"] = [];
  for (const [pubkey, consumed] of state.consumed) {
    participants.push({
      pubkey,
      consumed,
      quota: state.quotaPerUser,
      fraction: Math.max(0, 1 - consumed / state.quotaPerUser),
    });
  }

  return { roomId, participants };
}

/**
 * Cleanup function called by worker.ts on unload/pagehide.
 * budget.ts runs in an iframe (window) context — the "close" event
 * does not fire on iframe windows. worker.ts owns the lifecycle and
 * calls this explicitly before the iframe is removed from the DOM.
 */
export function teardownBudget(): void {
  quotaState.clear();
  seenNonces.clear();
  revokedDelegates.clear();
}

/**
 * Revokes a delegate's sub-budget authority.
 * After this call, the delegate cannot use their sub-budget token.
 */
export function revokeSubBudgetDelegation(delegatePubkey: PublicKeyBase58): void {
  revokedDelegates.add(delegatePubkey);
}

export function isDelegationRevoked(delegatePubkey: PublicKeyBase58): boolean {
  return revokedDelegates.has(delegatePubkey);
}

export function isSubBudgetToken(obj: any): obj is SubBudgetToken {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.roomId === "string" &&
    typeof obj.delegatePubkey === "string" &&
    typeof obj.hostPubkey === "string" &&
    typeof obj.tokensGranted === "number" &&
    typeof obj.issuedAt === "number" &&
    typeof obj.expiresAt === "number" &&
    typeof obj.nonce === "string" &&
    typeof obj.signature === "string"
  );
}

export async function mintSubBudgetTokenForRoom(
  hostSigningKey: CryptoKey,
  hostPubkey: PublicKeyBase58,
  delegatePubkey: PublicKeyBase58,
  roomId: RoomId,
  tokensToGrant: number
): Promise<SubBudgetToken> {
  const now = Date.now();
  const nonce = generateTokenNonce();
  const tokenData = {
    roomId,
    delegatePubkey,
    hostPubkey,
    tokensGranted: tokensToGrant,
    issuedAt: now,
    expiresAt: now + SUB_BUDGET_TOKEN_TTL_MS,
    nonce,
  };
  const sigBuffer = await crypto.subtle.sign(
    "Ed25519",
    hostSigningKey,
    encodeBudgetTokenSigningMessage(tokenData)
  );
  return {
    ...tokenData,
    id: generateTokenId(),
    signature: base64urlEncode(new Uint8Array(sigBuffer)) as SubBudgetToken["signature"],
  };
}

export async function verifyAndConsumeSubBudgetToken(
  rawToken: unknown,
  hostPubkeyFromDoc: PublicKeyBase58,
  roomId: string
): Promise<number> {
  if (!isSubBudgetToken(rawToken)) {
    throw new FFError("SubBudgetTokenForged", "Received object is not a valid SubBudgetToken shape");
  }

  const token = rawToken as SubBudgetToken;

  if (token.roomId !== roomId) {
    throw new FFError(
      "SubBudgetTokenForged",
      `Token roomId mismatch: expected ${roomId}, got ${token.roomId}`
    );
  }

  if (token.hostPubkey !== hostPubkeyFromDoc) {
    throw new FFError("SubBudgetTokenForged", "Host pubkey mismatch");
  }
  if (revokedDelegates.has(token.delegatePubkey)) {
    throw new FFError("SubBudgetTokenRevoked", "Delegation has been revoked by host");
  }
  if (seenNonces.has(token.nonce)) {
    throw new FFError("SubBudgetTokenReplayed", "Token nonce already seen");
  }
  if (Date.now() > token.expiresAt) {
    throw new FFError("SubBudgetTokenExpired", "Token has expired");
  }

  const message = encodeBudgetTokenSigningMessage({
    roomId: token.roomId,
    participantPubkey: token.delegatePubkey,
    hostPubkey: token.hostPubkey,
    tokensGranted: token.tokensGranted,
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    nonce: token.nonce,
  });

  const sigBytes = base64urlDecode(token.signature);

  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = fromBase58(token.hostPubkey);
  } catch {
    throw new FFError("SubBudgetTokenForged", "Invalid base58 encoding in host pubkey");
  }

  if (pubKeyBytes.length !== 32) throw new FFError("SubBudgetTokenForged", "Invalid public key length");

  const pubKey = await crypto.subtle.importKey(
    "raw",
    pubKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify("Ed25519", pubKey, sigBytes, message);
  if (!valid) {
    throw new FFError("SubBudgetTokenForged", "Signature verification failed");
  }

  seenNonces.add(token.nonce);
  return token.tokensGranted;
}
