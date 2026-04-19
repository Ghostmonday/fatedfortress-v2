/**
 * pages/room.ts — Live room page (/#rm_{id}).
 *
 * Split-pane layout:
 *   - LEFT: OutputPane — streaming monospace output, per-peer cursors via Y.Text
 *   - RIGHT: ControlPane — key entry, model select, prompt input, fuel gauge
 *   - BOTTOM: action bar — FORK · PUBLISH · INVITE · PAY
 *
 * Presence: @name tokens in header, live via Y.js presence map.
 * Persistence: room doc synced P2P via y-webrtc.
 */

// TODO: pages/room.ts
