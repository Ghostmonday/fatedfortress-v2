/**
 * apps/web/src/pages/project.ts — Project detail + activity feed + audit log.
 */

import { getSupabase } from "../auth/index.js";
import { requireAuth } from "../auth/middleware.js";

export async function mountProject(container: HTMLElement, projectId: string): Promise<() => void> {
  requireAuth();

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return () => {};

  container.innerHTML = `<div class="project-page">
    <div class="project-loading">Loading project...</div>
  </div>`;

  // ── Fetch ──────────────────────────────────────────────────────────────
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) {
    container.innerHTML = `<div class="project-page"><p>Project not found.</p></div>`;
    return () => {};
  }

  const isHost = project.host_id === user.id;

  const [{ data: tasks }, { data: wallet }, { data: auditLogRaw }] = await Promise.all([
    supabase.from("tasks").select("*").eq("project_id", projectId).order("created_at"),
    supabase.from("project_wallet").select("*").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("audit_log")
      .select("*")
      .in(
        "task_id",
        // Fetch task IDs for this project first
        supabase.from("tasks").select("id").eq("project_id", projectId)
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const taskList = tasks ?? [];
  // Filter out nulls from the flat in() result
  const taskIds = taskList.map((t: Record<string, unknown>) => t.id as string);

  const { data: auditLog } = await supabase
    .from("audit_log")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false })
    .limit(50);

  const logs = (auditLog ?? []).filter(Boolean);

  // Compute wallet available = deposited - locked - released
  const walletDeposited = wallet?.deposited ?? 0;
  const walletLocked = wallet?.locked ?? 0;
  const walletReleased = wallet?.released ?? 0;
  const walletAvailable = walletDeposited - walletLocked - walletReleased;

  // ── Render ──────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="project-page">
      <header class="project-header">
        <a href="${isHost ? "/reviews" : "/tasks"}" class="back-link">← Back</a>
        <div class="project-header__main">
          <h1 class="project-title">${escHtml(project.title)}</h1>
          <span class="project-status status--${project.status}">${project.status}</span>
        </div>
        <p class="project-desc">${escHtml(project.description ?? "")}</p>
        <div class="project-meta">
          <span class="meta-chip">Wallet: $${walletDeposited} deposited · $${walletLocked} locked · $${walletReleased} released · $${walletAvailable} available</span>
          <span class="meta-chip">${taskList.length} tasks</span>
          <span class="meta-chip">${taskList.filter((t: Record<string, unknown>) => t.status === "paid").length} completed</span>
        </div>
      </header>

      <div class="project-sections">
        <section class="project-tasks">
          <h2>Tasks</h2>
          <div class="tasks-list">
            ${taskList.length === 0 ? "<p>No tasks yet.</p>" : taskList.map((t: Record<string, unknown>) => `
              <div class="task-row" data-task-id="${t.id}">
                <div class="task-row__info">
                  <span class="task-row__title">${escHtml(t.title as string)}</span>
                  <span class="task-row__payout">$${t.payout_min}–$${t.payout_max}</span>
                </div>
                <div class="task-row__right">
                  <span class="status-chip status--${t.status}">${(t.status as string).replace("_", " ")}</span>
                  ${isHost && t.status === "under_review" ? `<a class="btn btn--sm btn--ghost" href="/reviews">Review</a>` : ""}
                  ${!isHost && t.claimed_by === user.id && t.status === "claimed" ? `<a class="btn btn--sm btn--primary" href="/submit/${t.id}">Submit</a>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="project-audit">
          <h2>Activity Feed</h2>
          <div class="audit-list">
            ${logs.length === 0 ? "<p>No activity yet.</p>" : logs.map((l: Record<string, unknown>) => `
              <div class="audit-entry">
                <span class="audit-entry__action">${l.action as string}</span>
                <span class="audit-entry__time">${new Date(l.created_at as string).toLocaleString()}</span>
                ${l.payload ? `<pre class="audit-entry__payload">${escHtml(JSON.stringify(l.payload, null, 2))}</pre>` : ""}
              </div>
            `).join("")}
          </div>
        </section>
      </div>
    </div>
  `;

  return () => {};
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
