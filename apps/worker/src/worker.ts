/**
 * worker.ts — Fortress Worker iframe entry (bundled as worker.html on keys.* origin).
 *
 * Message gate: ignore any postMessage whose origin is not FF_ORIGIN (the web app).
 * TERMINATE — full teardownSession() (keys + budget). TEARDOWN (router) — budget only; keys kept.
 *
 * Sentry (Zone 2 — Vault Worker) ⚠️ SECURITY CRITICAL:
 *   - tracesSampleRate: 0     — no performance traces from the vault.
 *   - sendDefaultPii: false   — prevents auto PII collection.
 *   - beforeSend: scrubEvent  — wipes stacktrace frame vars entirely and redacts
 *                               all known key patterns from breadcrumbs/request bodies.
 *                               This prevents Ed25519 private keys and OpenAI-style API
 *                               keys from being exfiltrated to Sentry's servers.
 *
 * DSN is injected at build time via vite.config.ts define (__SENTRY_DSN_WORKER__).
 * If the define is absent or empty, Sentry.init() is a no-op (SDK self-disables on empty DSN).
 */

// ── Sentry — must be first ────────────────────────────────────────────────────
import * as Sentry from "@sentry/browser";
import { scrubEvent } from "@fatedfortress/sentry-utils";

Sentry.init({
  dsn: typeof __SENTRY_DSN_WORKER__ !== "undefined" ? __SENTRY_DSN_WORKER__ : "",
  environment: "worker",
  tracesSampleRate: 0,        // zero traces — vault must not profile execution
  sendDefaultPii: false,      // belt-and-suspenders: no auto PII
  beforeSend: (event) => scrubEvent(event as any),
});

// ── App imports ───────────────────────────────────────────────────────────────

const FF_ORIGIN = typeof __FF_ORIGIN__ !== "undefined"
  ? __FF_ORIGIN__
  : "https://fatedfortress.com";

import { teardownKeystore } from "./keystore.js";
import { teardownLiquidity } from "./liquidity.js";
import { abortAllGenerations } from "./generate.js";
import { dispatchMessage, send, sendError, type InboundMessage } from "./router.js";

async function teardownSession(): Promise<void> {
  abortAllGenerations();
  teardownKeystore();
  await teardownLiquidity();
}

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.origin !== FF_ORIGIN) return;

  const msg = event.data as InboundMessage;
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "TERMINATE") {
    await teardownSession();
    send({ type: "OK", requestId: "__terminate__", payload: { terminated: true } });
    return;
  }

  const requestId = (msg as any).requestId as string | undefined;
  if (!requestId || typeof requestId !== "string") return;

  try {
    await dispatchMessage(msg as any);
  } catch (err) {
    Sentry.captureException(err, { tags: { requestType: msg.type } });
    sendError(requestId, err);
  }
});

window.addEventListener("beforeunload", () => void teardownSession());
window.addEventListener("unload", () => void teardownSession());
window.addEventListener("pagehide", (e: PageTransitionEvent) => {
  if (!e.persisted) void teardownSession();
});
