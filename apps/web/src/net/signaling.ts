/**
 * net/signaling.ts — y-webrtc client for P2P room sync.
 *
 * Responsibilities:
 *   - Connect to Cloudflare Durable Object signaling relay
 *   - Establish WebRTC peer connections with other room participants
 *   - Apply incoming Y.js updates to the local doc
 *   - Send local Y.js updates to all connected peers
 *
 * Signaling relay is stateless — it only brokers peer discovery.
 * Room content never touches the relay.
 *
 * Cloudflare DO endpoint: configurable via SIGNALS_URL env var.
 */

// TODO: net/signaling.ts
