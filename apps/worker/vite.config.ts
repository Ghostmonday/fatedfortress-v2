/**
 * apps/worker/vite.config.ts — Vite config for the Fortress Worker.
 *
 * Key settings:
 *   - Build as IIFE (immediately invoked function expression)
 *     — worker runs in a sandboxed iframe, not via importScripts
 *   - Manual chunks: isolate hash-wasm in its own chunk (required for WASM)
 *   - No minification of the entry chunk (preserves SRI hash stability)
 *   - Output: dist/ with index.html + assets/
 *
 * The hash-wasm import is pinned to a specific version+hash in package.json.
 * Vite's rollupOptions.input determines chunk splitting for reproducibility.
 */

// TODO: apps/worker/vite.config.ts
