/**
 * Pure helpers for the plan-deletion audit trail.
 *
 * Extracted so both the write path (`deletePlanAudited` in
 * `plans.functions.ts`) and the read path (`listPlanDeletionAudit` in
 * `plan-deletions.functions.ts`) use one contract for actor + enrollment
 * counts, and so both can be exercised in unit tests without a database.
 */

export type PlanDeletionAction = "plan_delete_blocked" | "plan_delete_success";

export type PlanDeletionCounts = {
  pending: number;
  active: number;
  cancelled: number;
  completed: number;
  blocking: number; // pending + active
  total: number;
};

export type PlanSnapshot = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

export type DeleteErrorLike = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
} | null;

export type PlanDeletionAuditEntry = {
  action: PlanDeletionAction;
  actor_id: string;
  actor_email: string | null;
  target_user_id: string;
  target_email: string | null;
  role_before: null;
  role_after: null;
  reason: null;
  metadata: {
    plan_id: string;
    plan_name: string | null;
    plan_code: null;
    plan_was_active: boolean | null;
    counts: PlanDeletionCounts;
    db_error: {
      message: string | null;
      code: string | null;
      details: string | null;
    } | null;
  };
};

/**
 * Compute the canonical count breakdown for the audit log. `blocking` is
 * always `pending + active` and `total` sums all four status buckets — the
 * exact contract the DB trigger enforces.
 */
export function computeDeletionCounts(raw: {
  pending: number;
  active: number;
  cancelled: number;
  completed: number;
}): PlanDeletionCounts {
  const pending = Math.max(0, raw.pending | 0);
  const active = Math.max(0, raw.active | 0);
  const cancelled = Math.max(0, raw.cancelled | 0);
  const completed = Math.max(0, raw.completed | 0);
  return {
    pending,
    active,
    cancelled,
    completed,
    blocking: pending + active,
    total: pending + active + cancelled + completed,
  };
}

/**
 * Build the exact row we insert into `admin_audit_log` for a plan-delete
 * attempt. `blocked` is derived from the presence of a delete error so a
 * caller cannot accidentally desynchronize the action name from db_error.
 */
export function buildPlanDeletionAuditEntry(input: {
  actorId: string;
  actorEmail: string | null;
  plan: PlanSnapshot;
  counts: PlanDeletionCounts;
  deleteError: DeleteErrorLike;
}): PlanDeletionAuditEntry {
  const blocked = !!input.deleteError;
  const action: PlanDeletionAction = blocked
    ? "plan_delete_blocked"
    : "plan_delete_success";

  return {
    action,
    actor_id: input.actorId,
    actor_email: input.actorEmail,
    target_user_id: input.actorId,
    target_email: input.actorEmail,
    role_before: null,
    role_after: null,
    reason: null,
    metadata: {
      plan_id: input.plan.id,
      plan_name: input.plan.name,
      plan_code: null,
      plan_was_active: input.plan.is_active,
      counts: input.counts,
      db_error: blocked
        ? {
            message: input.deleteError?.message ?? null,
            code: input.deleteError?.code ?? null,
            details: input.deleteError?.details ?? null,
          }
        : null,
    },
  };
}

/**
 * Row shape returned by the list endpoint / rendered in the UI drawer.
 * Duplicated intentionally from `plan-deletions.functions.ts` so this pure
 * module has no server-only imports.
 */
export type PlanDeletionRowView = {
  id: string;
  created_at: string;
  action: PlanDeletionAction;
  actor_id: string;
  actor_email: string | null;
  plan_id: string | null;
  plan_name: string | null;
  counts: PlanDeletionCounts;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

type RawAuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor_id: string;
  actor_email: string | null;
  metadata: unknown;
};

/**
 * Convert a raw `admin_audit_log` row into the view model exposed to the UI.
 * Tolerant of malformed metadata: missing counts default to 0.
 */
export function mapPlanDeletionAuditRow(row: RawAuditRow): PlanDeletionRowView {
  const m = ((row.metadata ?? {}) as Record<string, unknown>) ?? {};
  const rawCounts = (m.counts ?? {}) as Partial<PlanDeletionCounts>;
  const dbErr = m.db_error as { message?: string | null } | null | undefined;

  const counts = computeDeletionCounts({
    pending: Number(rawCounts.pending ?? 0),
    active: Number(rawCounts.active ?? 0),
    cancelled: Number(rawCounts.cancelled ?? 0),
    completed: Number(rawCounts.completed ?? 0),
  });

  return {
    id: row.id,
    created_at: row.created_at,
    action: row.action as PlanDeletionAction,
    actor_id: row.actor_id,
    actor_email: row.actor_email,
    plan_id: (m.plan_id as string) ?? null,
    plan_name: (m.plan_name as string) ?? null,
    counts,
    error_message: dbErr?.message ?? null,
    metadata: m,
  };
}
