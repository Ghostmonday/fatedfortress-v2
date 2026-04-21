# FATEDFORTRESS

> **Real-time collaborative AI generation. A URL you drop into. Keys stay in your browser. Output ships live.**

[![CI](https://img.shields.io/github/actions/workflow/status/Ghostmonday/fatedfortress-v2/ci.yml?style=flat-square&branch=main)](https://github.com/Ghostmonday/fatedfortress-v2/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-black?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Y.js](https://img.shields.io/badge/Y.js-CRDT-black?style=flat-square&logo=yjs)](https://yjs.dev)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-black?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)

---

## What It Is

A room is a URL. Open it. Everyone in that room shares the same live output — prompts, generated text, images, audio — streaming in real-time via Y.js CRDTs. No server-side state. No account. No friction.

Your API keys never leave your browser. A sandboxed worker iframe calls providers directly. Other room members can contribute their own keys or pool rate limits. The host sets the billing mode — host-pays, personal keys, or mixed.

**Every generation produces a receipt.** A permanent, forkable artifact. Fork it into a new room with one click. The fork graph is the permanent record of how ideas evolved — and the viral loop that makes the network grow.

---

## The Feel

```
┌─────────────────────────────────────────────────────────────────┐
│  FATEDFORTRESS                        [/]  [?]  [ACCOUNT]     │
├────────────────────────┬────────────────────────────────────────┤
│                        │                                        │
│  LOBBY / ROOMS         │   OUTPUT / VIEWPORT                    │
│                        │                                        │
│  [Room cards grid]      │   [Live terminal stream]              │
│  [Category filters]     │   [Receipt gallery]                  │
│  [Create room CTA]      │   [Fork / Publish actions]           │
│                        │                                        │
├────────────────────────┼────────────────────────────────────────┤
│  COLLABORATION PANE    │   CONTROL PANE                         │
│                        │                                        │
│  Presence avatars       │   Model selector                       │
│  Tool/mode broadcast    │   System prompt                        │
│  Annotation pins        │   Prompt input                          │
│  Activity feed         │   Generate / Abort                     │
│  Proposal queue        │   Templates                             │
│  Spectator chat        │   Fuel gauge                           │
│                        │                                        │
└────────────────────────┴────────────────────────────────────────┘
```

**Sovereign Terminal** design language. Dark machined surfaces. Geist Mono. 1px borders. Hard offset shadows. Phosphor green and amber. Instant hover inversions. Zero rounded corners.

---

## Core Features

### Rooms Are URLs

No accounts. No install. Share a link, people join. The room persists in OPFS — reconnecting restores full state instantly even if the relay hasn't synced.

### Real-Time Multiplayer

Y.js CRDT sync via WebRTC through a Cloudflare Durable Object relay. Sub-50ms. At 80+ peers the relay shards automatically — up to 9 shards, ~720 peers per room. The relay holds zero persistent state.

### BYOK — Keys Never Leave Your Browser

A sandboxed Web Worker iframe calls providers directly. Keys are AES-256-GCM encrypted at rest. The worker's SHA-256 hash is recorded at build time and verifiable via SRI. **A FatedFortress server cannot receive your key.**

### Personal API Keys

Every room member can connect their own API key. Three billing modes:

- **Host pays** — host's key funds all generations (current model)
- **Personal keys** — each person pays their own bill
- **Mixed** — host key default, specific participants use their own

A visible billing panel shows each participant's key status and usage. Hosts can revoke personal key access instantly.

### Spectate Mode

Append `?spectate=1` to any room URL. No key needed. No signaling traffic burned. You receive CRDT sync updates but initiate zero peer connections. Watch a room live without costing the host anything.

### Generation Receipts & Fork Graph

Every generation is a signed, hash-chained receipt. Stored permanently on here.now. Fork any receipt into a new room — the full context (model, prompt, parameters, seed) becomes the starting point. The fork graph is the audit trail.

### Tool & Mode Presence

When someone is sculpting, animating, painting, or reviewing — their presence avatar broadcasts it live:

```
Alicia · Sculpting · HeroMesh_v3 · Brush: Clay
Bob · Animating · Frame 240/1200 · DopeSheet
Carol · Environment · Tile: E4-NEXUS · Painting
```

The room knows what everyone is doing without asking.

### Annotation Pins

Click anywhere in the viewport or on a receipt to drop an annotation pin. Label, author, color, resolved/unresolved state. Pins sync in real-time. Resolved pins fade. Click to expand. Review sessions become: drop pin → host fixes → resolve → done.

### Activity Feed

Live chronological log in the collaboration pane:

```
Alicia joined the room · 2m ago
Bob changed model to Flux · 1m ago
Host started generating · now
Pin "fix normals on arm" resolved by Carlos · 30s ago
New receipt added by Alicia · 10s ago
```

Scannable. One line per event. No walls of text.

### Proposal System

Non-hosts draft a prompt or system instruction and submit it as a proposal. The host sees a Proposals panel with Approve / Reject buttons. On Approve, the proposal becomes the live prompt. The whole team contributes — the host controls the direction.

### Generation Queue

When multiple people request generations, requests go into a visible queue. Everyone sees: who requested what, queued or generating, progress. The host reorders, cancels, or promotes. No chaos. No surprises.

### Scene Snapshots

Every 10 minutes (or on demand), the room captures a lightweight scene snapshot: current scene state, active participants, generation history, a short description. Team members browse a snapshot timeline and fork from any point. New joiners catch up by reading the history.

### Review & Approval Workflow

Host defines a checklist: "Modeling approved", "Animation review passed", "Lighting signed off." Each item assignable. On approve: name + timestamp. On reject: note required. Everything stays in the room, connected to receipts and scene history.

### Focus Mode

One click collapses the collaboration pane to a slim sidebar showing avatars + unread notifications. The output viewport expands. A floating toolbar stays accessible for pins, queue, and quick actions. Deep work without distraction.

### Shared Reference Board

A persistent board alongside the viewport for pinning reference images, text notes, URLs, sketches. Shared across all room members. Draggable. Editable by anyone. Style guides, character sheets, asset lists — visible without cluttering the workspace.

---

## Architecture

```
Browser (SPA)
│
├── App Shell (Vanilla TypeScript + DOM)
│     ├── Router          — hash-based, no framework
│     ├── Pages/          — room.ts, lobby.ts, me.ts, connect.ts
│     └── Components/     — ControlPane, OutputPane, PresenceBar,
│                          SpectatorChat, ReceiptCard, RoomCard,
│                          DemoKeyBanner, ConnectionBadge, Palette
│
├── Y.js CRDT Doc (FortressRoomDoc)
│     ├── meta            — room name, type, access, price, system prompt
│     ├── participants    — keyed by pubkey (CRDT-safe Y.Map)
│     ├── output         — character-level streaming Y.Text
│     ├── outputItems    — per-item metadata + receipts
│     ├── receiptIds     — hash-chained receipt IDs
│     ├── templates      — saved prompt templates
│     ├── presence       — peer cursor + online state
│     ├── spectatorChat  — spectator chat messages
│     ├── proposals      — pending prompt proposals
│     └── annotations    — viewport pins with resolved state
│
├── OPFS Cache           — room state snapshotted every 30s + on disconnect
│
├── Fortress Worker iframe (keys.fatedfortress.com)
│     ├── keystore.ts    — Argon2id + AES-256-GCM, Ed25519 signing
│     ├── budget.ts       — SubBudgetToken minting, per-participant quota
│     ├── generate.ts     — adapter orchestration + stream cache
│     └── adapters/       — openai · anthropic · google · minimax · groq · openrouter
│
└── Cloudflare Durable Object relay (stateless fan-out + sharding)
      ├── Parent DO       — room-scoped, peer registry, signaling
      └── Shard DOs       — overflow peers (up to 8 shards, ~720 capacity)
```

### Y.js Document Schema

```
FortressRoomDoc
  ├── meta:            Y.Map        — room metadata, type, access, billing mode
  ├── participants:     Y.Map        — keyed by pubkey
  ├── output:         Y.Text       — character-level streaming output
  ├── outputItems:     Y.Map        — per-item metadata, receipts, annotations
  ├── receiptIds:      Y.Array      — hash-chained receipt IDs
  ├── templates:       Y.Array      — saved prompt templates
  ├── presence:        Y.Map        — peer cursor, tool/mode, online state
  ├── spectatorChat:   Y.Array      — chat messages
  ├── proposals:       Y.Map        — pending proposals with approve/reject state
  └── annotations:     Y.Map        — viewport pins with resolved state
```

---

## Supported Providers

| Provider | Streaming | Models |
|---|---|---|
| OpenAI | Yes | GPT-4o, o3, o4-mini |
| Anthropic | Yes | Claude 4 Sonnet, Opus, Haiku |
| Google | Yes | Gemini 2.0 Flash, Pro |
| Minimax | Yes | abab, MX-T2V, SDXL |
| Groq | Yes | Llama 3.3, Mixtral |
| OpenRouter | Yes | 100+ models |

---

## Getting Started

### Run Locally

```bash
git clone https://github.com/Ghostmonday/fatedfortress-v2.git
cd fatedfortress-v2

# Install
npm install

# Start web dev server
npm run dev --workspace=apps/web
# → http://localhost:5173

# Deploy relay worker (Cloudflare Wrangler)
cd apps/relay && wrangler deploy
```

### Environment Variables

```bash
# apps/web/.env.development
VITE_RELAY_ORIGIN=ws://localhost:8787
VITE_WORKER_ORIGIN=http://localhost:8788
VITE_FF_ORIGIN=http://localhost:5173
VITE_HERENOW_CLIENT_ID=your_client_id
VITE_PLATFORM_WALLET=your_wallet_address

# apps/web/.env.production
VITE_RELAY_ORIGIN=wss://relay.fatedfortress.com
VITE_WORKER_ORIGIN=https://keys.fatedfortress.com
VITE_FF_ORIGIN=https://fatedfortress.com
```

---

## Security

| Property | Mechanism |
|---|---|
| Keys never leave the browser | Sandboxed worker iframe, CSP allow-list per provider |
| Keys never at rest in plaintext | Argon2id + AES-256-GCM, passphrase-derived wrapping key |
| Worker is verifiable | SHA-256 hash over minified bundle, SRI |
| Budget tokens are unforgeable | Ed25519 signature by host's non-extractable key |
| Receipts are tamper-evident | SHA-256 output hash + Ed25519 signature, hash-chained |
| Participant updates are CRDT-safe | `Y.Map` keyed by pubkey — no delete/insert races |
| No localStorage crashes in embeds | `safeStorage` wrapper probes once; falls back to in-memory |
| No base64 stack overflow on large docs | Chunked encoding/decoding in 8,192-byte blocks |

---

## Roadmap

| Version | Status |
|---|---|
| **v1.0** | ✅ P2P sync, presence, liquidity pool, fuel gauge, spectate mode |
| **v1.1** | ✅ Personal API keys, per-user billing modes |
| **v1.5** | ✅ Command palette with trie ghost text, OPFS caching, stream resume |
| **v2.0** | 🚧 Tool/mode presence broadcast, annotation pins, activity feed |
| **v2.1** | 📋 Proposal system, generation queue, scene snapshots |
| **v2.5** | 📋 Review checklists, approval workflows, focus mode |
| **v3** | 📋 here.now native integration, shared canvas overlays, reference board |

---

## Contributing

Each adapter, component, and protocol piece is self-contained. Inline comments in `ydoc.ts`, `budget.ts`, and `relay/src/index.ts` cover the full data model and protocol invariants.

```
apps/
  web/       — Vite SPA, vanilla TypeScript + DOM, no framework
  worker/    — Sandboxed iframe (keys.* origin)
  relay/     — Cloudflare Durable Object (stateless fan-out + sharding)
packages/
  protocol/  — Shared types, crypto helpers, budget token schemas
```

---

## The Thesis

Craigslist won because a person with something and a person who needed it could meet in ten seconds. No account. No algorithm. No fluff.

FatedFortress does the same for AI generation.

More rooms → more people joining → better output → more value → more rooms. At scale, this becomes unkillable — because every generation is a permanent URL, every URL is a shareable artifact, and every artifact is a potential fork that deposits a new user right back into the network.

**The output always goes somewhere real. The room always lives at a URL. The keys never leave your browser.**

---

<p align="center">
  <strong>FATEDFORTRESS</strong> · Built for the people who build the future.
</p>
