/**
 * apps/web/src/components/ConnectionBadge.ts
 *
 * Renders a small overlay badge showing the active WebRTC connection type:
 *   🔘 CONNECTING  — ICE negotiation in progress
 *   🟢 P2P         — direct UDP/TCP path (no TURN relay)
 *   🟡 TURN        — relayed via Cloudflare TURN (higher latency)
 *   🔴 OFFLINE     — ICE failed or disconnected
 *
 * Uses vanilla DOM + style injection (matches the existing .ts component style
 * in this repo — no React/JSX).
 *
 * Usage:
 *   const badge = new ConnectionBadge(containerEl);
 *   badge.watch(getPeerConnections);  // pass the getter from signaling.ts
 *   // later:
 *   badge.destroy();
 */

import { getPeerConnections } from "../net/signaling.js";

type ConnState = "connecting" | "p2p" | "turn" | "failed";

const STATE_CONFIG: Record<ConnState, { dot: string; label: string; color: string }> = {
  connecting: { dot: "⏳", label: "CONNECTING", color: "#94a3b8" },
  p2p:        { dot: "🟢", label: "P2P",        color: "#22c55e" },
  turn:       { dot: "🟡", label: "TURN",       color: "#eab308" },
  failed:     { dot: "🔴", label: "OFFLINE",    color: "#ef4444" },
};

/**
 * Inspects getStats() on an RTCPeerConnection and returns whether the
 * nominated active candidate pair is using a TURN relay.
 *
 * Correct algorithm:
 *   1. Find the candidate-pair with state === "succeeded" AND nominated === true.
 *   2. Look up that pair's localCandidateId in the stats map.
 *   3. Check whether the local candidate's candidateType === "relay".
 */
async function detectRelay(pc: RTCPeerConnection): Promise<boolean> {
  try {
    const stats = await pc.getStats();
    const statsMap = new Map<string, RTCStats>();
    stats.forEach((r) => statsMap.set(r.id, r));

    let usingRelay = false;

    stats.forEach((report) => {
      if (report.type !== "candidate-pair") return;
      const pair = report as RTCIceCandidatePairStats;
      // Only inspect the nominated (active) pair.
      if (pair.state !== "succeeded" || !(pair as any).nominated) return;

      const localCandId = pair.localCandidateId;
      if (!localCandId) return;
      const localCand = statsMap.get(localCandId) as RTCStats | undefined;
      if ((localCand as any).candidateType === "relay") {
        usingRelay = true;
      }
    });

    return usingRelay;
  } catch {
    // getStats() unavailable (e.g. some Firefox quirks) — assume direct.
    return false;
  }
}

export class ConnectionBadge {
  private el: HTMLElement;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private state: ConnState = "connecting";

  constructor(private readonly container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "ff-connection-badge";
    this.applyStyles();
    container.style.position = container.style.position || "relative";
    container.appendChild(this.el);
    this.render();
  }

  /** Start polling peer connections every 2 seconds. */
  watch(): void {
    this.poll();
    this.pollInterval = setInterval(() => void this.poll(), 2000);
  }

  destroy(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.el.remove();
  }

  private async poll(): Promise<void> {
    const pcs = getPeerConnections();

    if (pcs.size === 0) {
      this.setState("connecting");
      return;
    }

    // Inspect the first available peer connection.
    const [, pc] = pcs.entries().next().value as [string, RTCPeerConnection];
    const ice = pc.iceConnectionState;

    if (ice === "connected" || ice === "completed") {
      const relay = await detectRelay(pc);
      this.setState(relay ? "turn" : "p2p");
    } else if (ice === "failed" || ice === "disconnected" || ice === "closed") {
      this.setState("failed");
    } else {
      this.setState("connecting");
    }
  }

  private setState(next: ConnState): void {
    if (this.state === next) return;
    this.state = next;
    this.render();
  }

  private render(): void {
    const { dot, label, color } = STATE_CONFIG[this.state];
    this.el.textContent = `${dot} ${label}`;
    this.el.style.borderColor = color;
    this.el.style.color = "#fff";
  }

  private applyStyles(): void {
    Object.assign(this.el.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      background: "rgba(0,0,0,0.72)",
      color: "#fff",
      fontSize: "11px",
      padding: "2px 8px",
      border: "1px solid #94a3b8",
      borderRadius: "3px",
      fontFamily: "var(--font-mono, monospace)",
      userSelect: "none",
      pointerEvents: "none",
      zIndex: "100",
      letterSpacing: "0.05em",
    });
  }
}
