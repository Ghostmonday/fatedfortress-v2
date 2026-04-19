/**
 * worker.ts — Fortress Worker main entry point.
 *
 * Loaded cross-origin at keys.fatedfortress.com as a sandboxed iframe (window context).
 * Communicates with the FF main frame exclusively via postMessage.
 */

import { FF_ORIGIN } from "@fatedfortress/protocol";
import { clearAllKeys } from "./keystore.js";
import { cleanupLiquidity } from "./liquidity.js";
import { inFlight } from "./generate.js";
import { dispatchMessage, send, sendError, type InboundMessage } from "./router.js";

function doCleanup(): void {
  for (const [, controller] of inFlight) {
    controller.abort();
  }
  inFlight.clear();
  clearAllKeys();
  cleanupLiquidity();
}

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.origin !== FF_ORIGIN) return;

  const msg = event.data as InboundMessage;
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "TERMINATE") {
    doCleanup();
    send({ type: "OK", requestId: "__terminate__", payload: { terminated: true } });
    return;
  }

  const requestId = (msg as Record<string, unknown>).requestId as string | undefined;
  if (!requestId || typeof requestId !== "string") return;

  try {
    await dispatchMessage(msg);
  } catch (err) {
    sendError(requestId, err);
  }
});

window.addEventListener("beforeunload", doCleanup);
window.addEventListener("unload", doCleanup);
window.addEventListener("pagehide", (e: PageTransitionEvent) => {
  if (!e.persisted) doCleanup();
});
