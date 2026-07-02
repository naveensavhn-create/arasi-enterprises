/**
 * Integration tests for the admin-payment-row validation backend contract.
 *
 * Locks two invariants that both the ledger and the drawer depend on:
 *
 *  1. Every remediation entry the backend returns carries a `schemaPath`
 *     that maps to a real key of `adminPaymentRowSchema` AND matches the
 *     single-source-of-truth `ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].schemaPath`.
 *     No divergence is tolerated — that shared key is what the drawer uses
 *     to render field-scoped remediation hints.
 *
 *  2. The remediation payload is stable regardless of which top-level
 *     schema keys are missing (label, hint, and schemaPath come from the
 *     same registry the UI reads). Two rows failing on the same field
 *     produce byte-identical remediation entries.
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  adminPaymentRowSchema,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";
import {
  validateAdminPaymentRowResponse,
  toRemediation,
  type AdminPaymentRowRemediation,
} from "@/lib/payments/validate-row-response";

const REQUIRED_KEYS = Object.keys(
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
) as AdminPaymentRowRequiredField[];

function validRow(overrides: Partial<AdminPaymentRow> = {}): AdminPaymentRow {
  return {
    id: "pay_1",
    amount: 1000,
    currency: "INR",
    status: "paid",
    method: "upi",
    provider: "razorpay",
    provider_order_id: "order_1",
    provider_payment_id: "rzp_pay_1",
    error_code: null,
    error_description: null,
    paid_at: "2026-07-02T09:00:00.000Z",
    created_at: "2026-07-02T09:00:00.000Z",
    customer_id: "cust_1",
    membership_id: "mem_1",
    installment_id: null,
    memberships: { membership_number: "ARE-1" },
    installments: null,
    profile: { full_name: "Ada Lovelace", email: "ada@arasi.test" },
    reconciliation: null,
    ...overrides,
  };
}

describe("validateAdminPaymentRowResponse — accept path", () => {
  it("returns { ok: true, row } for a fully valid payload", () => {
    const res = validateAdminPaymentRowResponse(validRow());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.id).toBe("pay_1");
  });
});

describe("validateAdminPaymentRowResponse — reject path", () => {
  it("uses the canonical error code", () => {
    const res = validateAdminPaymentRowResponse({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("INVALID_ADMIN_PAYMENT_ROW");
  });

  it("rejects payloads with non-object shape", () => {
    for (const junk of [null, undefined, 42, "nope", []]) {
      const res = validateAdminPaymentRowResponse(junk);
      expect(res.ok).toBe(false);
    }
  });

  it.each(REQUIRED_KEYS)(
    "returns a schema-path-scoped remediation when the '%s' field is invalid",
    (key) => {
      const path = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].schemaPath;
      // Build a row where only the target schema field is invalid.
      const bad = { ...validRow() } as Record<string, unknown>;
      if (path === "amount") bad.amount = -1;
      else if (path === "currency") bad.currency = "";
      else if (path === "status") bad.status = "";
      else if (path === "provider_payment_id") {
        bad.status = "paid";
        bad.provider_payment_id = null;
      } else if (path === "profile") bad.profile = null;

      const res = validateAdminPaymentRowResponse(bad);
      expect(res.ok).toBe(false);
      if (res.ok) return;

      const hit = res.missing.find((m) => m.key === key);
      expect(hit, `no remediation for ${key}`).toBeDefined();
      expect(hit!.schemaPath).toBe(path);
      expect(hit!.label).toBe(ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].label);
      expect(hit!.hint).toBe(ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].hint);
    },
  );

  it("only returns schemaPath values that are real schema keys", () => {
    const schemaKeys = new Set(Object.keys(adminPaymentRowSchema.shape));
    for (const key of REQUIRED_KEYS) {
      expect(
        schemaKeys.has(ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].schemaPath),
      ).toBe(true);
    }
  });
});

describe("Remediation payload consistency", () => {
  it("returns byte-identical remediation entries for repeated rejections of the same field", () => {
    const a = validateAdminPaymentRowResponse(
      validRow({ status: "paid", provider_payment_id: null }),
    );
    const b = validateAdminPaymentRowResponse(
      validRow({
        id: "pay_other",
        status: "paid",
        provider_payment_id: null,
      }),
    );
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (a.ok || b.ok) return;

    const pickPaymentId = (
      list: AdminPaymentRowRemediation[],
    ): AdminPaymentRowRemediation | undefined =>
      list.find((m) => m.key === "paymentId");

    expect(pickPaymentId(a.missing)).toEqual(pickPaymentId(b.missing));
  });

  it("toRemediation() is the single source used to construct entries", () => {
    // Feed a payload guaranteed to hit multiple required fields and
    // verify every entry is deep-equal to toRemediation(key).
    const res = validateAdminPaymentRowResponse({
      // Missing/blank across several schema-path keys.
      id: "pay_x",
      amount: -5,
      currency: "",
      status: "",
      method: null,
      provider: "razorpay",
      provider_order_id: null,
      provider_payment_id: null,
      error_code: null,
      error_description: null,
      paid_at: null,
      created_at: "2026-07-02T09:00:00.000Z",
      customer_id: "cust_x",
      membership_id: "mem_x",
      installment_id: null,
      memberships: null,
      installments: null,
      profile: null,
      reconciliation: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    for (const entry of res.missing) {
      expect(entry).toEqual(toRemediation(entry.key));
    }
  });

  it("orders `missing` by declaration order in the required-fields registry", () => {
    // Force every required field to fail simultaneously.
    const res = validateAdminPaymentRowResponse({
      ...validRow(),
      amount: -1,
      currency: "",
      status: "",
      provider_payment_id: null,
      profile: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const returnedOrder = res.missing.map((m) => m.key);
    const expectedOrder = REQUIRED_KEYS.filter((k) =>
      returnedOrder.includes(k),
    );
    expect(returnedOrder).toEqual(expectedOrder);
  });
});
