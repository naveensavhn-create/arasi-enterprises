/**
 * Pure helpers for the plan-delete UI precheck.
 *
 * Kept in a component-free module so integration tests can exercise the
 * exact same logic the admin UI uses — and so the DB-trigger safety net
 * has a matching client-side gate.
 *
 * A plan is "blocking" if any membership referencing it is in a status
 * that the DB trigger `prevent_plan_delete_with_memberships` also treats
 * as blocking, namely `pending` or `active`.
 */

export type BlockingStatus = "pending" | "active";
export const BLOCKING_STATUSES: readonly BlockingStatus[] = ["pending", "active"] as const;

export type MembershipRow = { plan_id: string | null; status: string | null };

/** Count `pending`+`active` memberships per plan_id. */
export function computePlanUsage(rows: readonly MembershipRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.plan_id || !row.status) continue;
    if (!(BLOCKING_STATUSES as readonly string[]).includes(row.status)) continue;
    counts[row.plan_id] = (counts[row.plan_id] ?? 0) + 1;
  }
  return counts;
}

export function usageFor(usage: Record<string, number> | undefined, planId: string): number {
  return usage?.[planId] ?? 0;
}

export function isDeleteBlocked(
  usage: Record<string, number> | undefined,
  planId: string,
): boolean {
  return usageFor(usage, planId) > 0;
}
