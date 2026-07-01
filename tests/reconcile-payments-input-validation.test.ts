// @vitest-environment node
/**
 * Integration test: the `reconcile-payments` route rejects invalid or
 * malformed `payment_status` inputs with a clear 400 error response BEFORE
 * any PostgREST query (or Supabase client) is touched.
 *
 * Why this test exists
 * ────────────────────
 * The cron previously silently coerced unknown statuses (dropping them and
 * falling back to defaults), which meant a typo in the pg_cron body — e.g.
 * `{"statuses":["pending"]}` — would appear to succeed while actually
 * reconciling zero rows. We now reject invalid inputs loudly. This test
 * pins that contract:
 *
 *   1. `statuses` present but not an array          → 400 INVALID_STATUSES
 *   2. `statuses` array containing unknown values   → 400 INVALID_PAYMENT_STATUS
 *      and the response echoes the invalid values + the allowed set so
 *      operators can fix the caller without reading source.
 *   3. Rejection happens BEFORE the dynamic Supabase import → proven by
 *      running the handler with no Supabase env / client available and
 *      still getting a clean JSON error (never a crash / 500).
 *   4. Missing `apikey` header → 401 (auth is still the outermost gate,
 *      so invalid callers can't probe validation errors either).
 *   5. Sanity: a well-formed body still passes validation. We stub the
 *      dynamic `@/integrations/supabase/client.server` import so the
 *      handler can proceed to the query stage without a live DB, and
 *      assert we reach the PostgREST layer only when input is valid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/api/public/hooks/reconcile-payments";

const ANON = "test-anon-key";
const POST = (Route.options as any).server.handlers.POST as (ctx: {
  request: Request;
}) => Promise<Response>;

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/public/hooks/reconcile-payments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Track whether the handler tried to reach the Supabase layer. If any
// validation-error test triggers this, the test fails — the whole point
// of the contract is that rejection happens BEFORE the query.
let supabaseImportCount = 0;
let queryLimitCount = 0;

beforeEach(() => {
  supabaseImportCount = 0;
  queryLimitCount = 0;
  process.env.SUPABASE_PUBLISHABLE_KEY = ANON;

  // Intercept the two dynamic imports the handler performs post-validation.
  vi.doMock("@/integrations/supabase/client.server", () => {
    supabaseImportCount += 1;
    const makeQuery = (): any => ({
      select: () => makeQuery(),
      filter: () => makeQuery(),
      gte: () => makeQuery(),
      order: () => makeQuery(),
      limit: () => {
        queryLimitCount += 1;
        return Promise.resolve({ data: [], error: null });
      },
    });
    return {
      supabaseAdmin: {
        from: () => makeQuery(),
      },
    };
  });
  vi.doMock("@/lib/payments/reconcile-one.server", () => ({
    reconcileSinglePayment: async () => ({ status: "skipped" as const }),
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/integrations/supabase/client.server");
  vi.doUnmock("@/lib/payments/reconcile-one.server");
});

describe("reconcile-payments — input validation gate", () => {
  it("rejects `statuses` that is not an array with 400 INVALID_STATUSES", async () => {
    const res = await POST({
      request: buildRequest({ statuses: "paid" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: "INVALID_STATUSES",
      received: "string",
    });
    expect(typeof body.message).toBe("string");
    // No Supabase touch. No query. Ever.
    expect(supabaseImportCount).toBe(0);
    expect(queryLimitCount).toBe(0);
  });

  it("rejects `statuses` array containing invalid enum values with 400 INVALID_PAYMENT_STATUS", async () => {
    const res = await POST({
      request: buildRequest({
        statuses: ["paid", "pending", "SUCCESS", "refunded"],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: "INVALID_PAYMENT_STATUS",
      invalid: ["pending", "SUCCESS"],
      allowed: ["created", "attempted", "paid", "failed", "refunded"],
    });
    expect(supabaseImportCount).toBe(0);
    expect(queryLimitCount).toBe(0);
  });

  it("rejects a single invalid value even when it would produce zero DB matches", async () => {
    // Regression: coerce-then-fallback previously turned `["pending"]` into
    // the default status set, silently reconciling everything. Now it 400s.
    const res = await POST({
      request: buildRequest({ statuses: ["pending"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PAYMENT_STATUS");
    expect(body.invalid).toEqual(["pending"]);
    expect(supabaseImportCount).toBe(0);
    expect(queryLimitCount).toBe(0);
  });

  it("returns 401 when the anon apikey header is missing (auth outranks validation)", async () => {
    const res = await POST({
      request: new Request(
        "http://localhost/api/public/hooks/reconcile-payments",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ statuses: ["not-a-real-status"] }),
        },
      ),
    });
    expect(res.status).toBe(401);
    expect(supabaseImportCount).toBe(0);
    expect(queryLimitCount).toBe(0);
  });

  it("omitted `statuses` is treated as 'use defaults', not rejected", async () => {
    const res = await POST({ request: buildRequest({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.statuses).toEqual([
      "created",
      "attempted",
      "paid",
      "failed",
    ]);
    // Handler proceeded to the query stage exactly once.
    expect(supabaseImportCount).toBe(1);
    expect(queryLimitCount).toBe(1);
  });

  it("valid `statuses` array is deduped and passed through to the query stage", async () => {
    const res = await POST({
      request: buildRequest({ statuses: ["paid", "paid", "refunded"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.statuses).toEqual(["paid", "refunded"]);
    expect(queryLimitCount).toBe(1);
  });
});
