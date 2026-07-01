/**
 * Integration test: payment status filters must go through `status::text`
 * casts so PostgreSQL's enum equality operator resolution succeeds.
 *
 * `payments.status` is a Postgres enum (`payment_status`). On PG15/16/17
 * `status = 'paid'::text` fails with:
 *   ERROR: operator does not exist: payment_status = text
 * PostgREST issues that exact comparison for a plain `.eq("status", "paid")`,
 * so every payments-status equality filter is routed through
 * `applyPaymentStatusEq`, which emits `filter("status::text", "eq", value)`.
 *
 * Two layers are verified:
 *
 *   1. Helper contract — `applyPaymentStatusEq` produces the cast column
 *      string PostgREST needs; a null/undefined status leaves the query
 *      untouched (never introduces a broken filter).
 *
 *   2. Source-level audit — no callsite in `src/**` may bypass the helper
 *      with a raw `.eq("status", ...)` or `.filter("status",...)` on the
 *      payments table. A regression here re-introduces the enum bug.
 *
 *   3. DB integration (gated on SUPABASE_DB_URL) — against real Postgres,
 *      the cast form succeeds while the uncast form raises the exact
 *      operator error, proving the cast is not cosmetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { applyPaymentStatusEq } from "@/lib/payments.functions";

// ---------------------------------------------------------------------------
// 1. Helper contract
// ---------------------------------------------------------------------------

describe("applyPaymentStatusEq (status::text cast helper)", () => {
  function makeQuery() {
    const calls: Array<{ col: string; op: string; v: unknown }> = [];
    const q: any = {
      calls,
      filter(col: string, op: string, v: unknown) {
        calls.push({ col, op, v });
        return q;
      },
    };
    return q;
  }

  it("emits filter('status::text','eq',value) for a real status", () => {
    const q = makeQuery();
    const out = applyPaymentStatusEq(q, "paid");
    expect(out).toBe(q); // fluent
    expect(q.calls).toEqual([{ col: "status::text", op: "eq", v: "paid" }]);
  });

  it("never uses the bare `status` column (would trigger the enum bug)", () => {
    const q = makeQuery();
    applyPaymentStatusEq(q, "failed");
    for (const c of q.calls) {
      expect(c.col).not.toBe("status");
      expect(c.col).toMatch(/^status::text$/);
    }
  });

  it("is a no-op for null/undefined/empty status (no filter attached)", () => {
    for (const v of [null, undefined, ""] as const) {
      const q = makeQuery();
      applyPaymentStatusEq(q, v);
      expect(q.calls).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Source-level audit: no raw payments.status equality anywhere
// ---------------------------------------------------------------------------

describe("source audit: payments.status equality goes through the helper", () => {
  const SRC = resolve(__dirname, "../src");

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) yield* walk(p);
      else if (/\.(ts|tsx)$/.test(name)) yield p;
    }
  }

  it("no .eq(\"status\", ...) or .filter(\"status\", \"eq\", ...) callsite exists in src/**", () => {
    const HELPER_FILE = resolve(SRC, "lib/payments.functions.ts");
    // Patterns that would bypass applyPaymentStatusEq
    const badEq = /\.eq\(\s*["']status["']\s*,/;
    const badFilter = /\.filter\(\s*["']status["']\s*,\s*["']eq["']/;
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === HELPER_FILE) continue; // helper defines the correct form
      const text = readFileSync(file, "utf8");
      // Only flag matches in files that also touch the payments table, to
      // avoid false positives on unrelated tables that happen to have a
      // `status` column (e.g. installments, memberships).
      const touchesPayments = /from\(\s*["']payments["']\s*\)/.test(text);
      if (!touchesPayments) continue;
      if (badEq.test(text) || badFilter.test(text)) offenders.push(file);
    }
    expect(offenders, `Bare payments.status equality found in:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. DB integration: cast succeeds, uncast comparison errors
// ---------------------------------------------------------------------------

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("payment_status cast (real Postgres)", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it("`status::text = 'paid'` succeeds (this is what PostgREST issues via the helper)", async () => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM public.payments
        WHERE status::text = 'paid'`,
    );
    expect(rows).toHaveLength(1);
    // count is a string via ::text; must be a non-negative integer
    expect(rows[0].count).toMatch(/^\d+$/);
  });

  it("`status = 'paid'::text` raises the exact enum operator error the helper protects against", async () => {
    await expect(
      client.query(
        `SELECT count(*) FROM public.payments WHERE status = 'paid'::text`,
      ),
    ).rejects.toMatchObject({
      // Postgres: 42883 = undefined_function / operator does not exist
      code: "42883",
      message: expect.stringMatching(
        /operator does not exist:\s*payment_status\s*=\s*text/i,
      ),
    });
  });

  it("cast form works for every payment_status enum label (matches the UI status chips)", async () => {
    const { rows: labels } = await client.query<{ label: string }>(
      `SELECT unnest(enum_range(NULL::public.payment_status))::text AS label`,
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const { label } of labels) {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM public.payments
          WHERE status::text = $1`,
        [label],
      );
      expect(rows[0].count).toMatch(/^\d+$/);
    }
  });
});
