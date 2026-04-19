/**
 * apps/web/vite.config.ts — Vite config for the FatedFortress web SPA.
 *
 * Key settings:
 *   - library mode NOT used — SPA bundle, here.now deployable
 *   - resolve.alias: @fatedfortress/protocol → packages/protocol/src
 *   - build: target: esnext (modern browsers only for v1)
 *   - Worker built as a separate entry point (no chunk sharing with main)
 *   - define: inject FF_ORIGIN and WORKER_ORIGIN from env
 *
 * Dependencies pinned by hash in package.json.
 * CSP: set via meta tag in index.html, not via Vite plugin.
 */

import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __FF_ORIGIN__: JSON.stringify(process.env.VITE_FF_ORIGIN ?? "https://fatedfortress.com"),
    __WORKER_ORIGIN__: JSON.stringify(process.env.VITE_WORKER_ORIGIN ?? "https://keys.fatedfortress.com"),
    __RELAY_ORIGIN__: JSON.stringify(process.env.VITE_RELAY_ORIGIN ?? "wss://relay.fatedfortress.com"),
  },
});
