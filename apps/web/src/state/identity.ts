/**
 * state/identity.ts — Local Ed25519 identity for FatedFortress.
 *
 * Generated once per browser, stored in IndexedDB.
 * Private key is non-extractable (CryptoKey, extractable: false).
 * Public key (base58) is the user's room identity and receipt author field.
 *
 * Used for:
 *   - Signing receipts
 *   - Identifying participant in CRDT presence map
 *   - Verifying budget tokens (host side)
 *
 * Key never leaves the browser. Loss of IndexedDB = new identity (receipts orphaned).
 */

// TODO: state/identity.ts
