/**
 * packages/protocol/src/index.ts — Shared types for FatedFortress.
 *
 * Re-exported from: @fatedfortress/protocol
 * Consumed by: apps/web, apps/worker, apps/relay
 *
 * Types:
 *   RoomId, ReceiptId, RoomCategory, RoomAccess
 *   PaletteIntent, PaletteContext, ParseResult
 *   BudgetToken, PaymentIntent
 *   PublicKeyBase58
 *   ProviderId
 *
 * Crypto helpers:
 *   FFError (error class with code + message)
 *   hashOutput(output: string): Promise<string>
 *   base64urlEncode / base64urlDecode
 *   toBase58 / fromBase58
 *   verifyBudgetToken / generateTokenId / generateTokenNonce
 *   encodeBudgetTokenSigningMessage / isBudgetToken
 *   assertEd25519Supported
 *   BUDGET_TOKEN_TTL_MS
 *
 * Constants:
 *   FF_ORIGIN, PROVIDER_ALLOWLIST
 */

// ---------------------------------------------------------------------------
// Brands & IDs
// ---------------------------------------------------------------------------

export type RoomId = string & { readonly __brand: "RoomId" };
export type ReceiptId = string & { readonly __brand: "ReceiptId" };
export type PublicKeyBase58 = string & { readonly __brand: "PublicKeyBase58" };
export type ReceiptHash = string & { readonly __brand: "ReceiptHash" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FF_ORIGIN = "http://localhost:5173"; // Default for dev, overridden in prod
export const WORKER_ORIGIN = "http://localhost:5174"; // Stub worker origin for dev

export const PROVIDER_ALLOWLIST = [
  "openai",
  "anthropic",
  "google",
  "minimax",
  "groq",
  "openrouter",
] as const;

export type ProviderId = (typeof PROVIDER_ALLOWLIST)[number];

export const BUDGET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour
export const SUB_BUDGET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour (same as budget token)

// ---------------------------------------------------------------------------
// Room & Generation Types
// ---------------------------------------------------------------------------

export type RoomCategory =
  | "code"
  | "animation"
  | "audio"
  | "games"
  | "writing"
  | "general";

export type RoomAccess = "free" | "paid";

export type RoomRole =
  | "prompt_engineer"
  | "sound_engineer"
  | "animator"
  | "video_editor"
  | "writer"
  | "critic";

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

// ---------------------------------------------------------------------------
// Palette & Intents
// ---------------------------------------------------------------------------

export type PaletteIntent =
  | { type: "create_room"; category: RoomCategory; access: RoomAccess; price: number | null; name: string | null }
  | { type: "join_room"; roomId: RoomId }
  | { type: "spectate_room"; roomId: RoomId | null }
  | { type: "fork_receipt"; receiptId: ReceiptId | null }
  | { type: "switch_model"; model: ModelRef | null; rawModelName: string }
  | { type: "publish"; target: "room" | "receipt" }
  | { type: "pay"; amount: number; roomId: RoomId | null }
  | { type: "invite"; peer: string | null }
  | { type: "search"; query: string; category: RoomCategory | null }
  | { type: "link_herenow" }
  | { type: "set_system_prompt"; prompt: string }
  | { type: "set_quota"; tokensPerUser: number }
  | { type: "open_connect"; provider: ProviderId | null }
  | { type: "open_me" }
  | { type: "help"; command: string | null }
  | { type: "claim_role"; role: RoomRole }
  | { type: "list_roles" }
  | { type: "upgrade_room"; price: number | null }
  | { type: "delegate_sub_budget"; peer: string | null; tokensPerUser: number };

export interface PaletteContext {
  currentPage: "table" | "room" | "connect" | "me";
  currentRoomId: RoomId | null;
  currentRoomAccess: RoomAccess | null;
  focusedReceiptId: ReceiptId | null;
  currentModel: ModelRef | null;
  keyValidated: boolean;
  fuelLevel: number | null;
  herenowLinked: boolean;
  isSpectator: boolean;
  availableRoles: RoomRole[];
}

export type ParseResult =
  | { kind: "resolved"; intent: PaletteIntent; confidence: number; label: string }
  | { kind: "candidates"; candidates: Array<{ intent: PaletteIntent; confidence: number; label: string }> }
  | { kind: "error"; hint: string };

// ---------------------------------------------------------------------------
// Budget & Liquidity
// ---------------------------------------------------------------------------

export interface BudgetToken {
  id: string;
  roomId: RoomId;
  participantPubkey: PublicKeyBase58;
  hostPubkey: PublicKeyBase58;
  tokensGranted: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  signature: string & { readonly __brand: "Signature" };
}

export interface SubBudgetToken {
  id: string;
  roomId: RoomId;
  delegatePubkey: PublicKeyBase58;
  hostPubkey: PublicKeyBase58;
  tokensGranted: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  signature: string & { readonly __brand: "Signature" };
}

export interface PaymentIntent {
  amount: number;
  currency: "USDC";
  destination: PublicKeyBase58;
  platformAddress: PublicKeyBase58;
  memo: string;
  split: {
    hostAmount: number;
    platformAmount: number;
    hostBasisPoints: 8000;        // 8000/10000 = 80% to host
    platformBasisPoints: 2000;    // 2000/10000 = 20% to platform
  };
  type: "entry_fee" | "tip" | "boost";
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

export class FFError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "FFError";
  }
}

