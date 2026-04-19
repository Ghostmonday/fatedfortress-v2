// apps/web/src/state/presence.ts
// Host presence detection and ephemeral handoff logic for FatedFortress rooms.

import type { FortressRoomDoc } from "./ydoc.js";
import { getMyPubkey } from "./identity.js";

export interface RoomState {
  handoffTriggered: boolean;
}

const roomStates = new Map<string, RoomState>();
const DISCONNECT_THRESHOLD_MS = 30_000;

function getRoomState(roomId: string): RoomState {
  if (!roomStates.has(roomId)) {
    roomStates.set(roomId, { handoffTriggered: false });
  }
  return roomStates.get(roomId)!;
}

export function checkHostPresence(room: FortressRoomDoc): void {
  const roomId = room.meta.get("id") as string;
  const roomState = getRoomState(roomId);
  const hostPubkey = room.meta.get("hostPubkey") as string | undefined;
  const activeHostPubkey = room.meta.get("activeHostPubkey") as string | undefined;

  if (!hostPubkey) return;

  const hostPresence = room.presence.get(hostPubkey);
  if (!hostPresence) return;

  const stale = Date.now() - hostPresence.lastSeenAt > DISCONNECT_THRESHOLD_MS;

  if (!stale) {
    // Host came back — reset so a future disconnect triggers handoff again
    roomState.handoffTriggered = false;
    const originalHost = room.meta.get("hostPubkey") as string;
    if (originalHost && originalHost !== activeHostPubkey) {
      room.doc.transact(() => {
        room.meta.set("activeHostPubkey", originalHost as any);
      });
    }
    return;
  }

  if (stale && !roomState.handoffTriggered) {
    roomState.handoffTriggered = true;
    initiateHandoff(room);
  }
}

async function initiateHandoff(room: FortressRoomDoc): Promise<void> {
  const delegateKey = getMyPubkey();
  if (!delegateKey) {
    console.warn("[presence] Cannot initiate handoff: no identity pubkey available");
    return;
  }

  room.doc.transact(() => {
    room.meta.set("activeHostPubkey", delegateKey as any);
  });

  console.log(`[presence] Host handoff initiated. New active host: ${delegateKey}`);
}

export function cleanupRoomState(roomId: string): void {
  roomStates.delete(roomId);
}
