// apps/web/src/components/ControlPane.ts
import { WorkerBridge } from "../net/worker-bridge.js";
import {
  appendOutput,
  getTemplates,
  getRoomId,
} from "../state/ydoc.js";
import { saveReceipt } from "../state/vault.js";
import type { FortressRoomDoc } from "../state/ydoc.js";

const ALL_MODELS = [
  { provider: "openai",     model: "gpt-4o",              label: "GPT-4o" },
  { provider: "openai",     model: "o3",                  label: "OpenAI o3" },
  { provider: "openai",     model: "o4-mini",             label: "OpenAI o4-mini" },
  { provider: "anthropic",  model: "claude-4-sonnet",      label: "Claude 4 Sonnet" },
  { provider: "anthropic",  model: "claude-4-opus",        label: "Claude 4 Opus" },
  { provider: "anthropic",  model: "claude-haiku",          label: "Claude Haiku" },
  { provider: "google",     model: "gemini-2.0-flash",    label: "Gemini 2.0 Flash" },
  { provider: "google",     model: "gemini-2.0-pro",      label: "Gemini 2.0 Pro" },
  { provider: "groq",       model: "llama-3.3-70b",       label: "Groq Llama 3.3" },
  { provider: "groq",       model: "mixtral-8x7b",         label: "Groq Mixtral" },
  { provider: "openrouter", model: "openrouter/auto",      label: "OpenRouter (auto)" },
] as const;

type ModelOption = typeof ALL_MODELS[number];

export class ControlPane {
  private doc: FortressRoomDoc;
  private container: HTMLElement;
  private bridge = WorkerBridge.getInstance();
  private fuelInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor(doc: FortressRoomDoc) {
    this.doc = doc;
    this.container = document.createElement("div");
    this.container.className = "control-pane";
  }

