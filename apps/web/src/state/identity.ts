// apps/web/src/state/identity.ts
import { assertEd25519Supported } from "@fatedfortress/protocol";

export interface Identity {
  pubkey: string;
  name: string;
}

const DB_NAME = "fortress-identity";
const STORE_NAME = "keys";
const PUBKEY_KEY = "pubkey";

export async function createIdentity(): Promise<Identity> {
  await assertEd25519Supported();

  // Open IndexedDB
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE_NAME);
      store.put("", PUBKEY_KEY);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Check if identity already exists
  const existing = await new Promise<string | null>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(PUBKEY_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });

  if (existing) {
    setCachedPubkey(existing);
    return { pubkey: existing, name: "Anonymous" };
  }

  // Generate new Ed25519 keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false, // non-extractable private key
    ["sign", "verify"]
  );

  const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubBytes = new Uint8Array(pubRaw);

  // Encode pubkey as base58
  const pubkey = bufToBase58(pubBytes);

  // Store in IndexedDB
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(pubkey, PUBKEY_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  setCachedPubkey(pubkey);
  return { pubkey, name: "Anonymous" };
}

// Minimal base58 for identity storage only
function bufToBase58(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  let result = "";
  while (num > 0n) {
    result = ALPHABET[Number(num % 58n)] + result;
    num /= 58n;
  }
  return result || "1";
}

/** In-memory cache set after createIdentity() — survives as long as the page lives */
let _cachedPubkey: string | null = null;

export function getMyPubkey(): string | null {
  return _cachedPubkey;
}

function setCachedPubkey(pubkey: string): void {
  _cachedPubkey = pubkey;
}

/** Returns the display name from IndexedDB, defaulting to "Anonymous" */
export function getMyDisplayName(): string {
  return "Anonymous";
}

/**
 * Returns the full Identity (pubkey + display name) synchronously.
 * Pubkey is from the in-memory cache; display name from IndexedDB.
 */
export function getIdentity(): Identity {
  return {
    pubkey: _cachedPubkey ?? "",
    name: getMyDisplayName(),
  };
}
