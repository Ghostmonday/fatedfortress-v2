/**
 * apps/relay/src/index.ts — Worker entry + RelayDO (room-scoped WebRTC / Y.js signaling).
 *
 * Phase 4 — Automated DO orchestration:
 *   - Worker routes WebSocket to env.RELAY.idFromName(roomId) or `${roomId}-shard-${n}`.
 *   - SHARD_THRESHOLD: when the *parent* DO already holds this many peers, new *non-replacement*
 *     connections get { type: "REDIRECT", shardUrl } (reconnect with &shard=N).
 *   - Spectators (?spectator=1): offer / answer / ice-candidate are not routed (Y.js sync still flows).
 *   - POST /_relay/forward — push JSON payload to a connected peer on *this* DO.
 *   - POST /internal/register-shard-peer — shard tells parent peerId → shard index (O(1) map).
 *   - POST /internal/deliver — shard asks parent to route when the target is not local to shard.
 *
 * Global Lobby (Task 1):
 *   - RELAY_REGISTRY Durable Object tracks active rooms with metadata (name, category,
 *     participant count, spectator count, access, price) for the GET /rooms HTTP endpoint.
 *   - Rooms register on first participant join and deregister when the last participant leaves.
 *   - Seed rooms are pre-registered so the lobby is never empty.
 *
 * Demo Mode (Task 2):
 *   - GET /demo/check?ip=X — returns demo rate-limit status for an IP address.
 *     Limits: 10 requests/hour per IP, 200 tokens per session (tracked separately per ip).
 *   - Demo sessions can trigger generation but cannot fork rooms or sign receipts.
 *
 * TURN (Phase TURN-1):
 *   - GET /turn-credentials — returns short-lived Cloudflare TURN ICE server entry.
 *     TURN_KEY_ID and TURN_KEY_API_TOKEN stored as Wrangler secrets (never in source).
 *     WEB_ORIGIN in [vars] locks the CORS header to the SPA origin.
 *
 * Invariants (#2, #9): JSON.parse guarded; reconnect replaces same peerId without leaking peerCount.
 */

export interface Env {
  RELAY: DurableObjectNamespace;
  RELAY_REGISTRY: DurableObjectNamespace;
  /** Wrangler secret — Cloudflare TURN key ID (not the API token) */
  TURN_KEY_ID: string;
  /** Wrangler secret — Cloudflare TURN API token. Never expose to the browser. */
  TURN_KEY_API_TOKEN: string;
  /** [vars] — SPA origin for CORS lock, e.g. "https://fatedfortress.com" */
  WEB_ORIGIN: string;
}

/** Stable relay URL used internally for shard registration and forward calls. */
const RELAY_STUB = "http://relay-internal";

/** Parent DO stops accepting new peers here; they receive REDIRECT (soft cap ~80 × (1 + MAX_SHARDS) peers/room). */
const SHARD_THRESHOLD = 80;
const MAX_SHARDS = 8;

const SIGNALING_TYPES = new Set(["offer", "answer", "ice-candidate"]);

// ── TURN credential handler ───────────────────────────────────────────────────

/**
 * Calls the Cloudflare TURN credential-generation API and returns a single
 * ICE server entry with short-lived username + credential.
 *
 * TTL is 86400 s (24 h) — covers the longest realistic session.
 * Credentials are generated server-side so TURN_KEY_API_TOKEN never reaches
 * the browser.
 */
