import type { SpectatorMessage } from "../state/ydoc.js";
import type { FortressRoomDoc } from "../state/ydoc.js";
import { getMyPubkey, getMyDisplayName } from "../state/identity.js";
import type { PublicKeyBase58 } from "@fatedfortress/protocol";

export class SpectatorChatView {
  private doc: FortressRoomDoc;
  private viewer: HTMLElement;
  private input: HTMLInputElement;
  private unsubscribe: (() => void) | null = null;

  constructor(doc: FortressRoomDoc) {
    this.doc = doc;
  }

  mount(el: HTMLElement): void {
    this.viewer = document.createElement("div");
    this.viewer.className = "spectator-chat-viewer";
    this.input = document.createElement("input");
    this.input.placeholder = "Chat with other spectators...";
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.input.value.trim()) {
        this.send(this.input.value.trim());
        this.input.value = "";
      }
    });
    el.appendChild(this.viewer);
    el.appendChild(this.input);
    this.subscribe();
  }

  destroy(): void {
    this.unsubscribe?.();
  }

  private send(text: string): void {
    const myPubkey = getMyPubkey();
    if (!myPubkey) return;
    const displayName = getMyDisplayName();
    const entry: SpectatorMessage = {
      id: crypto.randomUUID(),
      pubkey: myPubkey as PublicKeyBase58,
      displayName,
      text,
      ts: Date.now(),
    };
    this.doc.doc.transact(() => {
      this.doc.spectatorChat.push([entry]);
    });
  }

  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  private subscribe(): void {
    const render = () => {
      const messages = this.doc.spectatorChat.toArray();
      this.viewer.innerHTML = messages
        .map(m => `<div class="spc-msg"><span class="spc-ts">${this.formatTime(m.ts)}</span> <span class="spc-name">@${m.displayName}</span>: <span class="spc-text">${m.text}</span></div>`)
        .join("");
      this.viewer.scrollTop = this.viewer.scrollHeight;
    };
    this.doc.spectatorChat.observe(render);
    this.unsubscribe = () => this.doc.spectatorChat.unobserve(render);
  }
}
