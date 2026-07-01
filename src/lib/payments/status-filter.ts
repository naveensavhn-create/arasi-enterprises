/**
 * Shared PostgREST filter helpers for the `payments.status` enum
 * (`public.payment_status`).
 *
 * PostgREST on PG15/16/17 rejects a plain `.eq("status", "paid")` on an
 * enum column with:
 *   ERROR: operator does not exist: payment_status = text
 * The fix is to cast the column to `text` in the filter selector. Every
 * payments-status filter — equality, IN, NOT IN — MUST go through the
 * helpers in this module so a future callsite cannot re-introduce the bug.
 *
 * Kept in its own tiny module (no server-fn imports, no Supabase client
 * imports) so browser components, server functions, cron routes, and tests
 * can all share the exact same format without dragging in heavy deps.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Type safety
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  Helpers accept ONLY `PaymentStatus` (union of the enum members) — plain
 *  `string` is rejected by the compiler. This eliminates a whole class of
 *  bugs where a caller passes "PAID", "success", or a stale value that
 *  PostgREST would silently return zero rows for.
 *
 *  For inputs of type `string` (URL search params, request bodies, CSV
 *  imports), pass them through `coercePaymentStatus` / `coercePaymentStatuses`
 *  first — those return only valid enum values and drop everything else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  When to use which helper
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  applyPaymentStatusEq(query, status)   ← PREFERRED, use for everything
 *    • Accepts a single `PaymentStatus`, an array of them, or nullish.
 *    • Automatically picks the right PostgREST operator:
 *        - 1 value  → `eq`   → `status::text=eq.paid`
 *        - N values → `in`   → `status::text=in.(paid,refunded)`
 *        - null / undefined / [] → no-op (query passes through)
 *
 *  applyPaymentStatusIn(query, statuses) ← DEPRECATED, thin alias
 *    • Kept only for backwards compatibility. New code MUST use
 *      `applyPaymentStatusEq`; the ESLint rule + CI check
 *      (`scripts/check-payment-status-filters.mjs`) enforce that no new
 *      callsite hand-rolls a `.eq("status", …)` / `.in("status", …)`.
 *
 *  Required cast format (do NOT inline this string anywhere else):
 *    Column selector : `status::text`  (exported as `PAYMENT_STATUS_TEXT_COLUMN`)
 *    Operators       : `eq` | `in`
 *    IN value shape  : `(v1,v2,v3)`    — parens + comma-separated, NO quotes
 */

import type { Database } from "@/integrations/supabase/types";

/**
 * Canonical `payment_status` enum values. Derived from the generated
 * Supabase types so this list stays in lockstep with the DB — if the enum
 * gains/loses a member, TypeScript will surface every affected callsite.
 *
 * The tuple is `as const` so `PaymentStatus` is a string-literal union,
 * not `string`.
 */
export const PAYMENT_STATUSES = [
  "created",
  "attempted",
  "paid",
  "failed",
  "refunded",
] as const satisfies ReadonlyArray<Database["public"]["Enums"]["payment_status"]>;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** O(1) membership set for the runtime guard below. */
const PAYMENT_STATUS_SET: ReadonlySet<PaymentStatus> = new Set(PAYMENT_STATUSES);

/** Type guard: narrows an arbitrary string to `PaymentStatus`. */
export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && PAYMENT_STATUS_SET.has(value as PaymentStatus);
}

/**
 * Coerce an untrusted single value (URL search param, form field) to a
 * `PaymentStatus` or `null`. Anything not in the enum — including `""`,
 * `"all"`, wrong casing, or `undefined` — collapses to `null` so callers
 * can pass the result straight to `applyPaymentStatusEq` for a no-op.
 */
export function coercePaymentStatus(value: unknown): PaymentStatus | null {
  return isPaymentStatus(value) ? value : null;
}

/**
 * Coerce an untrusted list (URL repeated params, chip multi-select, JSON
 * body array) to a deduped `PaymentStatus[]`. Invalid entries are dropped
 * silently — same contract as `coercePaymentStatus`. Returns `[]` when no
 * valid values remain, which `applyPaymentStatusEq` treats as a no-op.
 */
export function coercePaymentStatuses(values: unknown): PaymentStatus[] {
  if (!Array.isArray(values)) return [];
  const out: PaymentStatus[] = [];
  const seen = new Set<PaymentStatus>();
  for (const v of values) {
    if (isPaymentStatus(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Minimal PostgREST query shape both browser and admin clients satisfy. */
type FilterableQuery<Q> = { filter: (col: string, op: string, v: unknown) => Q };

/** The canonical column selector — the ONLY place this literal is defined. */
export const PAYMENT_STATUS_TEXT_COLUMN = "status::text" as const;

/**
 * Unified payments-status filter. Accepts either a single `PaymentStatus`
 * or a list, and emits the correct PostgREST cast filter:
 *
 *   - `"paid"`                  → `filter("status::text","eq","paid")`
 *   - `["paid"]`                → `filter("status::text","eq","paid")`
 *   - `["paid","refunded"]`     → `filter("status::text","in","(paid,refunded)")`
 *   - `null | undefined`        → no-op (query returned untouched)
 *   - `[]`                      → no-op
 *
 * The compiler rejects arbitrary strings — coerce untrusted input via
 * `coercePaymentStatus` / `coercePaymentStatuses` first.
 */
export function applyPaymentStatusEq<Q extends FilterableQuery<Q>>(
  query: Q,
  status: PaymentStatus | readonly PaymentStatus[] | null | undefined,
): Q {
  if (status == null) return query;
  if (Array.isArray(status)) {
    // Runtime belt-and-braces: filter out any value the compiler couldn't
    // catch (e.g. a caller passing `as any`). Keeps the emitted PostgREST
    // filter valid even if type-safety is bypassed upstream.
    const values = (status as readonly unknown[]).filter(isPaymentStatus);
    if (values.length === 0) return query;
    if (values.length === 1) {
      return query.filter(PAYMENT_STATUS_TEXT_COLUMN, "eq", values[0]);
    }
    return query.filter(
      PAYMENT_STATUS_TEXT_COLUMN,
      "in",
      `(${values.join(",")})`,
    );
  }
  if (!isPaymentStatus(status)) return query;
  return query.filter(PAYMENT_STATUS_TEXT_COLUMN, "eq", status);
}

/**
 * @deprecated Use `applyPaymentStatusEq(query, statuses)` — the unified
 * helper now accepts arrays. Kept as a thin alias so existing callsites and
 * tests keep working; new code should import `applyPaymentStatusEq`.
 */
export function applyPaymentStatusIn<Q extends FilterableQuery<Q>>(
  query: Q,
  statuses: readonly PaymentStatus[] | null | undefined,
): Q {
  return applyPaymentStatusEq(query, statuses);
}