// ---------------------------------------------------------------------------
// Crypto Helpers (Stubs/Implementations)
// ---------------------------------------------------------------------------

export async function hashOutput(output: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(output);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64urlEncode(data: Uint8Array): string {
  let base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Base58 Encoding Utilities ───────────────────────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function toBase58(bytes: Uint8Array): string {
  let leadingOnes = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingOnes++;
  }
  let num = bytes.reduce((acc, byte) => acc * 256n + BigInt(byte), 0n);
  let encoded = "";
  while (num > 0n) {
    encoded = BASE58_ALPHABET[Number(num % 58n)] + encoded;
    num /= 58n;
  }
  return "1".repeat(leadingOnes) + encoded;
}

export function fromBase58(encoded: string): Uint8Array {
  let num = 0n;
  for (const char of encoded) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Invalid Base58 character: ${char}`);
    num = num * 58n + BigInt(value);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  let leadingOnes = 0;
  while (encoded[leadingOnes] === "1") leadingOnes++;
  const result = new Uint8Array(leadingOnes + bytes.length);
  result.set(bytes, leadingOnes);
  return result;
}

export function generateTokenId(): string {
  // 64 bits of entropy via Web Crypto API (collision-resistant)
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return "tkn_" + hex; // 16 hex chars = 64 bits of entropy, collision-resistant
}

export function generateTokenNonce(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

export function isBudgetToken(obj: any): obj is BudgetToken {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.roomId === "string" &&
    typeof obj.participantPubkey === "string" &&
    typeof obj.hostPubkey === "string" &&
    typeof obj.tokensGranted === "number" &&
    typeof obj.issuedAt === "number" &&
    typeof obj.expiresAt === "number" &&
    typeof obj.nonce === "string" &&
    typeof obj.signature === "string"
  );
}

export function encodeBudgetTokenSigningMessage(token: Omit<BudgetToken, "id" | "signature">): Uint8Array {
  const s = JSON.stringify(token);
  return new TextEncoder().encode(s);
}

export async function assertEd25519Supported(): Promise<void> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  } catch {
    throw new FFError(
      "Ed25519NotSupported",
      "Your browser does not support Ed25519. Use a current version of Chrome, Firefox, or Safari."
    );
  }
}

export async function verifyBudgetToken(
  token: BudgetToken,
  options: { hostPubkeyFromDoc: PublicKeyBase58; seenNonces: Set<string> }
): Promise<{ tokensGranted: number }> {
  // 1. Structural Validation
  if (token.hostPubkey !== options.hostPubkeyFromDoc) {
    throw new FFError("BudgetTokenForged", "Host pubkey mismatch");
  }
  if (options.seenNonces.has(token.nonce)) {
    throw new FFError("BudgetTokenReplayed", "Token nonce already seen");
  }
  if (Date.now() > token.expiresAt) {
    throw new FFError("BudgetTokenExpired", "Token has expired");
  }

  // 2. Cryptographic Verification
  const message = encodeBudgetTokenSigningMessage({
    roomId: token.roomId,
    participantPubkey: token.participantPubkey,
    hostPubkey: token.hostPubkey,
    tokensGranted: token.tokensGranted,
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    nonce: token.nonce,
  });

  const sigBytes = base64urlDecode(token.signature);

  // Wrap decoding — fromBase58 throws a plain Error on invalid input which must not
  // escape as a potentially revealing exception; re-throw as a typed FFError.
  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = fromBase58(token.hostPubkey);
  } catch {
    throw new FFError("BudgetTokenForged", "Invalid base58 encoding in host pubkey");
  }

  // Ed25519 public keys are always 32 bytes
  if (pubKeyBytes.length !== 32) throw new FFError("BudgetTokenForged", "Invalid public key length");

  const pubKey = await crypto.subtle.importKey(
    "raw",
    pubKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify("Ed25519", pubKey, sigBytes, message);
  if (!valid) {
    throw new FFError("BudgetTokenForged", "Signature verification failed");
  }

  // 3. Prevent Replay
  // TODO [Phase 1 follow-up]: seenNonces must survive restarts to prevent replay attacks.
  // Persist consumed nonces keyed by (roomId + hostPubkey) in IndexedDB (client)
  // or Durable Object storage (worker). The current in-memory Set resets on reload.
  options.seenNonces.add(token.nonce);
  return { tokensGranted: token.tokensGranted };
}