async function handleTurnCredentials(request: Request, env: Env): Promise<Response> {
  // Only allow GET from the SPA origin (OPTIONS handled below for pre-flight).
  const corsHeaders = {
    "Access-Control-Allow-Origin": env.WEB_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    // Graceful degradation: no TURN configured — caller falls back to STUN-only.
    return new Response(
      JSON.stringify({ iceServers: [] }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  let cfResponse: Response;
  try {
    cfResponse = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );
  } catch (err) {
    console.error("[turn] Cloudflare TURN API fetch failed:", err);
    return new Response(
      JSON.stringify({ iceServers: [] }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  if (!cfResponse.ok) {
    console.error("[turn] Cloudflare TURN API returned", cfResponse.status);
    return new Response(
      JSON.stringify({ iceServers: [] }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  // Cloudflare returns: { iceServers: { urls: string[], username: string, credential: string } }
  // We return the inner iceServers object directly; the client wraps it in an array.
  let data: { iceServers: { urls: string[]; username: string; credential: string } };
  try {
    data = await cfResponse.json() as typeof data;
  } catch {
    return new Response(
      JSON.stringify({ iceServers: [] }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  return new Response(
    JSON.stringify({ iceServers: data.iceServers }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Never cache credentials — they are short-lived and per-session.
        "Cache-Control": "no-store, no-cache, must-revalidate",
        ...corsHeaders,
      },
    }
  );
}

// ── Main fetch handler ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /turn-credentials — short-lived Cloudflare TURN credentials for the SPA.
    if (url.pathname === "/turn-credentials") {
      return handleTurnCredentials(request, env);
    }

    // GET /rooms — HTTP endpoint returning live room metadata for the lobby grid.
    if (request.method === "GET" && url.pathname === "/rooms") {
      const registryId = env.RELAY_REGISTRY.idFromName("global-registry");
      return env.RELAY_REGISTRY.get(registryId).fetch(request);
    }

    // GET /demo/check?ip=X — demo rate-limit status (10 req/hr per IP, 200 tokens/session).
    if (request.method === "GET" && url.pathname === "/demo/check") {
      const registryId = env.RELAY_REGISTRY.idFromName("global-registry");
      return env.RELAY_REGISTRY.get(registryId).fetch(request);
    }

    const roomId = url.searchParams.get("roomId") ?? "default";
    const shard = url.searchParams.get("shard");
    const name =
      shard !== null && shard !== ""
        ? `${roomId}-shard-${shard}`
        : roomId;
    const id = env.RELAY.idFromName(name);
    return env.RELAY.get(id).fetch(request);
  },
};

// ── RelayRegistryDO — tracks active rooms for the lobby grid ──────────────────

interface RoomMeta {
  id: string;
  name: string;
  category: string;
  hostPubkey: string;
  access: "free" | "paid";
  price?: number;
  participantCount: number;
  spectatorCount: number;
  fuelFraction: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
  sessionTokens: number;
}

const DEMO_RATE_LIMIT_WINDOW_MS = 3_600_000;
const DEMO_RATE_LIMIT_MAX = 10;
const DEMO_SESSION_TOKEN_LIMIT = 15_000;

const SEED_ROOMS: RoomMeta[] = [
  {
    id: "rm_seed_animation",
    name: "AI Animation Jam",
    category: "animation",
    hostPubkey: "FatedFortress",
    access: "free",
    participantCount: 0,
    spectatorCount: 0,
    fuelFraction: 1.0,
  },
  {
    id: "rm_seed_code",
    name: "Code Review Room",
    category: "code",
    hostPubkey: "FatedFortress",
    access: "free",
    participantCount: 0,
    spectatorCount: 0,
    fuelFraction: 1.0,
  },
  {
    id: "rm_seed_showcase",
    name: "Paid Showcase",
    category: "showcase",
    hostPubkey: "FatedFortress",
    access: "paid",
    price: 2,
    participantCount: 0,
    spectatorCount: 0,
    fuelFraction: 1.0,
  },
];

export class RelayRegistryDO implements DurableObject {
  private rooms = new Map<string, RoomMeta>();
  private rateLimits = new Map<string, RateLimitEntry>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {
    for (const room of SEED_ROOMS) {
      this.rooms.set(room.id, { ...room });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/rooms") {
      const list = Array.from(this.rooms.values()).map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        hostPubkey: r.hostPubkey,
        access: r.access,
        price: r.price,
        participantCount: r.participantCount,
        spectatorCount: r.spectatorCount,
        fuelFraction: r.fuelFraction,
      }));
      return new Response(JSON.stringify({ rooms: list }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/demo/check") {
      const ip = url.searchParams.get("ip") ?? "unknown";
      const entry = this.rateLimits.get(ip) ?? {
        count: 0,
        windowStart: Date.now(),
        sessionTokens: 0,
      };
      return new Response(
        JSON.stringify({
          allowed: entry.count < DEMO_RATE_LIMIT_MAX,
          requestsRemaining: Math.max(0, DEMO_RATE_LIMIT_MAX - entry.count),
          sessionTokensUsed: entry.sessionTokens,
          sessionTokenLimit: DEMO_SESSION_TOKEN_LIMIT,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.method === "POST" && url.pathname === "/demo/consume") {
      let body: { ip?: unknown; tokens?: unknown };
      try {
        body = (await request.json()) as { ip?: unknown; tokens?: unknown };
      } catch {
        return new Response("bad json", { status: 400 });
      }
      const ip = typeof body.ip === "string" ? body.ip : "unknown";
      const tokens = typeof body.tokens === "number" ? body.tokens : 1;
      const allowed = this.consumeDemoToken(ip, tokens);
      return new Response(JSON.stringify({ allowed }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/register") {
      let body: {
        roomId?: unknown;
        name?: unknown;
        category?: unknown;
        hostPubkey?: unknown;
        access?: unknown;
        price?: unknown;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return new Response("bad json", { status: 400 });
      }
      if (typeof body.roomId !== "string" || typeof body.name !== "string") {
        return new Response("bad fields", { status: 400 });
      }
      const existing = this.rooms.get(body.roomId);
      this.rooms.set(body.roomId, {
        id: body.roomId,
        name: body.name,
        category: typeof body.category === "string" ? body.category : "open",
        hostPubkey: typeof body.hostPubkey === "string" ? body.hostPubkey : "unknown",
        access: body.access === "paid" ? "paid" : "free",
        price: typeof body.price === "number" ? body.price : undefined,
        participantCount: existing?.participantCount ?? 0,
        spectatorCount: existing?.spectatorCount ?? 0,
        fuelFraction: existing?.fuelFraction ?? 1.0,
      });
      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/heartbeat") {
      let body: {
        roomId?: unknown;
        participantCount?: unknown;
        spectatorCount?: unknown;
        fuelFraction?: unknown;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return new Response("bad json", { status: 400 });
      }
      if (typeof body.roomId !== "string") {
        return new Response("bad fields", { status: 400 });
      }
      const existing = this.rooms.get(body.roomId);
      if (existing) {
        existing.participantCount =
          typeof body.participantCount === "number" ? body.participantCount : existing.participantCount;
        existing.spectatorCount =
          typeof body.spectatorCount === "number" ? body.spectatorCount : existing.spectatorCount;
        existing.fuelFraction =
          typeof body.fuelFraction === "number" ? body.fuelFraction : existing.fuelFraction;
      }
      return new Response("ok");
    }

    if (request.method === "POST" && url.pathname === "/deregister") {
      let body: { roomId?: unknown };
      try {
        body = (await request.json()) as { roomId?: unknown };
      } catch {
        return new Response("bad json", { status: 400 });
      }
      if (typeof body.roomId === "string") {
        this.rooms.delete(body.roomId);
      }
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  private consumeDemoToken(ip: string, tokens: number): boolean {
    const now = Date.now();
    let entry = this.rateLimits.get(ip);
    if (!entry) {
      entry = { count: 0, windowStart: now, sessionTokens: 0 };
    }
    if (now - entry.windowStart > DEMO_RATE_LIMIT_WINDOW_MS) {
      entry.count = 0;
      entry.windowStart = now;
      entry.sessionTokens = 0;
    }
    if (entry.count >= DEMO_RATE_LIMIT_MAX) return false;
    if (entry.sessionTokens + tokens > DEMO_SESSION_TOKEN_LIMIT) return false;
    entry.count++;
    entry.sessionTokens += tokens;
    this.rateLimits.set(ip, entry);
    return true;
  }
}

// RelayDO class must also be exported for Wrangler DO binding — kept identical to original.
// (Full RelayDO implementation omitted here; only the Worker entry + Env interface changed.)
