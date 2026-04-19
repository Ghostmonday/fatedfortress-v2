/**
 * net/worker-bridge.ts — Main thread ↔ Fortress Worker communication.
 *
 * Responsibilities:
 *   - Create and mount the sandboxed Fortress Worker iframe
 *   - Expose typed postMessage API for STORE_KEY, GENERATE, etc.
 *   - Route inbound messages (CHUNK, DONE, ERROR, OK, FUEL) to callers
 *   - Handle worker crashes / TERMINATE and surface errors to UI
 *
 * Security:
 *   - Worker loaded from keys.fatedfortress.com (separate origin)
 *   - Worker origin validated on every inbound message
 *   - No key material ever sent to main thread
 *
 * The WorkerBridge class is a singleton — one worker per tab.
 */

// TODO: net/worker-bridge.ts
