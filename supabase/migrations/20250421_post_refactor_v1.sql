-- ============================================================================
-- Post-Refactor v1 Migration
-- Apply before any handler or page changes.
-- Order: schema corrections → notifications.type → invitations → decisions
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. project_wallet (replaces budget_reserved)
-- --------------------------------------------------------------------------

create table if not exists public.project_wallet (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  deposited decimal not null default 0,
  locked decimal not null default 0,
  released decimal not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_wallet enable row level security;

-- One wallet per project
create unique index if not exists idx_project_wallet_project_id on public.project_wallet(project_id);

-- Host and contributors on active tasks can read wallet
create policy "Wallet viewable by host and active contributors"
  on public.project_wallet for select
  using (
    auth.uid() = (select host_id from public.projects where id = project_id)
    or exists (
      select 1 from public.tasks t
      where t.project_id = project_id and t.claimed_by = auth.uid()
    )
  );

-- Only host can mutate wallet
create policy "Hosts can manage wallet"
  on public.project_wallet for all
  using (auth.uid() = (select host_id from public.projects where id = project_id));

-- --------------------------------------------------------------------------
-- 2. Drop budget_reserved from projects (data already migrated to project_wallet)
-- --------------------------------------------------------------------------

alter table public.projects drop column if exists budget_reserved;

-- --------------------------------------------------------------------------
-- 3. decisions (authoritative record for every host review action)
-- --------------------------------------------------------------------------

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  host_id uuid not null references public.profiles(id),
  decision_reason text not null
    check (decision_reason in (
      'requirements_not_met', 'quality_issue', 'scope_mismatch',
      'missing_files', 'great_work', 'approved_fast_track'
    )),
  review_notes text,
  structured_feedback jsonb,
  approved_payout decimal,
  revision_deadline timestamptz,
  created_at timestamptz not null default now()
);

alter table public.decisions enable row level security;

create policy "Decisions viewable by task participants"
  on public.decisions for select
  using (
    auth.uid() = host_id
    or auth.uid() = (select contributor_id from public.submissions where id = submission_id)
    or auth.uid() = (select claimed_by from public.tasks where id = (select task_id from public.submissions where id = submission_id))
  );

create policy "Hosts can insert decisions"
  on public.decisions for insert
  with check (
    auth.uid() = host_id
  );

-- Index for fast lookups by submission
create index if not exists idx_decisions_submission_id on public.decisions(submission_id);
create index if not exists idx_decisions_host_id on public.decisions(host_id);

-- --------------------------------------------------------------------------
-- 4. Remove decision_reason / review_notes from submissions
-- (moved to decisions table; tasks.approved_payout remains as denorm cache)
-- --------------------------------------------------------------------------

alter table public.submissions
  drop column if exists decision_reason,
  drop column if exists review_notes;

-- --------------------------------------------------------------------------
-- 5. Fix broken submissions exclude constraint (references non-existent status col)
-- The constraint intent was: one non-terminal submission per task.
-- We implement this as a partial unique index instead.
-- --------------------------------------------------------------------------

drop constraint if exists submissions_task_id_excl;

-- One active (non-paid/non-rejected) submission per task
create unique index if not exists idx_submissions_one_active_per_task
  on public.submissions(task_id)
  where status not in ('paid', 'rejected');

-- NOTE: submissions no longer has a status column. Active submission tracking
-- is derived from task status. This index prevents accidental double-submission
-- at the DB level while a task is in a non-terminal state.

-- --------------------------------------------------------------------------
-- 6. Extend deliverable_type to full set
-- --------------------------------------------------------------------------

alter table public.submissions
  drop constraint if exists submissions_deliverable_type_check;

alter table public.submissions
  add constraint submissions_deliverable_type_check
  check (deliverable_type in (
    'file', 'pr', 'code_patch', 'design_asset', 'text',
    'audio', 'video', '3d_model', 'figma_link'
  ));

-- --------------------------------------------------------------------------
-- 7. project_templates + projects.template_id
-- --------------------------------------------------------------------------

create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

alter table public.project_templates enable row level security;

create policy "Project templates viewable by all"
  on public.project_templates for select using (true);

create policy "Hosts can manage templates"
  on public.project_templates for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'host'));

alter table public.projects add column if not exists template_id uuid;

-- FK constraint added separately to avoid double-add if column already exists
do $$
begin
  if not exists (
    select 1 from information_code.columns c
    where c.table_name = 'projects' and c.column_name = 'template_id'
    and c.table_schema = 'public'
  ) then
    execute 'alter table public.projects add constraint projects_template_id_fkey
            foreign key (template_id) references public.project_templates(id)';
  end if;
exception when undefined_column then null;
end;
$$;

-- --------------------------------------------------------------------------
-- 8. Expand notifications.type to full Section 8 enum
-- --------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'task_claimed',
    'submission_received',
    'revision_requested',
    'payment_released',
    'submission_rejected',
    'claim_expired',
    'verification_failed',
    'auto_release_warning',
    'auto_released'
  ));

-- --------------------------------------------------------------------------
-- 9. invitations table
-- --------------------------------------------------------------------------

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  invited_email text,
  invited_user_id uuid references public.profiles(id) on delete set null,
  token text not null unique,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;

-- Invitations viewable by host and invitee
create policy "Invitations viewable by host and invitee"
  on public.invitations for select
  using (
    auth.uid() = invited_user_id
    or auth.uid() = (select host_id from public.projects where id = project_id)
  );

-- Hosts create invitations
create policy "Hosts can create invitations"
  on public.invitations for insert
  with check (
    auth.uid() = (select host_id from public.projects where id = project_id)
    or (
      task_id is not null
      and auth.uid() = (select host_id from public.projects where id = (select project_id from public.tasks where id = task_id))
    )
  );

-- Invitees can accept (set accepted_at)
create policy "Invitees can accept invitations"
  on public.invitations for update
  using (auth.uid() = invited_user_id);

create index if not exists idx_invitations_task_id on public.invitations(task_id);
create index if not exists idx_invitations_token on public.invitations(token);
create index if not exists idx_invitations_invited_user_id on public.invitations(invited_user_id) where accepted_at is null;

-- --------------------------------------------------------------------------
-- 10. Update audit_log action enum to cover all transitions
-- --------------------------------------------------------------------------

alter table public.audit_log
  drop constraint if exists audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'claimed',
    'submitted',
    'approved',
    'rejected',
    'payment_released',
    'revision_requested',
    'task_created',
    'task_published',
    'verification_failed',
    'auto_released',
    'claim_expired'
  ));
