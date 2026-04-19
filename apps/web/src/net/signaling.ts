// apps/web/src/net/signaling.ts
// y-webrtc provider for P2P sync via relay Durable Object

import { type RoomId } from "@fatedfortress/protocol";
import {
  type FortressRoomDoc,
  createRoomDoc,
  setActiveRoomDoc,
  applyRemoteUpdate,
  type PresenceEntry,
} from "../state/ydoc.js";
import { getMyPubkey, getMyDisplayName } from "../state/identity.js";

const RELAY_ORIGIN = typeof __RELAY_ORIGIN__ !== "undefined"
  ? __RELAY_ORIGIN__
  : "wss://relay.fatedfortress.com";

export { type PresenceEntry };

export function upsertPresence(doc: FortressRoomDoc, presence: Partial<PresenceEntry>): void {
  const myPubkey = getMyPubkey();
  if (!myPubkey) return;
  const existing = doc.presence.get(myPubkey);
  doc.presence.set(myPubkey, {
    pubkey: myPubkey,
    name: presence.name ?? existing?.name ?? getMyDisplayName(),
    cursorOffset: presence.cursorOffset ?? null,
    lastSeenAt: Date.now(),
    isSpectator: presence.isSpectator ?? false,
  });
}

export function removePresence(doc: FortressRoomDoc): void {
  const myPubkey = getMyPubkey();
  if (!myPubkey) return;
  doc.presence.delete(myPubkey);
}

export async function joinRoom(roomId: RoomId): Promise<FortressRoomDoc> {
  // Create a new room doc — sync state will come from relay via y-webrtc
  const doc = createRoomDoc({ id: roomId });

  // Store as active doc for the app
  setActiveRoomDoc(doc);

  // Connect to relay WebSocket for signaling
  const peerId = getMyPubkey() ?? `anon_${crypto.randomUUID().slice(0, 8)}`;
  const wsUrl = `${RELAY_ORIGIN}?peerId=${encodeURIComponent(peerId)}`;

  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    console.warn("[signaling] Could not connect to relay — running in local mode");
    return doc;
  }

  return new Promise((resolve) => {
    ws.addEventListener("open", () => {
      console.log(`[signaling] Connected to relay as ${peerId}`);
      resolve(doc);
    });

    ws.addEventListener("message", (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      // Handle peer signaling messages (offer/answer/ice-candidate)
      // These would be forwarded to y-webrtc in a full implementation
      if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice-candidate") {
        // y-webrtc would handle these for WebRTC connection establishment
        console.debug("[signaling] Relay signaling message:", msg.type);
      }

      // Handle room sync messages from relay
      if (msg.type === "sync" && msg.update) {
        // Apply remote Y.js update
        try {
          const update = new Uint8Array(msg.update);
          applyRemoteUpdate(doc, update);
        } catch (e) {
          console.warn("[signaling] Failed to apply remote update:", e);
        }
      }
    });

    ws.addEventListener("close", () => {
      console.log("[signaling] Disconnected from relay");
    });

    ws.addEventListener("error", (e) => {
      console.warn("[signaling] WebSocket error:", e);
    });
  });
}
