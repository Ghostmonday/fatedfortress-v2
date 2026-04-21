// apps/web/src/components/RoomCard.ts

export interface RoomCardData {
  id: string;
  name: string;
  category: string;
  hostPubkey: string;
  access: "free" | "paid";
  price?: number;
  fuelLevel?: number;
  participantCount?: number;
  spectatorCount?: number;
}

export class RoomCard {
  private room: RoomCardData;

  constructor(room: RoomCardData) {
    this.room = room;
  }

  mount(el: HTMLElement): void {
    const truncatedHost = this.room.hostPubkey.length > 8
      ? this.room.hostPubkey.slice(0, 8) + "…"
      : this.room.hostPubkey;

    const fuelPct = this.room.fuelLevel ?? 100;
    const fuelColor = fuelPct <= 0
      ? "var(--ff-tertiary)"
      : fuelPct < 20
        ? "var(--ff-secondary-dim)"
        : "var(--ff-primary)";

    const participants = this.room.participantCount ?? 0;
    const maxParticipants = 12;
    const spectators = this.room.spectatorCount ?? 0;

    const isEmpty = fuelPct <= 0 && participants === 0;

    const card = document.createElement("article");
    card.className = `ff-room-card${isEmpty ? " ff-room-card--empty" : ""}`;
    card.innerHTML = `
      <div class="ff-rc-header">
        <div class="ff-rc-title-row">
          <h3 class="ff-rc-name">${this.escapeHtml(this.room.name.toUpperCase())}</h3>
          <span class="ff-rc-category ff-label">#${this.room.category.slice(0, 4).toUpperCase()}</span>
        </div>
        <p class="ff-rc-host ff-label">HOST: ${this.escapeHtml(truncatedHost)}</p>
      </div>

      <div class="ff-rc-fuel">
        <div class="ff-rc-fuel-header">
          <span class="ff-label" style="color: ${fuelColor}">INTEGRITY</span>
          <span class="ff-label" style="color: ${fuelColor}">${Math.round(fuelPct)}%</span>
        </div>
        <div class="ff-rc-fuel-bar">
          <div class="ff-rc-fuel-fill" style="width:${fuelPct}%; background:${fuelColor}"></div>
        </div>
      </div>

      <div class="ff-rc-participants">
        <svg class="ff-rc-group-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" width="14" height="14">
          <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 8H3a1 1 0 0 1-1-1v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1a1 1 0 0 1-1 1z"/>
        </svg>
        <span class="ff-label">${participants} / ${maxParticipants} Users</span>
      </div>

      <div class="ff-rc-actions">
        <button
          class="ff-rc-btn ff-rc-btn--join"
          data-room="${this.room.id}"
          ${isEmpty ? "disabled" : ""}>
          JOIN
        </button>
        <button
          class="ff-rc-btn ff-rc-btn--spectate"
          data-room="${this.room.id}"
          ${isEmpty ? "disabled" : ""}>
          SPECTATE
        </button>
      </div>
    `;

    card.querySelector(".ff-rc-btn--join")?.addEventListener("click", (e) => {
      if (isEmpty) return;
      window.history.pushState({}, "", `/room/${this.room.id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    card.querySelector(".ff-rc-btn--spectate")?.addEventListener("click", (e) => {
      if (isEmpty) return;
      window.history.pushState({}, "", `/spectate/${this.room.id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    el.appendChild(card);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
