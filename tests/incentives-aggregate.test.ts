/**
 * Locks the one-time rank incentive aggregator used by revenue/dashboard
 * widgets. Rank incentives are one-time (unique per promoter+rank) —
 * regressions to any "monthly average / per-period" math would silently
 * misreport totals across the admin dashboard, exports, and analytics.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateOneTimeIncentives,
  type IncentiveRow,
} from "@/lib/incentives-aggregate";

describe("aggregateOneTimeIncentives", () => {
  it("returns zeros for empty / null / undefined input", () => {
    for (const input of [null, undefined, [] as IncentiveRow[]]) {
      expect(aggregateOneTimeIncentives(input)).toEqual({
        count: 0,
        total: 0,
        paid: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
      });
    }
  });

  it("sums awarded amounts once per row (no per-month multiplication)", () => {
    const rows: IncentiveRow[] = [
      { amount: 5000, status: "paid" },
      { amount: 2500, status: "approved" },
      { amount: 1000, status: "pending" },
    ];
    const t = aggregateOneTimeIncentives(rows);
    expect(t.count).toBe(3);
    expect(t.total).toBe(8500);
    expect(t.paid).toBe(5000);
    expect(t.approved).toBe(2500);
    expect(t.pending).toBe(1000);
    // Sanity: the total is NOT multiplied by any month count. If someone
    // reintroduces monthly math, this equality breaks.
    expect(t.total).toBe(t.paid + t.approved + t.pending);
  });

  it("excludes rejected awards from total / count, tracks them separately", () => {
    const t = aggregateOneTimeIncentives([
      { amount: 3000, status: "paid" },
      { amount: 2000, status: "rejected" },
    ]);
    expect(t.count).toBe(1);
    expect(t.total).toBe(3000);
    expect(t.rejected).toBe(2000);
  });

  it("coerces string amounts and treats missing status as pending", () => {
    const t = aggregateOneTimeIncentives([
      { amount: "1500.50", status: "paid" },
      { amount: "750", status: null },
      { amount: null, status: "approved" },
      { amount: "not-a-number", status: "paid" },
    ]);
    expect(t.paid).toBe(1500.5);
    expect(t.pending).toBe(750);
    expect(t.approved).toBe(0);
    expect(t.count).toBe(4);
    expect(t.total).toBe(2250.5);
  });
});
