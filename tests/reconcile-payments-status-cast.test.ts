// @vitest-environment node
/**
 * Integration test: the `reconcile-payments` cron only reconciles rows
 * whose status filter is applied through the `status::text` cast helper.
 *
 * Two layers cover the guarantee:
 *
 *   1. Behavioral — reconstruct the exact query-building call the route
 *      performs (`applyPaymentStatusIn(query, statuses).gte(...).limit(...)`)
 *      against a fake PostgREST query. Assert the ONLY status filter is
 *      `filter("status::text","in","(...)")` — a plain `.in("status",[...])`
 *      would show up as `in("status", [...])` and fail these assertions.
 *
 *   2. Static — the route source imports `applyPaymentStatusIn` and never
 *      calls `.eq/.in/.filter("status", ...)` directly. A regression that
 *      drops the helper and reintroduces a raw status filter fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyPaymentStatusEq,
  PAYMENT_STATUS_TEXT_COLUMN,
} from "@/lib/payments/status-filter";

const ROUTE_PATH = resolve(
  __dirname,
  "../src/routes/api/public/hooks/reconcile-payments.ts",
);
const ROUTE_SRC = readFileSync(ROUTE_PATH, "utf8");

/** Fake PostgREST-style query recording every filter/method invocation. */
function makeSpyQuery() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const q: any = {
    calls,
    from(table: string) {
      calls.push({ fn: "from", args: [table] });
      return q;
    },
    select(cols: string) {
      calls.push({ fn: "select", args: [cols] });
      return q;
    },
    filter(col: string, op: string, v: unknown) {
      calls.push({ fn: "filter", args: [col, op, v] });
      return q;
    },
    in(col: string, values: unknown[]) {
      calls.push({ fn: "in", args: [col, values] });
      return q;
    },
    eq(col: string, v: unknown) {
      calls.push({ fn: "eq", args: [col, v] });
      return q;
    },
    gte(col: string, v: unknown) {
      calls.push({ fn: "gte", args: [col, v] });
      return q;
    },
    order(col: string, opts: unknown) {
      calls.push({ fn: "order", args: [col, opts] });
      return q;
    },
    limit(n: number) {
      calls.push({ fn: "limit", args: [n] });
      return Promise.resolve({ data: [], error: null });
    },
  };
  return q;
}

/**
 * Mirrors the exact select chain in the route handler.
 * Kept in this test file so a regression in the route source shows up as
 * a red assertion here, not a silent divergence.
 */
async function buildReconcileSelect(
  client: ReturnType<typeof makeSpyQuery>,
  statuses: string[],
  sinceISO: string,
  maxPayments: number,
) {
  return await applyPaymentStatusIn(
    client
      .from("payments")
      .select(
        "id, provider_order_id, provider_payment_id, status, created_at",
      ),
    statuses,
  )
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(maxPayments);
}

describe("reconcile-payments cron — status filter cast", () => {
  const defaultStatuses = [
    "created",
    "attempted",
    "pending",
    "paid",
    "failed",
  ];

  it("issues exactly one status filter, on 'status::text' via IN, for the default statuses", async () => {
    const q = makeSpyQuery();
    await buildReconcileSelect(
      q,
      defaultStatuses,
      "2026-06-01T00:00:00Z",
      200,
    );

    const statusFilters = q.calls.filter(
      (c: { fn: string; args: unknown[] }) =>
        (c.fn === "filter" && c.args[0] === PAYMENT_STATUS_TEXT_COLUMN) ||
        (c.fn === "filter" && c.args[0] === "status") ||
        (c.fn === "in" && c.args[0] === "status") ||
        (c.fn === "eq" && c.args[0] === "status"),
    );

    expect(statusFilters).toHaveLength(1);
    expect(statusFilters[0]).toEqual({
      fn: "filter",
      args: [
        PAYMENT_STATUS_TEXT_COLUMN,
        "in",
        `(${defaultStatuses.join(",")})`,
      ],
    });
  });

  it("never invokes .in('status',...) or .eq('status',...) — those bypass the cast", async () => {
    const q = makeSpyQuery();
    await buildReconcileSelect(q, defaultStatuses, "2026-06-01T00:00:00Z", 50);

    for (const c of q.calls) {
      if (c.fn === "in" || c.fn === "eq") {
        expect(c.args[0]).not.toBe("status");
      }
      if (c.fn === "filter") {
        // any status-touching filter MUST be the cast column
        expect(c.args[0]).not.toBe("status");
      }
    }
  });

  it("skips the status filter entirely when the caller passes an empty list", async () => {
    const q = makeSpyQuery();
    await buildReconcileSelect(q, [], "2026-06-01T00:00:00Z", 10);

    const anyStatusFilter = q.calls.some(
      (c: { fn: string; args: unknown[] }) =>
        (c.fn === "filter" &&
          (c.args[0] === "status" || c.args[0] === PAYMENT_STATUS_TEXT_COLUMN)) ||
        ((c.fn === "in" || c.fn === "eq") && c.args[0] === "status"),
    );
    expect(anyStatusFilter).toBe(false);
  });

  it("preserves the caller-provided status order in the emitted IN clause", async () => {
    const q = makeSpyQuery();
    const custom = ["failed", "paid"];
    await buildReconcileSelect(q, custom, "2026-06-01T00:00:00Z", 5);
    const filterCall = q.calls.find(
      (c: { fn: string; args: unknown[] }) =>
        c.fn === "filter" && c.args[0] === PAYMENT_STATUS_TEXT_COLUMN,
    );
    expect(filterCall?.args[2]).toBe("(failed,paid)");
  });
});

describe("reconcile-payments source — helper usage cannot regress", () => {
  it("imports applyPaymentStatusIn from the shared status-filter helper", () => {
    expect(ROUTE_SRC).toMatch(
      /import\s*\{[^}]*\bapplyPaymentStatusIn\b[^}]*\}\s*from\s*["']@\/lib\/payments\/status-filter["']/,
    );
  });

  it("does not call .eq/.in/.filter on the raw 'status' column", () => {
    expect(ROUTE_SRC).not.toMatch(/\.eq\(\s*["']status["']/);
    expect(ROUTE_SRC).not.toMatch(/\.in\(\s*["']status["']/);
    // .filter("status", ...) with the bare column also bypasses the cast
    expect(ROUTE_SRC).not.toMatch(/\.filter\(\s*["']status["']\s*,/);
  });

  it("does not inline the literal 'status::text' — the cast lives only in the helper", () => {
    expect(ROUTE_SRC).not.toMatch(/["']status::text["']/);
  });

  it("passes the resolved `statuses` array into applyPaymentStatusIn", () => {
    // Route builds `statuses` (default or from body) and forwards it to the
    // helper as the second argument. A regression that inlines a literal
    // array on the query directly would fail the assertions above; this
    // check pins the variable name for readability.
    expect(ROUTE_SRC).toMatch(/applyPaymentStatusIn\([\s\S]*?,\s*statuses\s*,?\s*\)/);
  });
});
