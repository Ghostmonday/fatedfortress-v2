/**
 * apps/web/src/pages/tasks.ts — Contributor task listing + claim flow.
 *
 * Sacred objects: Task, Submission, Decision
 *
 * Task visibility: task_access = 'public' OR host OR claimed_by OR
 *   has accepted invitation (invitations.accepted_at is not null).
 * Claim requires: task_access = 'public' OR valid accepted invitation.
 * Invitation token passed via ?invite=<token> URL param on the claim flow.
 */

import { getSupabase } from "../auth/index.js";
import { requireAuth } from "../auth/middleware.js";
import type { Task } from "@fatedfortress/protocol";

const SOFT_LOCK_HOURS = 24;

export async function mountTasks(container: HTMLElement): Promise<() => void> {
  requireAuth();

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return () => {};

  container.innerHTML = `
    <div class="tasks-page">
      <header class="tasks-header">
        <h1 class="tasks-title">Available Tasks</h1>
        <p class="tasks-subtitle">Start working on open tasks</p>
      </header>

      <div class="tasks-filters">
        <button class="filter-btn active" data-filter="open">Open</button>
        <button class="filter-btn" data-filter="claimed">My Claims</button>
        <button class="filter-btn" data-filter="submitted">Submitted</button>
      </div>

      <div class="tasks-list" id="tasks-list">
        <div class="tasks-loading">Loading tasks...</div>
      </div>
    </div>
  `;

  let currentFilter = "open";
  let allTasks: Record<string, unknown>[] = [];
  let pollInterval: ReturnType<typeof setInterval>;

  async function fetchTasks(): Promise<void> {
    // Invitation-aware query: show tasks that are public, or where user
    // has an accepted invitation, or where user is the host.
    // We fetch open tasks and filter client-side for simplicity; for large
    // scale this should move to an RPC or a DB view.
    const { data, error } = await supabase
      .from("tasks")
      .select(`
        *,
        project:projects(id, title, host_id, host:profiles(display_name, review_reliability))
      `)
      .in("status", ["open", "claimed", "submitted", "under_review", "revision_requested"])
      .order("created_at", { ascending: false });

    if (error) {
      (container.querySelector("#tasks-list") as HTMLElement).innerHTML = `<p class="tasks-error">Failed to load tasks.</p>`;
      return;
    }

    // Client-side invitation filter
    const { data: invitations } = await supabase
      .from("invitations")
      .select("task_id, accepted_at")
      .eq("invited_user_id", user.id)
      .not("accepted_at", "is", null);

    const invitedTaskIds = new Set((invitations ?? []).map((i: Record<string, unknown>) => i.task_id as string));

    allTasks = (data ?? []).filter((t: Record<string, unknown>) => {
      const isPublic = t.task_access === "public";
      const isHost = (t.project as Record<string, unknown>)?.host_id === user.id;
      const isClaimedByMe = t.claimed_by === user.id;
      const isInvited = invitedTaskIds.has(t.id as string);
      return isPublic || isHost || isClaimedByMe || isInvited;
    });

    render();
  }

  function render(): void {
    const $list = container.querySelector("#tasks-list") as HTMLElement;

    let filtered: Record<string, unknown>[];
    if (currentFilter === "claimed") {
      filtered = allTasks.filter(t => t.claimed_by === user!.id);
    } else if (currentFilter === "submitted") {
      filtered = allTasks.filter(t =>
        t.claimed_by === user!.id &&
        ["submitted", "under_review", "revision_requested"].includes(t.status as string)
      );
    } else {
      filtered = allTasks.filter(t => t.status === "open");
    }

    if (filtered.length === 0) {
      $list.innerHTML = `<div class="tasks-empty">
        <p>No ${currentFilter === "open" ? "open tasks" : currentFilter + " tasks"} right now.</p>
        ${currentFilter === "open" ? `<p>Check back soon or <a href="/create">create a project</a>.</p>` : ""}
      </div>`;
      return;
    }

    $list.innerHTML = filtered.map(t => renderTaskCard(t)).join("");

    $list.querySelectorAll(".claim-btn, .submit-btn, .view-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const taskId = (e.currentTarget as HTMLElement).dataset.taskId!;
        const action = (e.currentTarget as HTMLElement).dataset.action!;
        await handleAction(taskId, action);
      });
    });
  }

  function renderTaskCard(t: Record<string, unknown>): string {
    const isMyClaim = t.claimed_by === user!.id;
    const isOpen = t.status === "open";
    const softLockExpired = t.soft_lock_expires_at && new Date(t.soft_lock_expires_at as string) < new Date();
    const canClaim = isOpen && !isMyClaim;
    const canReclaim = isOpen && !isMyClaim && softLockExpired;

    const host = (t.project as Record<string, unknown>)?.host as Record<string, unknown> | undefined;
    const hostName = host?.display_name ?? "Unknown host";
    const hostReliability = host?.review_reliability ?? 0;
    const ambiguityScore = t.ambiguity_score as number | null;
    const ambiguityLabel = ambiguityScore != null
      ? (ambiguityScore > 0.7 ? "High ambiguity" : ambiguityScore > 0.4 ? "Medium ambiguity" : "Low ambiguity")
      : "";

    return `
      <div class="task-card" data-task-id="${t.id}">
        <div class="task-card__header">
          <h3 class="task-card__title">${escHtml(t.title as string)}</h3>
          <span class="task-card__status status--${t.status}">${(t.status as string).replace("_", " ")}</span>
        </div>

        <p class="task-card__desc">${escHtml(((t.description as string) ?? "").slice(0, 200))}${(t.description as string)?.length > 200 ? "..." : ""}</p>

        <div class="task-card__meta">
          <span class="meta-chip">$${t.payout_min}–$${t.payout_max}</span>
          <span class="meta-chip">~${t.estimated_minutes ?? "?"}min</span>
          ${ambiguityScore ? `<span class="meta-chip ${ambiguityScore > 0.6 ? "meta-chip--warn" : ""}">${ambiguityLabel}</span>` : ""}
          <span class="meta-chip">${hostName}${hostReliability > 0 ? ` · ${Math.round(+hostReliability * 100)}% reliable` : ""}</span>
        </div>

        <div class="task-card__actions">
          ${canClaim ? `<button class="btn btn--primary claim-btn" data-task-id="${t.id}" data-action="claim">Start Task</button>` : ""}
          ${canReclaim ? `<button class="btn btn--primary claim-btn" data-task-id="${t.id}" data-action="claim">Reclaim (expired)</button>` : ""}
          ${isMyClaim && t.status === "claimed" ? `<a class="btn btn--primary submit-btn" data-task-id="${t.id}" data-action="submit" href="/submit/${t.id}">Submit Deliverable</a>` : ""}
          ${isMyClaim && ["submitted","under_review","revision_requested"].includes(t.status as string) ? `<button class="btn btn--ghost view-btn" data-task-id="${t.id}" data-action="view">View Submission</button>` : ""}
          ${!isMyClaim && !isOpen && !canReclaim ? `<span class="task-card__locked">${t.status === "claimed" ? "Being worked on" : t.status}</span>` : ""}
        </div>

        ${t.soft_lock_expires_at && isMyClaim ? `
          <div class="task-card__lock">
            Soft lock: expires ${new Date(t.soft_lock_expires_at as string).toLocaleString()}
          </div>` : ""}
      </div>
    `;
  }

  async function handleAction(taskId: string, action: string): Promise<void> {
    if (action === "claim") {
      // Read invitation token from URL if present
      const urlParams = new URLSearchParams(window.location.search);
      const invitationToken = urlParams.get("invite");

      // If task is invite-only, validate invitation
      if (invitationToken) {
        const { data: invitation } = await supabase
          .from("invitations")
          .select("id, task_id, invited_user_id, accepted_at, expires_at")
          .eq("token", invitationToken)
          .maybeSingle();

        if (!invitation || new Date(invitation.expires_at) < new Date()) {
          alert("Invalid or expired invitation link.");
          return;
        }

        if (invitation.accepted_at) {
          alert("Invitation already used.");
          return;
        }

        // Accept invitation
        await supabase
          .from("invitations")
          .update({ accepted_at: new Date().toISOString() } as Record<string, unknown>)
          .eq("id", invitation.id);
      }

      const expiresAt = new Date(Date.now() + SOFT_LOCK_HOURS * 60 * 60 * 1000).toISOString();

      const { error } = await supabase
        .from("tasks")
        .update({
          status: "claimed",
          claimed_by: user!.id,
          claimed_at: new Date().toISOString(),
          soft_lock_expires_at: expiresAt,
        } as Record<string, unknown>)
        .eq("id", taskId)
        .eq("status", "open");

      if (error) {
        alert("Failed to claim task — it may have been taken by someone else.");
        await fetchTasks();
        return;
      }

      // Audit log
      await supabase.from("audit_log").insert({
        actor_id: user!.id,
        task_id: taskId,
        action: "claimed",
        payload: { expiresAt },
      } as Record<string, unknown>);

      // Notify host
      const { data: task } = await supabase
        .from("tasks")
        .select("project:projects(host_id)")
        .eq("id", taskId)
        .single();

      if (task) {
        const hostId = (task as Record<string, unknown>).project as Record<string, unknown>;
        await supabase.from("notifications").insert({
          user_id: hostId?.host_id,
          type: "task_claimed",
          task_id: taskId,
        } as Record<string, unknown>);
      }

      await fetchTasks();
    }
  }

  container.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = (btn as HTMLElement).dataset.filter!;
      render();
    });
  });

  await fetchTasks();
  pollInterval = setInterval(fetchTasks, 30_000);

  return () => clearInterval(pollInterval);
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
