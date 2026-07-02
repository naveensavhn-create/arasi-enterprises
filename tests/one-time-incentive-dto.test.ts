/**
 * Locks the API-facing shape of rank incentives as ONE-TIME awards.
 *
 * Guards two regressions that would silently reintroduce monthly semantics:
 *   1. The admin `rankSchema` DTO must accept `one_time_incentive` and
 *      reject the legacy `monthly_incentive` field.
 *   2. The promoter dashboard DTO returned by `getMyPromoterDashboard`
 *      must expose the current rank's `oneTimeIncentive` (never
 *      `monthlyIncentive`).
 */

import { describe, expect, it, expectTypeOf } from "vitest";
import { rankSchema, type PromoterDashboard, type Rank } from "@/lib/commissions.functions";

describe("rankSchema — one-time incentive DTO", () => {
  it("accepts a rank payload with one_time_incentive", () => {
    const parsed = rankSchema.parse({
      code: "GOLD",
      name: "Gold",
      tier_order: 3,
      min_active_customers: 25,
      commission_percent: 12,
      one_time_incentive: 5000,
      gift_name: "Watch",
      is_active: true,
    });
    expect(parsed.one_time_incentive).toBe(5000);
  });

  it("rejects the legacy monthly_incentive field (no silent aliasing)", () => {
    const result = rankSchema.safeParse({
      code: "GOLD",
      name: "Gold",
      tier_order: 3,
      min_active_customers: 25,
      commission_percent: 12,
      monthly_incentive: 5000,
      is_active: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative incentive amounts", () => {
    const result = rankSchema.safeParse({
      code: "GOLD",
      name: "Gold",
      tier_order: 3,
      min_active_customers: 25,
      commission_percent: 12,
      one_time_incentive: -1,
      is_active: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("PromoterDashboard DTO — one-time incentive", () => {
  it("exposes oneTimeIncentive on the dashboard response", () => {
    expectTypeOf<PromoterDashboard>().toHaveProperty("oneTimeIncentive").toBeNumber();
  });

  it("does not expose a legacy monthlyIncentive field", () => {
    expectTypeOf<PromoterDashboard>().not.toHaveProperty("monthlyIncentive");
  });

  it("exposes one_time_incentive on the Rank type", () => {
    expectTypeOf<Rank>().toHaveProperty("one_time_incentive").toBeNumber();
    expectTypeOf<Rank>().not.toHaveProperty("monthly_incentive");
  });
});
