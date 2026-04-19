/**
 * state/vault.ts — Receipts vault backed by IndexedDB.
 *
 * Stores:
 *   - Receipt objects (full JSON)
 *   - Local Ed25519 identity (via identity.ts)
 *
 * Operations:
 *   - addReceipt(receipt: Receipt): void
 *   - listReceipts(): Receipt[]
 *   - searchReceipts(query: string): Receipt[]
 *   - exportSigned(): SignedBundle
 *
 * Capacity: designed for 10k+ receipts, < 50ms queries via indexed fields.
 * here.now sync: receipts optionally uploaded to here.now for permanence.
 */

// TODO: state/vault.ts
