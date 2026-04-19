/**
 * relay/src/index.ts — Cloudflare Durable Object for WebRTC signaling.
 *
 * Stateless rendezvous only: receives offer/answer SDP from peer A,
 * forwards to peer B. Never stores room state or content.
 *
 * Responsibilities:
 *   - WebSocket-based peer connection broker
 *   - Message relay between peers (targetPeerId routing)
 *   - peerCount tracking for debugging/metrics
 *
 * Durability: session-scoped only. Peers disconnect and reconnect as needed.
 * The DO is instantiated once per roomId (Cloudflare handles this).
 */

export class RelayDO implements DurableObject {
  private peers = new Map<string, WebSocket>();
  private peerCount = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const peerId = url.searchParams.get("peerId");
    if (!peerId) return new Response("Missing peerId", { status: 400 });

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    this.peers.set(peerId, server);
    this.peerCount++;

    // Auto-scale trigger: > 20 peers
    if (this.peerCount > 20) {
      // TODO [P3.1]: DO-to-DO routing for overflow rooms requires a RELAY_NAMESPACE Durable Object binding
      // (defined in wrangler.toml) and using namespace.get(newRoomId) to obtain a stub — not an HTTP
      // call to the Cloudflare management API. The management API is for account-level operations
      // and is not available from inside a Worker runtime.
      console.warn(`[RelayDO] Peer count ${this.peerCount} exceeds threshold — overflow routing TODO`);
    }

    server.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data as string);
      const target = this.peers.get(msg.targetPeerId);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ ...msg, fromPeerId: peerId }));
      }
    });

    server.addEventListener("close", () => {
      this.peers.delete(peerId);
      this.peerCount--;
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}
