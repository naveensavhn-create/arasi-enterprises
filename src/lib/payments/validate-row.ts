/**
 * Shared runtime validation for admin payment ledger rows.
 *
 * Both the ledger table and the detail drawer consume `AdminPaymentRow`
 * values that come from a joined SELECT with nullable relations (profiles,
 * memberships, installments) and provider-driven status fields. This module
 * is the single source of truth for:
 *   - the Zod schema describing a valid row,
 *   - the `AdminPaymentRow` TypeScript type (inferred from the schema),
 *   - the drawer-facing display rules (paid rows must carry a Razorpay
 *     payment ID, a display name must be resolvable),
 *   - the human-readable labels used in inline error UI.
 *
 * Keep this module free of server-only imports so it can be reused from any
 * client component (drawer, ledger, future exports) without pulling in
 * server function bundles.
 */
import { z } from "zod";

export const adminPaymentRowSchema = z.object({
  id: z.string().min(1),
  amount: z.number().finite().nonnegative(),
  currency: z.string().min(1),
  status: z.string().min(1),
  method: z.string().nullable(),
  provider: z.string().min(1),
  provider_order_id: z.string().nullable(),
  provider_payment_id: z.string().nullable(),
  error_code: z.string().nullable(),
  error_description: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string().min(1),
  customer_id: z.string().min(1),
  membership_id: z.string().min(1),
  installment_id: z.string().nullable(),
  memberships: z
    .object({ membership_number: z.string().nullable() })
    .nullable(),
  installments: z
    .object({ sequence: z.number(), due_date: z.string() })
    .nullable(),
  profile: z
    .object({
      full_name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
  reconciliation: z
    .object({
      last_checked_at: z.string(),
      mismatch: z.boolean(),
      resolved_at: z.string().nullable(),
      provider_status: z.string().nullable(),
      stored_status: z.string().nullable(),
    })
    .nullable(),
});

export type AdminPaymentRow = z.infer<typeof adminPaymentRowSchema>;

/** Any top-level key on the parsed admin payment row. */
type AdminPaymentRowSchemaKey = keyof AdminPaymentRow;

/**
 * Single source of truth for the drawer's "required for display" fields.
 *
 * Each entry ties a UI-facing key (`amount`, `paymentId`, ...) to:
 *   - `schemaPath`: the underlying Zod schema key it derives from. The
 *     `satisfies` clause below makes TypeScript fail the build if the schema
 *     is renamed or the referenced key is removed, so this map cannot drift.
 *   - `label`: human-readable label shown in the inline validation alert.
 *   - `hint`: short remediation guidance shown under each missing-field bullet.
 *
 * To add a new required field: extend this object. TypeScript will then force
 * updates to `applyDisplayRules` (via the exhaustive switch) and to any
 * consumer that iterates `AdminPaymentRowRequiredField`.
 */
export const ADMIN_PAYMENT_ROW_REQUIRED_FIELDS = {
  amount: {
    schemaPath: "amount",
    label: "Amount",
    hint: "Reconcile with Razorpay dashboard; the stored value is invalid or negative.",
  },
  currency: {
    schemaPath: "currency",
    label: "Currency",
    hint: "Currency code is empty. Check the originating order metadata.",
  },
  status: {
    schemaPath: "status",
    label: "Status",
    hint: "Payment status is blank. Trigger a webhook replay or manual reconcile.",
  },
  paymentId: {
    schemaPath: "provider_payment_id",
    label: "Razorpay payment ID",
    hint: "Marked paid without a Razorpay payment ID. Verify the webhook fired.",
  },
  customerName: {
    schemaPath: "profile",
    label: "Customer name",
    hint: "Linked profile is missing or has no name/email. The customer may have been deleted.",
  },
} as const satisfies Record<
  string,
  { schemaPath: AdminPaymentRowSchemaKey; label: string; hint: string }
>;

export type AdminPaymentRowRequiredField =
  keyof typeof ADMIN_PAYMENT_ROW_REQUIRED_FIELDS;

type RequiredFieldMeta<K extends AdminPaymentRowRequiredField> =
  (typeof ADMIN_PAYMENT_ROW_REQUIRED_FIELDS)[K];

function mapMeta<V>(
  pick: <K extends AdminPaymentRowRequiredField>(meta: RequiredFieldMeta<K>) => V,
): Record<AdminPaymentRowRequiredField, V> {
  const out = {} as Record<AdminPaymentRowRequiredField, V>;
  for (const key of Object.keys(
    ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  ) as AdminPaymentRowRequiredField[]) {
    out[key] = pick(ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key]);
  }
  return out;
}

export const ADMIN_PAYMENT_ROW_FIELD_LABELS: Record<
  AdminPaymentRowRequiredField,
  string
> = mapMeta((m) => m.label);

export const ADMIN_PAYMENT_ROW_FIELD_HINTS: Record<
  AdminPaymentRowRequiredField,
  string
> = mapMeta((m) => m.hint);


export type ValidateAdminPaymentRowResult =
  | { ok: true; row: AdminPaymentRow }
  | { ok: false; missing: AdminPaymentRowRequiredField[] };

/**
 * Full validation: parses the row via the schema and then applies drawer
 * display rules. Use when you have an `unknown` value or want the parsed
 * row back for downstream rendering.
 */
export function validateAdminPaymentRow(
  input: unknown,
): ValidateAdminPaymentRowResult {
  const parsed = adminPaymentRowSchema.safeParse(input);
  if (!parsed.success) {
    const paths = new Set(
      parsed.error.issues.map((i) => String(i.path[0] ?? "")),
    );
    const missing: AdminPaymentRowRequiredField[] = [];
    if (paths.has("amount")) missing.push("amount");
    if (paths.has("currency")) missing.push("currency");
    if (paths.has("status")) missing.push("status");
    if (paths.has("provider_payment_id")) missing.push("paymentId");
    if (paths.has("profile")) missing.push("customerName");
    return { ok: false, missing: missing.length ? missing : ["status"] };
  }
  return applyDisplayRules(parsed.data);
}

/**
 * Lightweight validation for values already typed as `AdminPaymentRow`.
 * Skips schema re-parsing and only applies the drawer display rules — this
 * is what the ledger and drawer use on already-fetched rows.
 */
export function validateAdminPaymentRowShape(
  row: AdminPaymentRow,
): ValidateAdminPaymentRowResult {
  return applyDisplayRules(row);
}

function applyDisplayRules(row: AdminPaymentRow): ValidateAdminPaymentRowResult {
  const missing: AdminPaymentRowRequiredField[] = [];
  if (!Number.isFinite(row.amount) || row.amount < 0) missing.push("amount");
  if (!row.currency) missing.push("currency");
  if (!row.status) missing.push("status");
  if (row.status === "paid" && !row.provider_payment_id) missing.push("paymentId");
  const name =
    row.profile?.full_name?.trim() || row.profile?.email?.trim() || "";
  if (!name) missing.push("customerName");
  return missing.length ? { ok: false, missing } : { ok: true, row };
}
