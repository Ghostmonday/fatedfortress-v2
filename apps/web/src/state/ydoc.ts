/**
 * ydoc.ts — Y.js CRDT document factory for FatedFortress rooms.
 *
 * SCHEMA IS IMMUTABLE after v1 ships. New fields are ADDITIVE ONLY.
 * See schema-migrations.ts for forward-compatibility rules.
 *
 * TYPE SELECTION RATIONALE (do not change without full review):
 *   Y.Map    — room metadata: single logical owner, key-value fields
 *   Y.Array  — receipts, participants, templates: append-only, concurrent-safe
 *   Y.Text   — output stream: character-level concurrent edits for streaming
 *   Y.Map<V> — presence: each peer owns exactly one entry keyed by pubkey
 *
 * Wrong type choices produce irreconcilable merge conflicts under concurrent
 * edits and cannot be migrated without invalidating all existing room docs.
 */

import * as Y from "yjs";
import type {
  PublicKeyBase58,
  RoomId,
  ReceiptId,
  RoomCategory,
  RoomAccess,
  RoomRole,
} from "@fatedfortress/protocol";
import { getMyPubkey } from "./identity.js";

export interface RoomMeta {
  id: RoomId;
  name: string;
  description: string;
  category: RoomCategory;
  access: RoomAccess;
  /** USDC price — null for free rooms */
  price: number | null;
  currency: "USDC" | null;
  systemPrompt: string;
  createdAt: number;
  schemaVersion: 1;
  /** Timestamp when room was upgraded from spectator to full room, null if not upgraded */
  upgradedAt: number | null;
  /** Public key of the active host (may differ from original hostPubkey during handoff) */
  activeHostPubkey: PublicKeyBase58;
}

export interface ParticipantEntry {
  pubkey: PublicKeyBase58;
  name: string;
  joinedAt: number;
  contributesKey: boolean;
  /** Tokens per user per hour if contributing key, null otherwise */
  quotaPerUser: number | null;
  /** Whether this participant is spectating (read-only, no API key contribution) */
  isSpectator?: boolean;
  /** Official roles assigned to this participant */
  roles?: RoomRole[];
}

export interface PresenceEntry {
  pubkey: PublicKeyBase58;
  name: string;
  /** Cursor position in the output pane as character offset, null if not focused */
  cursorOffset: number | null;
  lastSeenAt: number;
  /** Whether this presence entry belongs to a spectator */
  isSpectator?: boolean;
}

export interface SpectatorMessage {
  id: string;
  pubkey: PublicKeyBase58;
  displayName: string;
  text: string;
  ts: number;
}

export interface FortressRoomDoc {
  meta: Y.Map<RoomMeta[keyof RoomMeta]>;
  participants: Y.Array<ParticipantEntry>;
  output: Y.Text;
  receiptIds: Y.Array<ReceiptId>;
  templates: Y.Array<string>;
  presence: Y.Map<PresenceEntry>;
  /** Chat messages among spectators in a room */
  spectatorChat: Y.Array<SpectatorMessage>;
  /** The raw Y.Doc — for transport (y-webrtc) and persistence (OPFS/IndexedDB) */
  doc: Y.Doc;
}

export function createRoomDoc(initialMeta?: Partial<RoomMeta>): FortressRoomDoc {
  const doc = new Y.Doc();

  const meta         = doc.getMap<RoomMeta[keyof RoomMeta]>("meta");
  const participants  = doc.getArray<ParticipantEntry>("participants");
  const output       = doc.getText("output");
  const receiptIds   = doc.getArray<ReceiptId>("receiptIds");
  const templates    = doc.getArray<string>("templates");
  const presence     = doc.getMap<PresenceEntry>("presence");
  const spectatorChat = doc.getArray<SpectatorMessage>("spectatorChat");

  if (initialMeta) {
    doc.transact(() => {
      meta.set("id", initialMeta.id ?? (`rm_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}` as RoomId));
      meta.set("name", initialMeta.name ?? "Untitled Room");
      meta.set("description", initialMeta.description ?? "");
      meta.set("category", initialMeta.category ?? "general");
      meta.set("access", initialMeta.access ?? "free");
      meta.set("price", initialMeta.price ?? null);
      meta.set("currency", initialMeta.currency ?? null);
      meta.set("systemPrompt", initialMeta.systemPrompt ?? "");
      meta.set("createdAt", initialMeta.createdAt ?? Date.now());
      meta.set("schemaVersion", 1);
      meta.set("upgradedAt", null);
      meta.set("activeHostPubkey", initialMeta.activeHostPubkey ?? ("" as PublicKeyBase58));
    });
  }

  return { meta, participants, output, receiptIds, templates, presence, spectatorChat, doc };
}

export const getRoomId     = (r: FortressRoomDoc): RoomId      => r.meta.get("id")     as RoomId;
export const getRoomName   = (r: FortressRoomDoc): string       => (r.meta.get("name")  as string) ?? "Untitled Room";
export const getRoomAccess = (r: FortressRoomDoc): RoomAccess   => (r.meta.get("access") as RoomAccess) ?? "free";
export const getRoomPrice  = (r: FortressRoomDoc): number|null  => (r.meta.get("price") as number|null) ?? null;
export const getCategory   = (r: FortressRoomDoc): RoomCategory => (r.meta.get("category") as RoomCategory) ?? "general";
export const getSystemPrompt = (r: FortressRoomDoc): string     => (r.meta.get("systemPrompt") as string) ?? "";
export const getCreatedAt  = (r: FortressRoomDoc): number       => (r.meta.get("createdAt") as number) ?? 0;
export const getOutputText = (r: FortressRoomDoc): string       => r.output.toString();
export const getReceiptIds = (r: FortressRoomDoc): ReceiptId[]  => r.receiptIds.toArray();
export const getTemplates  = (r: FortressRoomDoc): string[]     => r.templates.toArray();
export const getPresence   = (r: FortressRoomDoc): PresenceEntry[] => Array.from(r.presence.values());
export const getParticipants = (r: FortressRoomDoc): ParticipantEntry[] => r.participants.toArray();

