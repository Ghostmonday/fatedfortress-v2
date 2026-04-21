/**
 * apps/web/src/main.ts — SPA shell: URL → page mount, palette, identity bootstrap.
 *
 * Routing: `/spectate/:id` is handled before the generic `/(\w+)/` matcher so spectate
 * never falls through to `table`. Palette commands that need room state use
 * `getActiveRoomDocIfSet()` only when `_currentPage === "room"`.
 *
 * Intents: `palette:select` → `dispatchIntent`; room-specific handlers listen on
 * `palette:intent` from pages (e.g. room.ts).
 *
 * Sentry (Zone 1 — SPA):
 *   Initialised at the very top of the module so any error during bootstrap is captured.
 *   scrubEvent is the shared beforeSend guard from @fatedfortress/sentry-utils.
 *   sendDefaultPii: false — belt-and-suspenders to prevent auto PII collection.
 */

// ── Sentry — must be first ────────────────────────────────────────────────────
import * as Sentry from "@sentry/browser";
import { scrubEvent } from "@fatedfortress/sentry-utils";

Sentry.init({
  dsn: typeof __SENTRY_DSN_WEB__ !== "undefined" ? __SENTRY_DSN_WEB__ : "",
  environment: import.meta.env.MODE,
  // release: set in CI via VITE_APP_VERSION env var
  release: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: (event) => scrubEvent(event as any),
});

// ── App imports ───────────────────────────────────────────────────────────────
import { openPalette, buildPaletteContext } from "./components/Palette/index.js";
import { showWelcomeModal } from "./components/WelcomeModal.js";
import { hasSeenWelcome } from "./util/storage.js";
import { createIdentity } from "./state/identity.js";
import { handleUpgradeRoom } from "./handlers/upgrade.js";
import { getActiveRoomDocIfSet } from "./state/ydoc.js";
import type { PaletteIntent } from "@fatedfortress/protocol";

const APP_ROOT = "#app";

function getContainer(): HTMLElement {
  let app = document.querySelector<HTMLElement>(APP_ROOT);
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
  app.innerHTML = "";
  return app;
}

// ── Page tracking ─────────────────────────────────────────────────────────────

type PageName = "table" | "room" | "connect" | "me";
let _currentPage: PageName = "table";

function setCurrentPage(page: PageName): void {
  _currentPage = page;
}

function getCurrentPage(): PageName {
  return _currentPage;
}

// ── Page mount functions ──────────────────────────────────────────────────────

type PageCleanup = (() => void) | void;
const router: Record<string, () => Promise<PageCleanup>> = {
  table: async () => {
    setCurrentPage("table");
    const { mountTable } = await import("./pages/table.js");
    return mountTable(getContainer());
  },
  room: async () => {
    setCurrentPage("room");
    const { mountRoom } = await import("./pages/room.js");
    const pathParts = window.location.pathname.split("/");
    const roomId = pathParts[2] || "rm_default";
    return mountRoom(roomId, getContainer());
  },
  connect: async () => {
    setCurrentPage("connect");
    const { mountConnect } = await import("./pages/connect.js");
    return mountConnect(getContainer());
  },
  me: async () => {
    setCurrentPage("me");
    const { mountMe } = await import("./pages/me.js");
    return mountMe(getContainer());
  },
};

let currentUnmount: (() => void) | null = null;

async function route(path: string) {
  currentUnmount?.();
  currentUnmount = null;

  const spectateMatch = path.match(/^\/spectate\/(.+)/);
  if (spectateMatch) {
    setCurrentPage("room");
    const { mountRoom } = await import("./pages/room.js");
    currentUnmount = await mountRoom(spectateMatch[1], getContainer(), { spectate: true }) ?? null;
    return;
  }

  const roomMatch = path.match(/^\/room\/(.+)/);
  if (roomMatch) {
    window.history.replaceState({}, "", `/room/${roomMatch[1]}`);
  }

  const [, page] = path.match(/^\/(\w+)/) ?? [];
  if (path === "/" || !page || !(page in router)) {
    window.history.replaceState({}, "", "/table");
    currentUnmount = null;
    return;
  }

  try {
    const unmount = await router[page as keyof typeof router]();
    currentUnmount = typeof unmount === "function" ? unmount : null;
  } catch (err) {
    Sentry.captureException(err, { tags: { page } });
    console.error(`[main] Failed to mount page "${page}":`, err);
  }
}

// ── Intent dispatcher ─────────────────────────────────────────────────────────

async function dispatchIntent(intent: PaletteIntent): Promise<void> {
  switch (intent.type) {
    case "upgrade_room": {
      const doc = getActiveRoomDocIfSet();
      if (doc) {
        await handleUpgradeRoom(intent, doc);
      } else {
        console.warn("[dispatch] upgrade_room but no active room doc");
      }
      break;
    }
    default:
      window.dispatchEvent(new CustomEvent("palette:intent", { detail: { intent } }));
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  try {
    await createIdentity();
  } catch (err) {
    console.warn("[main] Could not create identity:", err);
  }

  if (!hasSeenWelcome()) {
    showWelcomeModal();
  }

  await route(window.location.pathname);

  window.addEventListener("popstate", () => route(window.location.pathname));

  window.addEventListener("palette:select", async (e: Event) => {
    const { intent } = (e as CustomEvent).detail as { intent: PaletteIntent };
    await dispatchIntent(intent);
  });
}

// ── Palette shortcut ──────────────────────────────────────────────────────────

function openPaletteWithContext(): void {
  const page = getCurrentPage();
  const roomDoc = page === "room" ? getActiveRoomDocIfSet() ?? null : null;
  openPalette(
    buildPaletteContext({
      currentPage: page,
      roomDoc,
      focusedReceiptId: null,
      currentModel: null,
      keyValidated: false,
      fuelLevel: null,
      herenowLinked: false,
    })
  );
}

window.addEventListener("keydown", (e) => {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    (e.target instanceof HTMLElement && e.target.isContentEditable)
  ) return;

  if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    openPaletteWithContext();
  }
});

// ── Service worker (production only) ─────────────────────────────────────────

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(console.error);
}

init();
