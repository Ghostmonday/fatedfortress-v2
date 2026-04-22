/**
 * apps/web/src/pages/create.ts — Host project creation + SCOPE button.
 *
 * Sacred objects: Task, Submission, Decision
 *
 * Flow:
 * 1. Host fills brief (title, description, projectType, references, budget range)
 * 2. Host clicks SCOPE → generateScopedTasks(intent) → ScopedTask[] + readmeDraft + folderStructure
 * 3. Host reviews, edits payout within AI range, publishes
 * 4. Project status = 'active', project_wallet row created (deposited = 0)
 */

import { getSupabase } from "../auth/index.js";
import { requireAuth } from "../auth/middleware.js";
import { generateScopedTasks, writeScopedTasks } from "../handlers/scope.js";
import type { ScopedTask } from "@fatedfortress/protocol";

export async function mountCreate(container: HTMLElement): Promise<() => void> {
  requireAuth();

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return () => {};

  container.innerHTML = `
    <div class="create-page">
      <header class="create-header">
        <h1 class="create-title">Create Project</h1>
        <p class="create-subtitle">Describe your project and AI will break it into actionable tasks.</p>
      </header>

      <form class="create-form" id="create-form">
        <div class="form-field">
          <label for="project-title">Project title</label>
          <input type="text" id="project-title" required placeholder="e.g. Landing page redesign" maxlength="120" />
        </div>

        <div class="form-field">
          <label for="project-description">Brief description</label>
          <textarea id="project-description" rows="4" required placeholder="Describe what you need, context, goals, constraints..." maxlength="2000"></textarea>
          <span class="char-count"><span id="desc-count">0</span>/2000</span>
        </div>

        <div class="form-field">
          <label for="project-type">Project type</label>
          <select id="project-type" required>
            <option value="">Select type...</option>
            <option value="code">Code / Engineering</option>
            <option value="design">Design</option>
            <option value="writing">Writing / Copy</option>
            <option value="audio">Audio / Music</option>
            <option value="video">Video / Animation</option>
            <option value="3d">3D / Modeling</option>
            <option value="general">General</option>
          </select>
        </div>

        <div class="form-field form-field--row">
          <div class="form-field">
            <label for="budget-min">Min budget (USD)</label>
            <input type="number" id="budget-min" min="1" step="0.01" placeholder="e.g. 100.00" required />
          </div>
          <div class="form-field">
            <label for="budget-max">Max budget (USD)</label>
            <input type="number" id="budget-max" min="1" step="0.01" placeholder="e.g. 500.00" required />
          </div>
        </div>

        <div class="form-field">
          <label for="target-timeline">Target timeline (optional)</label>
          <input type="text" id="target-timeline" placeholder="e.g. 2 weeks, end of month" />
        </div>

        <div class="form-field">
          <label>Reference files (optional)</label>
          <div class="file-list" id="file-list"></div>
          <button type="button" class="btn btn--ghost" id="add-ref-btn">+ Add reference</button>
          <input type="file" id="ref-input" class="hidden" multiple accept="image/*,.pdf,.txt,.md" />
        </div>

        <div class="create-actions">
          <button type="submit" class="btn btn--primary btn--lg" id="scope-btn">
            <span class="btn-text">SCOPE</span>
            <span class="btn-loading hidden">Generating tasks...</span>
          </button>
        </div>
      </form>

      <!-- Scoped tasks preview -->
      <div class="scoped-preview hidden" id="scoped-preview">
        <div class="scoped-preview__readme" id="scoped-readme"></div>
        <div class="scoped-preview__structure" id="scoped-structure"></div>
        <h2 class="scoped-preview__title">Generated Tasks</h2>
        <p class="scoped-preview__subtitle">Review and set final payouts, then publish.</p>
        <div class="scoped-tasks" id="scoped-tasks"></div>
        <div class="scoped-preview__actions">
          <button class="btn btn--ghost" id="re-scope-btn">Regenerate</button>
          <button class="btn btn--primary btn--lg" id="publish-btn">Publish Tasks</button>
        </div>
      </div>
    </div>
  `;

  // ── State ─────────────────────────────────────────────────────────
  let generatedTasks: ScopedTask[] = [];
  let generatedReadme = "";
  let generatedFolderStructure: string[] = [];
  let projectId: string | null = null;
  let references: string[] = [];

  // ── Events ───────────────────────────────────────────────────────────
  const $form = container.querySelector("#create-form") as HTMLFormElement;
  const $scopeBtn = container.querySelector("#scope-btn") as HTMLButtonElement;
  const $btnText = container.querySelector(".btn-text") as HTMLElement;
  const $btnLoading = container.querySelector(".btn-loading") as HTMLElement;
  const $preview = container.querySelector("#scoped-preview") as HTMLElement;
  const $taskList = container.querySelector("#scoped-tasks") as HTMLElement;
  const $readme = container.querySelector("#scoped-readme") as HTMLElement;
  const $structure = container.querySelector("#scoped-structure") as HTMLElement;

  $form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!$scopeBtn.disabled) await handleScope();
  });

  container.querySelector("#publish-btn")?.addEventListener("click", handlePublish);
  container.querySelector("#re-scope-btn")?.addEventListener("click", handleScope);

  const $descTextarea = container.querySelector("#project-description") as HTMLTextAreaElement;
  $descTextarea.addEventListener("input", () => {
    (container.querySelector("#desc-count") as HTMLElement).textContent = String($descTextarea.value.length);
  });

  // ── Handle SCOPE ────────────────────────────────────────────────────
  async function handleScope(): Promise<void> {
    const title = ($form.querySelector("#project-title") as HTMLInputElement).value.trim();
    const description = ($form.querySelector("#project-description") as HTMLTextAreaElement).value.trim();
    const projectType = ($form.querySelector("#project-type") as HTMLSelectElement).value;
    const budgetMin = parseFloat(($form.querySelector("#budget-min") as HTMLInputElement).value);
    const budgetMax = parseFloat(($form.querySelector("#budget-max") as HTMLInputElement).value);
    const targetTimeline = ($form.querySelector("#target-timeline") as HTMLInputElement).value.trim();

    if (!title || !description || !projectType || isNaN(budgetMin) || isNaN(budgetMax) || budgetMin <= 0 || budgetMax < budgetMin) {
      alert("Please fill in all required fields correctly");
      return;
    }

    setLoading(true);

    try {
      // 1. Create project (no budget_reserved — wallet is separate)
      const { data: project, error: projErr } = await supabase
        .from("projects")
        .insert({
          host_id: user.id,
          title,
          description,
          references_urls: references,
          status: "draft",
        } as Record<string, unknown>)
        .select()
        .single();

      if (projErr || !project) throw new Error(`Project creation failed: ${projErr?.message}`);
      projectId = (project as Record<string, unknown>).id as string;

      // 2. Call SCOPE AI with ScopeProjectIntent
      const result = await generateScopedTasks({
        projectId,
        title,
        description,
        projectType,
        referenceUrls: references,
        budgetRange: { min: budgetMin, max: budgetMax },
        targetTimeline: targetTimeline || undefined,
      });

      generatedTasks = result.tasks;
      generatedReadme = result.readmeDraft;
      generatedFolderStructure = result.folderStructure;

      if (generatedTasks.length === 0) {
        throw new Error("No tasks generated");
      }

      // 3. Write draft tasks
      await writeScopedTasks(projectId, generatedTasks, user.id);

      // 4. Show preview
      renderTaskPreview();
      $preview.classList.remove("hidden");
      $form.classList.add("hidden");
    } catch (err: unknown) {
      alert(`SCOPE failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Publish ───────────────────────────────────────────────────
  async function handlePublish(): Promise<void> {
    if (!projectId) return;

    const $payoutInputs = $taskList.querySelectorAll(".task-payout-input") as NodeListOf<HTMLInputElement>;
    const updates: Promise<unknown>[] = [];

    $payoutInputs.forEach((input, i) => {
      const taskId = input.dataset.taskId!;
      const payout = parseFloat(input.value);
      const task = generatedTasks[i];
      if (!isNaN(payout) && task && payout >= task.payoutMin && payout <= task.payoutMax) {
        updates.push(
          supabase
            .from("tasks")
            .update({
              status: "open",
              payout_max: payout,
              updated_at: new Date().toISOString(),
            } as Record<string, unknown>)
            .eq("id", taskId)
        );
      }
    });

    await Promise.all(updates);

    // Publish project
    await supabase
      .from("projects")
      .update({ status: "active", updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq("id", projectId);

    // Create project_wallet row with deposited = 0 (Section 3.2)
    await supabase
      .from("project_wallet")
      .insert({ project_id: projectId, deposited: 0, locked: 0, released: 0 } as Record<string, unknown>);

    // Audit log
    await supabase.from("audit_log").insert({
      actor_id: user.id,
      task_id: null,
      action: "task_published",
      payload: { projectId, count: generatedTasks.length },
    } as Record<string, unknown>);

    window.location.href = `/project/${projectId}`;
  }

  // ── Render task preview ───────────────────────────────────────────────
  function renderTaskPreview(): void {
    if (generatedReadme) {
      $readme.innerHTML = `
        <h3>README Draft</h3>
        <pre class="readme-draft">${escHtml(generatedReadme)}</pre>
      `;
    }

    if (generatedFolderStructure.length > 0) {
      $structure.innerHTML = `
        <h3>Suggested Folder Structure</h3>
        <ul class="folder-structure">
          ${generatedFolderStructure.map(f => `<li>${escHtml(f)}</li>`).join("")}
        </ul>
      `;
    }

    $taskList.innerHTML = generatedTasks.map((t, i) => `
      <div class="scoped-task">
        <div class="scoped-task__header">
          <span class="scoped-task__number">${i + 1}</span>
          <h3 class="scoped-task__title">${escHtml(t.title)}</h3>
          <span class="scoped-task__type">${escHtml(t.deliverableType)}</span>
          <span class="scoped-task__time">~${t.estimatedMinutes}min</span>
          <span class="scoped-task__role">${escHtml(t.suggestedRole)}</span>
          <span class="scoped-task__ambiguity ambiguity--${t.ambiguityScore > 0.7 ? "high" : t.ambiguityScore > 0.4 ? "med" : "low"}">
            ${t.ambiguityScore > 0.7 ? "High" : t.ambiguityScore > 0.4 ? "Med" : "Low"} ambiguity
          </span>
        </div>
        <p class="scoped-task__desc">${escHtml(t.description)}</p>
        <div class="scoped-task__payout">
          <label>Payout ($${t.payoutMin}–$${t.payoutMax})</label>
          <input type="number" class="task-payout-input"
            data-task-id="${projectId}-task-${i}"
            value="${((t.payoutMin + t.payoutMax) / 2).toFixed(2)}"
            min="${t.payoutMin}" max="${t.payoutMax}" step="0.01" />
        </div>
      </div>
    `).join("");
  }

  function setLoading(loading: boolean): void {
    $scopeBtn.disabled = loading;
    $btnText.classList.toggle("hidden", loading);
    $btnLoading.classList.toggle("hidden", !loading);
  }

  container.querySelector("#add-ref-btn")?.addEventListener("click", () => {
    (container.querySelector("#ref-input") as HTMLInputElement)?.click();
  });

  return () => {};
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
