/**
 * Backend response contract for admin-payment-row validation.
 *
 * Any server surface that validates an `AdminPaymentRow` payload (the
 * `validateAdminPaymentRow` server fn, future export/reconcile endpoints,
 * webhook replays) MUST return the shape produced here so the frontend
 * gets consistent remediation details regardless of which endpoint served
 * the response.
 *
 * The contract is:
 *   { ok: true, row }
 *   { ok: false, error: 'INVALID_ADMIN_PAYMENT_ROW',
 *     missing: [{ key, schemaPath, label, hint }, ...] }
 *
 * `schemaPath` is the key on `adminPaymentRowSchema` that failed — the
 * same source-of-truth key the drawer uses to render inline hints. That
 * ensures the ledger, drawer, and any backend consumer all agree on which
 * schema field caused the rejection.
 */
import {
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  validateAdminPaymentRow,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

export type AdminPaymentRowRemediation = {
  key: AdminPaymentRowRequiredField;
  schemaPath: (typeof ADMIN_PAYMENT_ROW_REQUIRED_FIELDS)[AdminPaymentRowRequiredField]["schemaPath"];
  label: string;
  hint: string;
};

export type AdminPaymentRowValidationResponse =
  | { ok: true; row: AdminPaymentRow }
  | {
      ok: false;
      error: "INVALID_ADMIN_PAYMENT_ROW";
      missing: AdminPaymentRowRemediation[];
    };

/** Build the wire-shape remediation entry for a single missing field. */
export function toRemediation(
  key: AdminPaymentRowRequiredField,
): AdminPaymentRowRemediation {
  const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];
  return {
    key,
    schemaPath: meta.schemaPath,
    label: meta.label,
    hint: meta.hint,
  };
}

/**
 * Server-facing validation entry point. Pure and dependency-free so it
 * can run inside a `createServerFn` handler, a server route, or a unit
 * test without any HTTP or Supabase setup.
 */
export function validateAdminPaymentRowResponse(
  input: unknown,
): AdminPaymentRowValidationResponse {
  const result = validateAdminPaymentRow(input);
  if (result.ok) return { ok: true, row: result.row };
  return {
    ok: false,
    error: "INVALID_ADMIN_PAYMENT_ROW",
    missing: result.missing.map(toRemediation),
  };
}
