import { describe, it, expect } from "vitest";
import {
  coercePaymentStatus,
  coercePaymentStatuses,
  isPaymentStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from "@/lib/payments/status-filter";

describe("coercePaymentStatus", () => {
  it("returns each valid enum member unchanged", () => {
    for (const s of PAYMENT_STATUSES) {
      expect(coercePaymentStatus(s)).toBe(s);
      expect(isPaymentStatus(s)).toBe(true);
    }
  });

  it.each([
    ["empty string", ""],
    ["sentinel 'all'", "all"],
    ["upper case", "PAID"],
    ["mixed case", "Paid"],
    ["surrounding whitespace", " paid "],
    ["unknown value", "pending"],
    ["numeric string", "1"],
    ["stale enum value", "success"],
  ])("rejects invalid string (%s) with null", (_label, value) => {
    expect(coercePaymentStatus(value)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["boolean", true],
    ["object", { status: "paid" }],
    ["array", ["paid"]],
    ["symbol", Symbol("paid")],
  ])("rejects non-string input (%s) with null", (_label, value) => {
    expect(coercePaymentStatus(value)).toBeNull();
  });
});

describe("coercePaymentStatuses", () => {
  it("returns valid entries unchanged and preserves order", () => {
    const input: PaymentStatus[] = ["paid", "failed", "refunded"];
    expect(coercePaymentStatuses(input)).toEqual(input);
  });

  it("drops invalid string entries silently", () => {
    const input = ["paid", "pending", "PAID", "", "failed"];
    expect(coercePaymentStatuses(input)).toEqual(["paid", "failed"]);
  });

  it("drops non-string entries silently", () => {
    const input = ["paid", 1, null, undefined, { s: "paid" }, ["paid"], "refunded"];
    expect(coercePaymentStatuses(input)).toEqual(["paid", "refunded"]);
  });

  it("dedupes valid entries while preserving first-seen order", () => {
    const input = ["paid", "failed", "paid", "refunded", "failed"];
    expect(coercePaymentStatuses(input)).toEqual(["paid", "failed", "refunded"]);
  });

  it("returns [] for an empty array", () => {
    expect(coercePaymentStatuses([])).toEqual([]);
  });

  it("returns [] for an all-invalid array", () => {
    expect(coercePaymentStatuses(["pending", "PAID", "", 0, null])).toEqual([]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["string", "paid"],
    ["number", 3],
    ["object", { 0: "paid", length: 1 }],
    ["Set", new Set(["paid"])],
  ])("returns [] for non-array input (%s)", (_label, value) => {
    expect(coercePaymentStatuses(value)).toEqual([]);
  });

  it("output only contains members of PAYMENT_STATUSES", () => {
    const noisy = [...PAYMENT_STATUSES, "pending", "PAID", "", null, 7, "attempted"];
    const out = coercePaymentStatuses(noisy);
    for (const v of out) expect(PAYMENT_STATUSES).toContain(v);
  });
});