  mount(el: HTMLElement): void {
    const templates = getTemplates(this.doc);
    const roomId = getRoomId(this.doc);

    this.container.innerHTML = `
      <div class="control-section">
        <label>MODEL</label>
        <select id="model-select">
          ${ALL_MODELS.map((m) =>
            `<option value="${m.provider}/${m.model}">${m.label}</option>`
          ).join("")}
        </select>
      </div>
      <div class="control-section">
        <label>SYSTEM PROMPT</label>
        <textarea id="system-prompt" placeholder="Optional system prompt..."></textarea>
      </div>
      <div class="control-section">
        <label>PROMPT</label>
        <textarea id="prompt-input" placeholder="Enter your prompt..."></textarea>
        <button id="btn-generate">GENERATE</button>
        <button id="btn-abort" style="display:none">STOP</button>
      </div>
      ${templates.length > 0 ? `
      <div class="control-section">
        <label>TEMPLATES</label>
        <div class="templates-list">
          ${templates.slice(0, 5).map((t) =>
            `<button class="template-btn" data-template="${this.escapeAttr(t)}">${this.escapeHtml(t.slice(0, 40))}…</button>`
          ).join("")}
        </div>
      </div>
      ` : ""}
      <div class="control-section">
        <label>FUEL</label>
        <div class="fuel-gauge" id="fuel-gauge">
          <div class="fuel-bar">
            <div class="fuel-fill" id="fuel-fill" style="width:100%"></div>
          </div>
          <span class="fuel-label" id="fuel-label">--</span>
        </div>
      </div>
    `;

    el.appendChild(this.container);

    // Generate button
    this.container.querySelector("#btn-generate")?.addEventListener("click", () => this.handleGenerate());
    this.container.querySelector("#prompt-input")?.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") this.handleGenerate();
    });

    // Abort button
    this.container.querySelector("#btn-abort")?.addEventListener("click", () => {
      this.abortController?.abort();
    });

    // Template buttons
    this.container.querySelectorAll(".template-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tmpl = btn.getAttribute("data-template") ?? "";
        const promptEl = this.container.querySelector("#prompt-input") as HTMLTextAreaElement;
        if (promptEl) promptEl.value = tmpl;
      });
    });

    // Start fuel polling
    this.startFuelPolling(roomId);
  }

  destroy(): void {
    if (this.fuelInterval) clearInterval(this.fuelInterval);
    this.abortController?.abort();
  }

  private async handleGenerate(): Promise<void> {
    const promptEl = this.container.querySelector("#prompt-input") as HTMLTextAreaElement;
    const systemEl = this.container.querySelector("#system-prompt") as HTMLTextAreaElement;
    const modelEl = this.container.querySelector("#model-select") as HTMLSelectElement;
    const generateBtn = this.container.querySelector("#btn-generate") as HTMLButtonElement;
    const abortBtn = this.container.querySelector("#btn-abort") as HTMLButtonElement;

    const prompt = promptEl.value.trim();
    if (!prompt) return;

    const [provider, model] = modelEl.value.split("/") as [string, string];
    const systemPrompt = systemEl.value.trim();

    // Create abort controller for this generation
    this.abortController = new AbortController();
    generateBtn.style.display = "none";
    abortBtn.style.display = "inline-block";

    try {
      const outputHash = await this.bridge.requestGenerate(
        { provider, model, prompt, systemPrompt, signal: this.abortController.signal },
        {
          onChunk: (chunk) => {
            appendOutput(this.doc, chunk);
          },
          onDone: async (hash) => {
            console.log("[ControlPane] generation done:", hash);
            generateBtn.style.display = "inline-block";
            abortBtn.style.display = "none";

            // Save receipt
            try {
              await saveReceipt({
                id: `rcp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
                hash,
                model: `${provider}/${model}`,
                timestamp: Date.now(),
                prompt: prompt.slice(0, 200),
              });
            } catch (e) {
              console.warn("[ControlPane] failed to save receipt:", e);
            }
          },
          onError: (code, message) => {
            console.error(`[ControlPane] generation error: ${code} ${message}`);
            generateBtn.style.display = "inline-block";
            abortBtn.style.display = "none";
          },
        }
      );
    } catch (err) {
      console.error("[ControlPane] generation failed:", err);
      generateBtn.style.display = "inline-block";
      abortBtn.style.display = "none";
    }
  }

  private startFuelPolling(roomId: string): void {
    const fillEl = () => this.container.querySelector("#fuel-fill") as HTMLElement | null;
    const labelEl = () => this.container.querySelector("#fuel-label") as HTMLElement | null;

    const poll = async () => {
      try {
        const state = await this.bridge.requestFuelGauge(roomId as any);
        const total = state.participants.reduce((sum: number, p: any) => sum + (p.quota ?? 0), 0);
        const consumed = state.participants.reduce((sum: number, p: any) => sum + (p.consumed ?? 0), 0);
        const pct = total > 0 ? Math.max(0, 100 - (consumed / total * 100)) : 100;
        const fill = fillEl();
        const label = labelEl();
        if (fill) fill.style.width = `${pct}%`;
        if (label) label.textContent = `${state.participants.length} participant(s) · ${pct.toFixed(0)}% fuel`;
      } catch {
        const label = labelEl();
        if (label) label.textContent = "fuel unavailable";
      }
    };

    poll();
    this.fuelInterval = setInterval(poll, 5000);

    // Listen for fuel events too
    const onFuel = (e: Event) => {
      const state = (e as CustomEvent).detail as any;
      const total = state.participants.reduce((sum: number, p: any) => sum + (p.quota ?? 0), 0);
      const consumed = state.participants.reduce((sum: number, p: any) => sum + (p.consumed ?? 0), 0);
      const pct = total > 0 ? Math.max(0, 100 - (consumed / total * 100)) : 100;
      const fill = fillEl();
      const label = labelEl();
      if (fill) fill.style.width = `${pct}%`;
      if (label) label.textContent = `${state.participants?.length ?? 0} participant(s) · ${pct.toFixed(0)}% fuel`;
    };
    window.addEventListener("ff:fuel", onFuel as EventListener);
  }

  private escapeAttr(str: string): string {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
