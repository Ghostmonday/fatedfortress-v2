# FatedFortress

**Dev velocity is the product.**

This codebase ships a Task → Submission → Decision workflow app backed by Supabase, with a real-time multiplayer layer (Y.js CRDTs, WebRTC signaling via Cloudflare Durable Objects) and a browser-isolated keystore for AI provider credentials—all running as three independent apps, zero root workspace, no monorepo tax.

If you are evaluating this project: the architecture decisions below are why contributors stay. If you are joining the team: read section 1 and you can be productive in under 10 minutes.

---

## TL;DR — what makes this codebase ship

| Concern | Solution | Why it matters |
|---------|----------|----------------|
| Keys never leave the browser | Sandboxed `iframe` at `keys.*` origin, CSP `frame-src` locked | You can show users "your key is not on our server"—and mean it |
| Multi-provider AI streaming | Dynamic adapter loader in the keystore worker | Add GPT-5 tomorrow by dropping one file |
| Real-time collab without a server | Y.js CRDTs over WebRTC, Cloudflare Durable Object relay | Sub-50ms sync, auto-shards at 80 peers, relay holds zero persistent state |
| Auth / data / presence are separate | Supabase (auth + Postgres), Y.js (presence + output), relay (signaling) | Blast radius of a bug in one layer rarely reaches another |
| Three apps, three lockfiles | No root `npm workspaces` | `npm install` in one app never breaks another; CI is per-app |
| Vanilla TypeScript, no framework | DOM + client router in `main.ts` | No framework lock-in, no 40k-sloc runtime, Vite HMR is instant |
| CSP + SRI + crypto at rest | Argon2id + AES-256-GCM keystore, SRI hash on worker bundle | The threat model is enforced by the browser, not just policy |

---

## 1. Repo map

| Path | What it is | Start here? |
|------|------------|-------------|
| `apps/web/src/` | Active SPA: vanilla TypeScript, client router in `main.ts`. Routes: `/login`, `/create`, `/tasks`, `/submit/:id`, `/reviews`, `/project/:id`, `/profile`, `/settings` | **Yes.** |
| `apps/web/legacy/` | Archived room UI, Y.js table, command palette. **Excluded** from `apps/web` `tsconfig` `include`—treat as read-only reference. | Only if you are porting it. |
| `apps/worker/` | Sandboxed keystore + provider-calling iframe. Serves the `keys.*` origin embedded by `worker-bridge`. Vite IIFE build, `dist/` deployed separately. | When you add a provider or change key storage. |
| `apps/relay/` | Cloudflare Worker + Durable Objects. Y.js signaling, lobby registry, TURN credential endpoint, demo rate-limit enforcement. | When you change sync, presence broadcast, or TURN. |
| `packages/protocol/` | Shared TypeScript types, crypto helpers, budget token schemas. **Read before duplicating an ID or signature scheme.** | Always. |
| `packages/sentry-utils/` | PII scrubber for Sentry `beforeSend`. Single function, zero deps. | When you touch error reporting. |
| `ARCHITECTURE.md` | Full UI + screen spec. Room-era oriented—still accurate on design tokens and component trees, less so on the current `main.ts` router. | For component context. |

Each app (`web`, `worker`, `relay`) has its own `package-lock.json`. Run `npm install` per app you are building or typechecking. Minimum for local dev: `apps/web`. Full stack: all three.

---

## 2. Start coding (3 terminals, ~2 minutes to first page)

```bash
# Terminal 1 — web app (Supabase auth + all pages)
cd apps/web && npm install
# Add apps/web/.env.local:
#   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
#   VITE_SUPABASE_ANON_KEY=your_anon_key
npm run dev
# → http://localhost:5173  (port is fixed — stop whatever is on 5173, don't randomize)

# Terminal 2 — keystore worker  (only needed for AI generation flows)
cd apps/worker && npm install
npx vite --port 5174 --port

# Terminal 3 — relay  (only needed for Y.js / WebRTC / spectate flows)
cd apps/relay && npm install && npx wrangler dev
# Wrangler prints the WebSocket/HTTP base — usually http://localhost:8787
# Set VITE_RELAY_ORIGIN=ws://127.0.0.1:8787 and VITE_RELAY_HTTP_ORIGIN=http://127.0.0.1:8787
# in apps/web/.env.local
```

The three apps are completely decoupled. You can develop the web app with mocked or disabled relay/worker code paths using the Supabase-only fast path. Each terminal fails and restarts independently—crashing the relay never takes down the web app.

