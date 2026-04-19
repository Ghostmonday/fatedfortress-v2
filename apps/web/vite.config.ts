/**
 * apps/web/vite.config.ts — Vite config for the FatedFortress web SPA.
 *
 * Key settings:
 *   - library mode NOT used — SPA bundle, here.now deployable
 *   - resolve.alias: @fatedfortress/protocol → packages/protocol/src
 *   - build: target: esnext (modern browsers only for v1)
 *   - Worker built as a separate entry point (no chunk sharing with main)
 *
 * Dependencies pinned by hash in package.json.
 * CSP: set via meta tag in index.html, not via Vite plugin.
 */

// TODO: apps/web/vite.config.ts
