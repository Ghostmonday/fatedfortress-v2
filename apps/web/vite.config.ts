/**
 * apps/web/vite.config.ts — Vite config for the FatedFortress web SPA.
 *
 * Phase 5 L4 — VITE_RELAY_ORIGIN / VITE_WORKER_ORIGIN / VITE_FF_ORIGIN via loadEnv + define.
 * Phase 5 L3 — Meta CSP uses script-src 'self'.
 * Protocol alias; manualChunks for yjs + protocol.
 *
 * New defines (TURN + Sentry):
 *   __RELAY_HTTP_ORIGIN__  — HTTP base URL for /turn-credentials fetch (no trailing slash)
 *   __SENTRY_DSN_WEB__     — Sentry DSN for Zone 1 (SPA), set via VITE_SENTRY_DSN_WEB env var
 *   __APP_VERSION__        — release tag for Sentry, set via VITE_APP_VERSION env var
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const relayOrigin     = env.VITE_RELAY_ORIGIN     ?? "wss://relay.fatedfortress.com";
  const relayHttpOrigin = env.VITE_RELAY_HTTP_ORIGIN ?? "https://relay.fatedfortress.com";
  const workerOrigin    = env.VITE_WORKER_ORIGIN     ?? "https://keys.fatedfortress.com";
  const ffOrigin        = env.VITE_FF_ORIGIN         ?? "https://fatedfortress.com";
  const sentryDsnWeb    = env.VITE_SENTRY_DSN_WEB    ?? "";
  const appVersion      = env.VITE_APP_VERSION       ?? "";

  return {
    resolve: {
      alias: {
        "@fatedfortress/protocol": path.resolve(
          __dirname,
          "../../packages/protocol/src/index.ts"
        ),
        "@fatedfortress/sentry-utils": path.resolve(
          __dirname,
          "../../packages/sentry-utils/src/scrub.ts"
        ),
      },
    },
    define: {
      __FF_ORIGIN__:          JSON.stringify(ffOrigin),
      __WORKER_ORIGIN__:      JSON.stringify(workerOrigin),
      __RELAY_ORIGIN__:       JSON.stringify(relayOrigin),
      __RELAY_HTTP_ORIGIN__:  JSON.stringify(relayHttpOrigin),
      __SENTRY_DSN_WEB__:     JSON.stringify(sentryDsnWeb),
      __APP_VERSION__:        JSON.stringify(appVersion),
    },
    build: {
      target: "es2022",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes(`${path.sep}yjs${path.sep}`) || id.includes("/yjs/")) {
              return "yjs";
            }
            if (id.includes("packages/protocol") || id.includes("@fatedfortress/protocol")) {
              return "protocol";
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
