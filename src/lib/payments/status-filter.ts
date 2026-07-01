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
 */

/** Minimal PostgREST query shape both browser and admin clients satisfy. */
type FilterableQuery<Q> = { filter: (col: string, op: string, v: unknown) => Q };

/** The canonical column selector — the ONLY place this literal is defined. */
export const PAYMENT_STATUS_TEXT_COLUMN = "status::text" as const;

/**
 * Unified payments-status filter. Accepts either a single status string or a
 * list of status strings and emits the correct PostgREST cast filter:
 *
 *   - `"paid"`                  → `filter("status::text","eq","paid")`
 *   - `["paid"]`                → `filter("status::text","eq","paid")`
 *   - `["paid","refunded"]`     → `filter("status::text","in","(paid,refunded)")`
 *   - `null | undefined | ""`   → no-op (query returned untouched)
 *   - `[]`                      → no-op
 *
 * Use for every equality/membership filter against `payments.status`; a
 * single callsite type means callers can pass URL search-param strings or
 * multi-select chip arrays without branching.
 */
export function applyPaymentStatusEq<Q extends FilterableQuery<Q>>(
  query: Q,
  status: string | readonly string[] | null | undefined,
): Q {
  if (status == null) return query;
  if (Array.isArray(status)) {
    const values = status.filter((s): s is string => typeof s === "string" && s.length > 0);
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
  if (typeof status !== "string" || status.length === 0) return query;
  return query.filter(PAYMENT_STATUS_TEXT_COLUMN, "eq", status);
}

/**
 * @deprecated Use `applyPaymentStatusEq(query, statuses)` — the unified
 * helper now accepts arrays. Kept as a thin alias so existing callsites and
 * tests keep working; new code should import `applyPaymentStatusEq`.
 */
export function applyPaymentStatusIn<Q extends FilterableQuery<Q>>(
  query: Q,
  statuses: readonly string[] | null | undefined,
): Q {
  return applyPaymentStatusEq(query, statuses);
}

