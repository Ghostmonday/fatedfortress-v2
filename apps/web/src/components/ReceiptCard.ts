// apps/web/src/components/ReceiptCard.ts
import type { Receipt } from "../state/vault.js";

export interface ReceiptData {
  id: string;
  hash?: string;
  model?: string;
  timestamp?: number;
  prompt?: string;
  parentId?: string;
}

export class ReceiptCard {
  private receipt: ReceiptData;

  constructor(receipt: ReceiptData) {
    this.receipt = receipt;
  }

  mount(el: HTMLElement): void {
    const time = this.receipt.timestamp
      ? new Date(this.receipt.timestamp).toLocaleString()
      : "pending";
    const tree = this.receipt.parentId
      ? `└─ ${this.receipt.id.slice(0, 8)}`
      : `● ${this.receipt.id.slice(0, 8)}`;
    const modelLabel = this.receipt.model ?? "unknown";
    const hashDisplay = this.receipt.hash ?? "pending";
    const promptPreview = this.receipt.prompt
      ? `<p class="receipt-prompt">${this.escapeHtml(this.receipt.prompt.slice(0, 120))}…</p>`
      : "";

    const card = document.createElement("div");
    card.className = "receipt-card";
    card.innerHTML = `
      <div class="receipt-tree">${tree}</div>
      <div class="receipt-meta">
        <span class="receipt-model">${this.escapeHtml(modelLabel)}</span>
        <span class="receipt-time">${time}</span>
      </div>
      <pre class="receipt-hash">${this.escapeHtml(hashDisplay)}</pre>
      ${promptPreview}
    `;

    card.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("receipt:focus", { detail: { id: this.receipt.id } }));
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
