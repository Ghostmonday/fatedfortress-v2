/**
 * relay/src/index.ts — Cloudflare Durable Object for WebRTC signaling.
 *
 * Stateless rendezvous only: receives offer/answer SDP from peer A,
 * forwards to peer B. Never stores room state or content.
 *
 * Responsibilities:
 *   - /offer  POST { roomId, sdp: string, type: "offer" }
 *   - /answer POST { roomId, sdp: string, type: "answer" }
 *   - /ice    POST { roomId, candidate: RTCIceCandidate }
 *
 * Durability: session-scoped only. Peers disconnect and reconnect as needed.
 * The DO is instantiated once per roomId (Cloudflare handles this).
 *
 * wrangler.toml:
 *   main: src/index.ts
 *   compatibility_date: 2026-01-01
 *   triggers: { crons: [] } — no cron needed, DO is request-driven
 */

// TODO: apps/relay/src/index.ts
