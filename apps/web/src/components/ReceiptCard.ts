// apps/web/src/components/ReceiptCard.ts
import type { Receipt } from "../state/vault.js";
import { resolveOpfsUrl } from "../net/archive.js";

export interface ReceiptData {
  id: string;
  hash?: string;
  model?: string;
  timestamp?: number;
  prompt?: string;
  parentId?: string;
  /** Multi-line ASCII fork / chain line(s) for display */
  forkLines?: string;
  /** Room type: text (default), image, audio, video */
  type?: "text" | "image" | "audio" | "video";
  /** opfs:// URLs of generated images (for re-archiving on publish) */
  outputUrls?: string[];
  /** SHA-256 of reference image used to generate this receipt (image rooms only) */
  referenceImageHash?: string;
  /** Image output URL (for display preview) */
  previewUrl?: string;
}

export class ReceiptCard {
  private receipt: ReceiptData;

  constructor(receipt: ReceiptData) {
    this.receipt = receipt;
  }

  mount(el: HTMLElement): void {
    const shortId = this.receipt.id.slice(0, 10).toUpperCase();
    const time = this.receipt.timestamp
      ? new Date(this.receipt.timestamp).toLocaleString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "--:--:--";
    const forkBlock =
      this.receipt.forkLines?.trim() ?? this.defaultForkLines();
    const modelLabel = this.receipt.model ?? "unknown";
    const hashDisplay = this.receipt.hash ?? "PENDING_DIGEST";

    const isImage = this.receipt.type === "image";
    const hasPreview = !!this.receipt.previewUrl;

    const card = document.createElement("article");
    card.className = "ff-receipt-card";
    card.innerHTML = `
      ${isImage && hasPreview ? `
      <div class="ff-rc-image-area">
        <img
          class="ff-rc-image"
          src="${this.escapeAttr(this.receipt.previewUrl ?? "")}"
          alt="${this.escapeAttr(this.receipt.prompt ?? "Generated output")}"
          loading="lazy"
        />
        <div class="ff-rc-gen-badge">${shortId}</div>
        <div class="ff-rc-image-overlay">
          <button class="ff-rc-action-btn" title="Fork this generation" data-action="fork">
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M6 2l4 4-4 4V8H2V4h4V2zm6 6l-4-4v4H4v4h4v-2l4-4-4 4z"/>
            </svg>
          </button>
          <button class="ff-rc-action-btn" title="Download image" data-action="download">
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M8 12l-4-4h3V2h2v6h3l-4 4zM2 14h12v1H2z"/>
            </svg>
          </button>
        </div>
      </div>` : `
      <div class="ff-rc-image-area ff-rc-image-area--placeholder">
        <svg class="ff-rc-broken-img" viewBox="0 0 16 16" fill="currentColor" width="32" height="32">
          <path d="M2 2h12l-1.5 1.5-3 3-4.5 4.5L3 12v2H1V2h1zm3 4l2 2-2 2-2-2 2-2zm5 5l2 2-2 2-2-2 2-2z"/>
        </svg>
        <div class="ff-rc-gen-badge">${shortId}</div>
      </div>`}

      <div class="ff-rc-body">
        <div class="ff-rc-title-row">
          <p class="ff-rc-prompt">${this.escapeHtml(this.receipt.prompt?.slice(0, 80) ?? "")}</p>
        </div>
        <div class="ff-rc-footer">
          <span class="ff-rc-time">${time}</span>
          <button class="ff-rc-fork-btn" title="Lineage Fork" data-action="fork">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M6 2l4 4-4 4V8H2V4h4V2zm6 6l-4-4v4H4v4h4v-2l4-4-4 4z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Fork action
    const forkBtn = card.querySelector("[data-action=fork]");
    forkBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("receipt:focus", { detail: { id: this.receipt.id } }));
    });

    // Download action (image only)
    const downloadBtn = card.querySelector("[data-action=download]");
    downloadBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = this.receipt.previewUrl;
      if (!url) return;
      try {
        const resolved = url.startsWith("opfs://") ? await resolveOpfsUrl(url) : url;
        const a = document.createElement("a");
        a.href = resolved ?? url;
        a.download = `ff-image-${this.receipt.id}.png`;
        a.click();
      } catch (err) {
        console.error("[ReceiptCard] download failed:", err);
      }
    });

    // Click on card body focuses receipt
    card.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("receipt:focus", { detail: { id: this.receipt.id } }));
    });

    el.appendChild(card);
  }

  private defaultForkLines(): string {
    const short = this.receipt.id.slice(0, 10);
    if (!this.receipt.parentId) {
      return `● GENESIS LINE\n   id  ${short}`;
    }
    const p = this.receipt.parentId.slice(0, 10);
    return `└─ FORK (child of parent chain)\n   id  ${short}\n   ←  ${p}`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private escapeAttr(str: string): string {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}

/* Build richer fork graph text from a flat receipt list (newest-first or any order). */
export function buildForkLines(receipt: Receipt, all: Receipt[]): string {
  const idS = receipt.id.slice(0, 10);
  if (!receipt.parentId) {
    return `● ROOT\n   ${idS}`;
  }
  const parent = all.find((r) => r.id === receipt.parentId);
  const p = receipt.parentId.slice(0, 10);
  if (!parent) {
    return `└─ FORK\n   ${idS}\n   ←  ${p}  (parent not loaded)`;
  }
  const pp = parent.id.slice(0, 10);
  return `└─ FORK\n   ${idS}\n   ←  ${p}  [parent ${pp}]`;
}