**First route to try:** [`/login`](http://localhost:5173/login) — `/` is not registered in the current router and will 404.

---

## 3. Build & typecheck

| Location | Command | When |
|----------|---------|------|
| `apps/web` | `npm run build` | Production bundle. `manualChunks` isolates `yjs` and `@fatedfortress/protocol`. |
| `apps/worker` | `npm run build` | IIFE output under `dist/`. WASM chunk isolated separately for hash-wasm. |
| `apps/relay` | `npx wrangler deploy` | Requires logged-in Wrangler and Cloudflare target. |
| `apps/relay` | `npm run typecheck` | `tsc --noEmit` against `@cloudflare/workers-types`. |
| Root | `npm run build --workspace=apps/web` (from repo root) | One-shot CI build when you add Playwright or other root tooling. |

`apps/web/vite.config.ts` injects `__RELAY_ORIGIN__`, `__WORKER_ORIGIN__`, `__FF_ORIGIN__`, and Sentry defines at **build time** via `define`. Change an env var → rebuild (Vite HMR handles most web edits without a rebuild).

---

## 4. Tests

- **`node --test`** on `apps/web/legacy/components/Palette/extractors.test.ts` — unit tests for command palette parsing, runs without a browser.
- **Playwright** (`playwright` in root `devDependencies`) — E2E. Write specs in `tests/` or alongside pages as you lock down flows.
- No framework test runner is wired in yet; `npm run test` at root is a placeholder. Add a script when the first test file lands.

---

## 5. Conventions — read before touching

### Protocol first
Shared types and crypto constants live in `packages/protocol/src/index.ts`. If you add a new ID brand, token schema, or error code, put it there. The file has a header distinguishing **MVP types** (Task, Submission, Decision) from **legacy room types**—do not mix them.

### CSP is the security contract
`apps/web/index.html` has a `Content-Security-Policy` meta tag. New AI provider endpoints need entries in `connect-src`; new iframe embeds need `frame-src`. Forgetting this silently fails in Chromium browsers—network requests disappear with no error thrown.

### Legacy vs active code
`apps/web/legacy/` is **excluded** from `tsconfig.json` `include`. TypeScript will not find or type-check it. New features go in `apps/web/src/`. If you are reviving a legacy component, move it first.

### Sentry is opt-in
`VITE_SENTRY_DSN_WEB` and `VITE_SENTRY_DSN_WORKER` are optional. Empty string → SDK self-disables silently. Both apps handle this correctly; you do not need to guard it manually.

### Keystore trust boundary is visible in the DOM
`index.html` renders a `<footer class="ff-keystore-boundary">` with an `aria-label` and a `<div id="ff-keystore-slot">` that mounts the worker iframe. Changing the keystore slot or boundary styling without understanding the SRI / CSP implications can break the security guarantee—check with the security spec before modifying.

---

## 6. Where each concern lives

| Concern | Primary file(s) |
|---------|----------------|
| Auth, session, route guards | `apps/web/src/auth/index.ts`, `apps/web/src/auth/middleware.ts` |
| SPA router + page mounting | `apps/web/src/main.ts` |
| Supabase client | `apps/web/src/auth/index.ts` (`getSupabase()` singleton) |
| Worker ↔ main thread bridge | `apps/web/src/net/worker-bridge.ts` |
| Y.js doc + WebRTC provider | `apps/web/src/net/signaling.ts` |
| Relay Durable Object logic | `apps/relay/src/index.ts` (header documents full protocol) |
| Key storage + encryption | `apps/worker/src/keystore.ts` |
| Generation dispatch + abort | `apps/worker/src/generate.ts`, `apps/worker/src/router.ts` |
| Provider adapters (OpenAI, Anthropic, etc.) | `apps/worker/src/adapters/*.ts` |
| Budget tokens + liquidity | `apps/worker/src/budget.ts`, `apps/worker/src/liquidity.ts` |
| Shared types + crypto helpers | `packages/protocol/src/index.ts` |
| Sentry PII scrub | `packages/sentry-utils/src/scrub.ts` |
| UI design tokens + component specs | `ARCHITECTURE.md` |

---

## 7. Adding a new provider (under 10 minutes)

1. Create `apps/worker/src/adapters/yourprovider.ts` — export a default object with `streamGenerate(params)` and `fetchModels()` matching the interface in `generate.ts`.
2. Add the static import + entry in the `ADAPTER_MAP` in `generate.ts`.
3. Add the provider's API endpoint to `connect-src` in `apps/web/index.html`.
4. Rebuild `apps/worker` and reload. No changes needed to `apps/web` or the relay.

---

## 8. The architectural bet

Craigslist won because two strangers could transact in ten seconds with no account. FatedFortress makes the same bet for AI generation workflows: a room is a URL, an output is a permanent receipt, a fork is a new room.

The browser-is-keystore architecture is what makes that trade acceptable to users. **The code reflects that bet**—read `apps/web/src/net/worker-bridge.ts` and `apps/worker/src/keystore.ts` to see exactly where your API key goes and why the team is confident it never touches a FatedFortress server.
