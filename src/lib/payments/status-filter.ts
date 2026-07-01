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
 * `WHERE status::text = <status>` — no-op when status is null/undefined/"".
 * Use for every equality filter against `payments.status`.
 */
export function applyPaymentStatusEq<Q extends FilterableQuery<Q>>(
  query: Q,
  status: string | null | undefined,
): Q {
  if (!status) return query;
  return query.filter(PAYMENT_STATUS_TEXT_COLUMN, "eq", status);
}

/**
 * `WHERE status::text IN (<list>)` — no-op when the list is empty/nullish.
 * Values are joined with commas exactly as PostgREST expects; callers must
 * not pre-quote them.
 */
export function applyPaymentStatusIn<Q extends FilterableQuery<Q>>(
  query: Q,
  statuses: readonly string[] | null | undefined,
): Q {
  if (!statuses || statuses.length === 0) return query;
  return query.filter(
    PAYMENT_STATUS_TEXT_COLUMN,
    "in",
    `(${statuses.join(",")})`,
  );
}
