// apps/web/src/handlers/upgrade.ts
import type { FortressRoomDoc } from "../state/ydoc.js";
import { upsertPresence } from "../net/signaling.js";

export async function handleUpgradeRoom(
  intent: { type: "upgrade_room"; price: number | null },
  doc: FortressRoomDoc
): Promise<void> {
  const upgradedAt = Date.now();

  doc.doc.transact(() => {
    doc.meta.set("access", intent.price ? "paid" : "free");
    doc.meta.set("price", intent.price);
    doc.meta.set("upgradedAt", upgradedAt);
  });

  // Broadcast upgrade event via Y.js (presence awareness)
  upsertPresence(doc, { isUpgrade: true, upgradedAt } as any);
}
