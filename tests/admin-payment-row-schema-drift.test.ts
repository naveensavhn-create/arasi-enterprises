/**
 * CI guard: keeps ADMIN_PAYMENT_ROW_REQUIRED_FIELDS in lockstep with
 * adminPaymentRowSchema. Fails fast on the FIRST mismatched key with a
 * remediation-shaped error message.
 *
 * Failure modes covered:
 *   1. A required field's `schemaPath` no longer exists on the schema
 *      (schema key was renamed/removed).
 *   2. A required field's `schemaPath` collides with a wrong schema type
 *      (e.g. object field flipped to string) — checked via a probe parse.
 *   3. A schema key that USED to be required is silently dropped from the
 *      required-fields map (guarded by an allow-list of known-optional keys
 *      so intentional non-required schema fields don't trip the test).
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  adminPaymentRowSchema,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

const REQUIRED_KEYS = Object.keys(
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
) as AdminPaymentRowRequiredField[];

const SCHEMA_KEYS = Object.keys(adminPaymentRowSchema.shape);

/**
 * Schema fields intentionally NOT surfaced as required in the UI map.
 * Add here (with justification) if a new optional/derived schema field
 * lands. Anything not in this list AND not in the required-fields map
 * fails the drift check below.
 */
const KNOWN_NON_REQUIRED_SCHEMA_KEYS = new Set<string>([
  "id",
  "method",
  "provider",
  "provider_order_id",
  "error_code",
  "error_description",
  "paid_at",
  "created_at",
  "customer_id",
  "membership_id",
  "installment_id",
  "memberships",
  "installments",
  "reconciliation",
]);

describe("ADMIN_PAYMENT_ROW_REQUIRED_FIELDS ⇄ adminPaymentRowSchema drift guard", () => {
  it("every required field's schemaPath exists on the schema", () => {
    for (const key of REQUIRED_KEYS) {
      const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];
      const exists = Object.prototype.hasOwnProperty.call(
        adminPaymentRowSchema.shape,
        meta.schemaPath,
      );
      if (!exists) {
        throw new Error(
          [
            `ADMIN_PAYMENT_ROW_REQUIRED_FIELDS["${key}"] points at ` +
              `schemaPath "${meta.schemaPath}", which is NOT a key on ` +
              `adminPaymentRowSchema.`,
            `Fix one of the following:`,
            `  • Rename the schemaPath in ADMIN_PAYMENT_ROW_REQUIRED_FIELDS["${key}"] to a real schema key.`,
            `  • Re-add "${meta.schemaPath}" to adminPaymentRowSchema.`,
            `Available schema keys: ${SCHEMA_KEYS.join(", ")}`,
          ].join("\n"),
        );
      }
      // First mismatch aborts — this is a Vitest assertion so the failure
      // message above is what CI surfaces.
      expect(exists, `schemaPath "${meta.schemaPath}" missing on schema`).toBe(true);
    }
  });

  it("every required field's schemaPath still accepts the shape the UI expects", () => {
    // Probe: send a valid canonical row, then blank out just the target
    // schema key. If the schema NOW accepts null/undefined for that key
    // (i.e. the key became optional/nullable without the UI map noticing),
    // the required-field contract is broken.
    const canonical = {
      id: "pay_probe",
      amount: 1500,
      currency: "INR",
      status: "paid",
      method: "upi",
      provider: "razorpay",
      provider_order_id: "order_x",
      provider_payment_id: "pay_x",
      error_code: null,
      error_description: null,
      paid_at: "2026-06-01T10:00:00Z",
      created_at: "2026-06-01T09:59:00Z",
      customer_id: "cust_1",
      membership_id: "mem_1",
      installment_id: "inst_1",
      memberships: { membership_number: "ARASI-0001" },
      installments: { sequence: 1, due_date: "2026-06-01" },
      profile: { full_name: "Ada", email: "ada@example.com" },
      reconciliation: null,
    } as Record<string, unknown>;

    // Sanity: canonical row must parse cleanly, otherwise this test is moot.
    const base = adminPaymentRowSchema.safeParse(canonical);
    expect(
      base.success,
      "canonical probe row must parse — update the test fixture to match adminPaymentRowSchema.",
    ).toBe(true);

    for (const key of REQUIRED_KEYS) {
      const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];
      // Wrong-type breaker per schemaPath. If the schema is more permissive
      // than the UI thinks, this parse will succeed — that's the drift.
      const breakers: Record<string, unknown> = {
        amount: "not-a-number",
        currency: 42,
        status: null,
        provider_payment_id: 123,
        profile: "not-an-object",
      };
      const payload = { ...canonical, [meta.schemaPath]: breakers[meta.schemaPath] };
      const result = adminPaymentRowSchema.safeParse(payload);
      if (result.success) {
        throw new Error(
          [
            `Schema drift for required field "${key}" (schemaPath "${meta.schemaPath}"):`,
            `  adminPaymentRowSchema now ACCEPTS ${JSON.stringify(breakers[meta.schemaPath])} at "${meta.schemaPath}",`,
            `  but ADMIN_PAYMENT_ROW_REQUIRED_FIELDS marks it required.`,
            `Fix one of the following:`,
            `  • Tighten adminPaymentRowSchema.${meta.schemaPath} to reject this value.`,
            `  • Remove "${key}" from ADMIN_PAYMENT_ROW_REQUIRED_FIELDS if it's no longer required.`,
          ].join("\n"),
        );
      }
    }
  });

  it("no schema key is silently dropped from the required-fields map", () => {
    const claimedSchemaPaths = new Set(
      REQUIRED_KEYS.map((k) => ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[k].schemaPath as string),
    );
    for (const schemaKey of SCHEMA_KEYS) {
      const isRequired = claimedSchemaPaths.has(schemaKey);
      const isKnownOptional = KNOWN_NON_REQUIRED_SCHEMA_KEYS.has(schemaKey);
      if (!isRequired && !isKnownOptional) {
        throw new Error(
          [
            `Schema key "${schemaKey}" is neither in ADMIN_PAYMENT_ROW_REQUIRED_FIELDS`,
            `nor in the KNOWN_NON_REQUIRED_SCHEMA_KEYS allow-list.`,
            `Fix one of the following:`,
            `  • Add "${schemaKey}" as a required field (with label + hint) to ADMIN_PAYMENT_ROW_REQUIRED_FIELDS.`,
            `  • Add "${schemaKey}" to KNOWN_NON_REQUIRED_SCHEMA_KEYS in this test if it's intentionally optional.`,
          ].join("\n"),
        );
      }
    }
  });
});
