// apps/web/src/pages/connect.ts
import { WorkerBridge } from "../net/worker-bridge.js";

const PROVIDERS = ["openai", "anthropic", "google", "minimax", "groq", "openrouter"] as const;

export function mountConnect(container: HTMLElement): () => void {
  container.innerHTML = `
    <div class="connect-header">
      <h1>CONNECT API KEYS</h1>
      <p>Add your API key to participate in rooms</p>
    </div>
    <div class="provider-list" id="provider-list">
      ${PROVIDERS.map(p => `
        <div class="provider-row" data-provider="${p}">
          <label>${p.toUpperCase()}</label>
          <input type="password" placeholder="sk-..." data-provider="${p}" />
          <button class="btn-save" data-provider="${p}">SAVE</button>
          <span class="status-msg" data-provider="${p}"></span>
        </div>
      `).join("")}
    </div>
    <div class="connect-footer">
      <p>Keys are stored encrypted in your browser. Never sent to our servers.</p>
    </div>
  `;

  const bridge = WorkerBridge.getInstance();

  container.querySelectorAll(".btn-save").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const provider = (e.target as HTMLElement).dataset.provider!;
      const input = container.querySelector(`input[data-provider="${provider}"]`) as HTMLInputElement;
      const status = container.querySelector(`.status-msg[data-provider="${provider}"]`) as HTMLElement;
      const key = input.value.trim();

      if (!key) {
        status.textContent = "Please enter a key";
        return;
      }

      try {
        await bridge.storeKey(provider, key);
        status.textContent = "Saved!";
        input.value = "";
      } catch (err) {
        status.textContent = `Error: ${err}`;
      }
    });
  });

  return () => { container.innerHTML = ""; };
}
