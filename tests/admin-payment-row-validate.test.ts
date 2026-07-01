import { describe, expect, it } from "vitest";
import {
  adminPaymentRowSchema,
  validateAdminPaymentRow,
  validateAdminPaymentRowShape,
  type AdminPaymentRow,
} from "@/lib/payments/validate-row";

const baseRow: AdminPaymentRow = {
  id: "pay_row_1",
  amount: 1500,
  currency: "INR",
  status: "paid",
  method: "upi",
  provider: "razorpay",
  provider_order_id: "order_abc",
  provider_payment_id: "pay_abc",
  error_code: null,
  error_description: null,
  paid_at: "2026-06-01T10:00:00Z",
  created_at: "2026-06-01T09:59:00Z",
  customer_id: "cust_1",
  membership_id: "mem_1",
  installment_id: "inst_1",
  memberships: { membership_number: "ARASI-0001" },
  installments: { sequence: 2, due_date: "2026-06-01" },
  profile: { full_name: "Ada Lovelace", email: "ada@example.com" },
  reconciliation: null,
};

describe("validateAdminPaymentRowShape (drawer + ledger guard)", () => {
  it("accepts a fully populated paid row", () => {
    const r = validateAdminPaymentRowShape(baseRow);
    expect(r.ok).toBe(true);
  });

  it("accepts a pending row without a payment id", () => {
    const r = validateAdminPaymentRowShape({
      ...baseRow,
      status: "created",
      provider_payment_id: null,
      paid_at: null,
    });
    expect(r.ok).toBe(true);
  });

  it("falls back to email when full_name is null", () => {
    const r = validateAdminPaymentRowShape({
      ...baseRow,
      profile: { full_name: null, email: "ada@example.com" },
    });
    expect(r.ok).toBe(true);
  });

  it("requires a payment id when status is paid", () => {
    const r = validateAdminPaymentRowShape({
      ...baseRow,
      provider_payment_id: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("paymentId");
  });

  it("flags missing customer name when profile is null", () => {
    const r = validateAdminPaymentRowShape({ ...baseRow, profile: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("customerName");
  });

  it("flags whitespace-only name and email as missing customer name", () => {
    const r = validateAdminPaymentRowShape({
      ...baseRow,
      profile: { full_name: "   ", email: "  " },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("customerName");
  });

  it("rejects negative amounts", () => {
    const r = validateAdminPaymentRowShape({ ...baseRow, amount: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("amount");
  });

  it("aggregates multiple missing fields", () => {
    const r = validateAdminPaymentRowShape({
      ...baseRow,
      provider_payment_id: null,
      profile: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(
        expect.arrayContaining(["paymentId", "customerName"]),
      );
    }
  });
});

describe("validateAdminPaymentRow (schema parse + display rules)", () => {
  it("accepts a well-formed unknown payload", () => {
    const r = validateAdminPaymentRow(baseRow);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.id).toBe("pay_row_1");
  });

  it("rejects payloads missing required scalars", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { currency, ...rest } = baseRow;
    const r = validateAdminPaymentRow(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("currency");
  });

  it("rejects wrong types (amount as string)", () => {
    const r = validateAdminPaymentRow({ ...baseRow, amount: "1500" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("amount");
  });

  it("rejects entirely non-object input without throwing", () => {
    expect(validateAdminPaymentRow(null).ok).toBe(false);
    expect(validateAdminPaymentRow(42).ok).toBe(false);
    expect(validateAdminPaymentRow("nope").ok).toBe(false);
  });

  it("schema round-trips a valid row unchanged", () => {
    const parsed = adminPaymentRowSchema.parse(baseRow);
    expect(parsed).toEqual(baseRow);
  });
});
