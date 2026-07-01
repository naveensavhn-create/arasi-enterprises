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

// ─────────────────────────────────────────────────────────────────────────
//  Logging wrappers
// ─────────────────────────────────────────────────────────────────────────
//
// The plain `coerce*` helpers deliberately drop invalid input silently so
// UI code (URL params, form fields) can round-trip stale values without
// blowing up. Server-side callers — reconciliation, export jobs, admin
// queries — MUST NOT lose that signal: dropping "PAID" or "success" on the
// floor turns a bug into a silent mis-filter that returns the wrong row
// set. Use these wrappers everywhere the result feeds a query builder.
//
// They preserve the exact same return contract (`PaymentStatus | null` /
// `PaymentStatus[]`) so callsites can swap in without other changes, but
// emit a structured `console.warn` when a non-empty input was reduced to
// `null` / had entries dropped. `console.warn` is captured by the Worker
// runtime log tail, so operators can grep for `payment_status.coerce` in
// server logs.

export type CoerceLogContext = {
  /** Short identifier of the callsite, e.g. `"exports.functions:filter"`. */
  source: string;
  /** Optional job/request id to correlate with other log lines. */
  correlationId?: string;
};

function logDroppedStatus(
  ctx: CoerceLogContext,
  raw: unknown,
  dropped: unknown[],
): void {
  // Best-effort structured warn; never throws so it can't break a query.
  try {
    // eslint-disable-next-line no-console
    console.warn("[payment_status.coerce] dropped invalid status input", {
      source: ctx.source,
      correlationId: ctx.correlationId,
      raw,
      dropped,
      allowed: PAYMENT_STATUSES,
    });
  } catch {
    /* logging must never throw */
  }
}

/**
 * Same contract as {@link coercePaymentStatus} but emits a `console.warn`
 * when a non-nullish, non-empty input was rejected. The safe fallback is
 * `null` (== "no status filter"), which callers already handle as a no-op.
 */
export function coercePaymentStatusOrLog(
  value: unknown,
  ctx: CoerceLogContext,
): PaymentStatus | null {
  const coerced = coercePaymentStatus(value);
  if (coerced === null && value !== undefined && value !== null && value !== "") {
    logDroppedStatus(ctx, value, [value]);
  }
  return coerced;
}

/**
 * Same contract as {@link coercePaymentStatuses} but emits a `console.warn`
 * listing every entry that was dropped from a non-empty input array. The
 * safe fallback is `[]` (== "no status filter"), which the query helper
 * treats as a no-op.
 */
export function coercePaymentStatusesOrLog(
  values: unknown,
  ctx: CoerceLogContext,
): PaymentStatus[] {
  const coerced = coercePaymentStatuses(values);
  if (Array.isArray(values) && values.length > 0) {
    const kept = new Set<unknown>(coerced);
    const dropped = values.filter((v) => !kept.has(v));
    if (dropped.length > 0) logDroppedStatus(ctx, values, dropped);
  } else if (values !== undefined && values !== null && !Array.isArray(values)) {
    // Non-array truthy input (e.g. a single string mistakenly forwarded to
    // the list variant) always coerces to `[]` — flag it so the caller
    // doesn't silently run without a filter.
    logDroppedStatus(ctx, values, [values]);
  }
  return coerced;
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
    // filter valid even if type-safety is bypassed upstream. Any dropped
    // entry is logged so a silent mis-filter is impossible to miss in
    // Worker logs — grep for `payment_status.apply`.
    const values = (status as readonly unknown[]).filter(isPaymentStatus);
    if (values.length !== status.length) {
      const dropped = (status as readonly unknown[]).filter(
        (v) => !isPaymentStatus(v),
      );
      try {
        // eslint-disable-next-line no-console
        console.warn(
          "[payment_status.apply] dropped invalid entries from status filter",
          { raw: status, dropped, allowed: PAYMENT_STATUSES },
        );
      } catch {
        /* logging must never throw */
      }
    }
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