export function setMeta(
  room: FortressRoomDoc,
  patch: Partial<Omit<RoomMeta, "id" | "createdAt" | "schemaVersion">>
): void {
  room.doc.transact(() => {
    for (const k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        room.meta.set(k, patch[k as keyof typeof patch] as RoomMeta[keyof RoomMeta]);
      }
    }
  });
}

export function appendOutput(room: FortressRoomDoc, chunk: string): void {
  room.doc.transact(() => {
    room.output.insert(room.output.length, chunk);
  });
}

export function clearOutput(room: FortressRoomDoc): void {
  room.doc.transact(() => {
    if (room.output.length > 0) {
      room.output.delete(0, room.output.length);
    }
  });
}

export function addReceiptId(room: FortressRoomDoc, id: ReceiptId): void {
  room.doc.transact(() => {
    room.receiptIds.push([id]);
  });
}

export function addTemplate(room: FortressRoomDoc, template: string): void {
  room.doc.transact(() => {
    room.templates.push([template]);
  });
}

/**
 * Upserts a presence entry for a peer.
 * Each peer is the sole writer for their own presence entry (keyed by pubkey).
 * Concurrent writes from different peers never conflict — different keys.
 */
export function upsertPresence(room: FortressRoomDoc, entry: PresenceEntry): void {
  room.doc.transact(() => {
    room.presence.set(entry.pubkey, { ...entry, lastSeenAt: Date.now() });
  });
}

export function removePresence(room: FortressRoomDoc, pubkey: PublicKeyBase58): void {
  room.doc.transact(() => {
    room.presence.delete(pubkey);
  });
}

/**
 * Returns the currently active room doc, creating one if it doesn't exist.
 * In a multi-room app this would be keyed by roomId; for now we maintain
 * a single active doc in memory.
 */
let _activeRoomDoc: FortressRoomDoc | null = null;

export function getActiveRoomDoc(roomId: RoomId): FortressRoomDoc {
  if (!_activeRoomDoc || getRoomId(_activeRoomDoc) !== roomId) {
    _activeRoomDoc = createRoomDoc({ id: roomId });
  }
  return _activeRoomDoc;
}

export function setActiveRoomDoc(doc: FortressRoomDoc): void {
  _activeRoomDoc = doc;
}

/** Returns the active room doc without requiring a roomId — returns null if none is set */
export function getActiveRoomDocIfSet(): FortressRoomDoc | null {
  return _activeRoomDoc;
}

/**
 * Returns the joinedAt timestamp for the current user, or Date.now() if not found.
 */
export function getMyJoinedAt(doc: FortressRoomDoc): number {
  const myPubkey = getMyPubkey();
  if (!myPubkey) return Date.now();
  const participant = doc.participants.toArray().find((p: ParticipantEntry) => p.pubkey === myPubkey);
  return participant?.joinedAt ?? Date.now();
}

/**
 * Adds a participant. Idempotent — checks by pubkey before pushing.
 * Uses toArray() scan — acceptable for rooms up to ~1000 participants.
 */
export function addParticipant(room: FortressRoomDoc, participant: ParticipantEntry): void {
  room.doc.transact(() => {
    const exists = room.participants.toArray().some((p: ParticipantEntry) => p.pubkey === participant.pubkey);
    if (!exists) {
      room.participants.push([participant]);
    }
  });
}

/**
 * Updates an existing participant's fields. Idempotent.
 */
export function updateParticipant(room: FortressRoomDoc, pubkey: string, patch: Partial<ParticipantEntry>): void {
  room.doc.transact(() => {
    const arr = room.participants.toArray();
    const idx = arr.findIndex((p: ParticipantEntry) => p.pubkey === pubkey);
    if (idx < 0) return;
    const current = arr[idx];
    room.participants.delete(idx);
    room.participants.insert(idx, [{ ...current, ...patch } as ParticipantEntry]);
  });
}

/** Serializes the full doc state as a binary update for transport/storage */
export function serializeDoc(room: FortressRoomDoc): Uint8Array {
  return Y.encodeStateAsUpdate(room.doc);
}

/**
 * Hydrates a FortressRoomDoc from a binary update.
 * Used in fork flow: fetch(here.now url) → hydrateDoc(bytes)
 */
export function hydrateDoc(update: Uint8Array): FortressRoomDoc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return {
    meta:          doc.getMap("meta"),
    participants:  doc.getArray("participants"),
    output:        doc.getText("output"),
    receiptIds:    doc.getArray("receiptIds"),
    templates:     doc.getArray("templates"),
    presence:      doc.getMap("presence"),
    spectatorChat: doc.getArray<SpectatorMessage>("spectatorChat"),
    doc,
  };
}

/**
 * Merges a remote update into an existing doc (used by y-webrtc peer sync).
 * Y.js guarantees this is conflict-free regardless of application order.
 */
export function applyRemoteUpdate(room: FortressRoomDoc, update: Uint8Array): void {
  Y.applyUpdate(room.doc, update);
}
