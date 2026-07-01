// @vitest-environment node
/**
 * Guards that the invalid-row alert's labels and remediation hints are
 * derived from ADMIN_PAYMENT_ROW_REQUIRED_FIELDS and stay in lockstep with
 * the Zod schema. If the schema is renamed or a required field is added
 * without wiring the label/hint, these tests fail.
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_PAYMENT_ROW_FIELD_HINTS,
  ADMIN_PAYMENT_ROW_FIELD_LABELS,
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  adminPaymentRowSchema,
  validateAdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

const validRow = {
  id: "pmt_1",
  amount: 100,
  currency: "INR",
  status: "paid",
  method: "upi",
  provider: "razorpay",
  provider_order_id: "order_1",
  provider_payment_id: "pay_1",
  error_code: null,
  error_description: null,
  paid_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  customer_id: "cust_1",
  membership_id: "mem_1",
  installment_id: null,
  memberships: { membership_number: "M-1" },
  installments: null,
  profile: { full_name: "Ada Lovelace", email: "ada@example.com" },
  reconciliation: null,
};

const schemaKeys = Object.keys(adminPaymentRowSchema.shape);
const requiredKeys = Object.keys(
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
) as AdminPaymentRowRequiredField[];

describe("ADMIN_PAYMENT_ROW_REQUIRED_FIELDS", () => {
  it("every schemaPath references a real key on the Zod schema", () => {
    for (const key of requiredKeys) {
      const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];
      expect(
        schemaKeys,
        `schemaPath "${meta.schemaPath}" for "${key}" must exist on adminPaymentRowSchema`,
      ).toContain(meta.schemaPath);
    }
  });

  it("labels and hints are derived from the same source map (same keys, non-empty)", () => {
    expect(Object.keys(ADMIN_PAYMENT_ROW_FIELD_LABELS).sort()).toEqual(
      requiredKeys.slice().sort(),
    );
    expect(Object.keys(ADMIN_PAYMENT_ROW_FIELD_HINTS).sort()).toEqual(
      requiredKeys.slice().sort(),
    );
    for (const key of requiredKeys) {
      expect(ADMIN_PAYMENT_ROW_FIELD_LABELS[key]).toBe(
        ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].label,
      );
      expect(ADMIN_PAYMENT_ROW_FIELD_HINTS[key]).toBe(
        ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].hint,
      );
      expect(ADMIN_PAYMENT_ROW_FIELD_LABELS[key].trim().length).toBeGreaterThan(0);
      expect(ADMIN_PAYMENT_ROW_FIELD_HINTS[key].trim().length).toBeGreaterThan(0);
    }
  });

  it("labels and hints are unique per required field", () => {
    const labels = Object.values(ADMIN_PAYMENT_ROW_FIELD_LABELS);
    const hints = Object.values(ADMIN_PAYMENT_ROW_FIELD_HINTS);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(hints).size).toBe(hints.length);
  });

  it("a schema-invalidating input surfaces the required field keyed by its schemaPath", () => {
    // Break `provider_payment_id` at the schema level (wrong type). The
    // required-fields map must translate that schema path back into the
    // `paymentId` UI key.
    const broken = { ...validRow, provider_payment_id: 42 };
    const result = validateAdminPaymentRow(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain("paymentId");
  });

  it("display-rule violations (paid without payment id) map to `paymentId`", () => {
    const paidNoId = { ...validRow, provider_payment_id: null };
    const result = validateAdminPaymentRow(paidNoId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["paymentId"]);
  });

  it("missing profile display name maps to `customerName`", () => {
    const noName = {
      ...validRow,
      profile: { full_name: null, email: null },
    };
    const result = validateAdminPaymentRow(noName);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain("customerName");
  });
});
