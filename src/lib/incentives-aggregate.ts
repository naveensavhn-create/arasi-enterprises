/**
 * Rank incentives are one-time awards granted when a promoter reaches a rank
 * (unique per promoter+rank). They are NEVER a monthly recurring amount, so
 * revenue/dashboard widgets must aggregate them as awarded totals, not
 * monthly averages. This helper is the single source of truth for that math.
 */

export type IncentiveStatus = "pending" | "approved" | "paid" | "rejected";

export type IncentiveRow = {
  amount: number | string | null | undefined;
  status: IncentiveStatus | string | null | undefined;
};

export type IncentiveTotals = {
  /** Count of one-time awards (excluding rejected). */
  count: number;
  /** Total awarded amount (approved + paid + pending). Rejected excluded. */
  total: number;
  /** Amount already paid out. */
  paid: number;
  /** Amount approved but not yet paid. */
  approved: number;
  /** Amount awaiting admin approval. */
  pending: number;
  /** Amount rejected (informational; not part of `total`). */
  rejected: number;
};

function num(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (x == null) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function aggregateOneTimeIncentives(rows: readonly IncentiveRow[] | null | undefined): IncentiveTotals {
  const out: IncentiveTotals = { count: 0, total: 0, paid: 0, approved: 0, pending: 0, rejected: 0 };
  for (const r of rows ?? []) {
    const amt = num(r?.amount);
    const status = (r?.status ?? "pending") as string;
    if (status === "rejected") {
      out.rejected += amt;
      continue;
    }
    out.count += 1;
    out.total += amt;
    if (status === "paid") out.paid += amt;
    else if (status === "approved") out.approved += amt;
    else out.pending += amt;
  }
  return out;
}
