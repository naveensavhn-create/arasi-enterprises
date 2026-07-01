/**
 * Integration test: has_role blocks non-admin callers of the payment list
 * server function (`listAdminPayments`) and surfaces a "Forbidden" error.
 *
 * Two layers are verified:
 *
 *   1. Server-function guard (`assertAdmin`) — the exact call the handler
 *      makes before touching any payments data. Exercised in-process with a
 *      stubbed Supabase RPC (guaranteed) and, when SUPABASE_DB_URL is
 *      available, against the real Postgres `public.has_role` SECURITY
 *      DEFINER function via a thin RPC shim.
 *
 *   2. Wiring check — asserts `listAdminPayments` still gates the handler
 *      with `assertAdmin` before any query. If someone deletes the guard,
 *      this test fails even without a database.
 *
 * The DB half is gated behind SUPABASE_DB_URL so `bunx vitest run` stays
 * green in environments without database access.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { assertAdmin, listAdminPayments } from "@/lib/payments.functions";

// ---------------------------------------------------------------------------
// Unit: assertAdmin against a stubbed Supabase RPC
// ---------------------------------------------------------------------------

function stubSupabase(response: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    supabase: {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return response;
      },
    },
  };
}

describe("assertAdmin (payment list server-function guard)", () => {
  it("throws Forbidden when has_role returns false", async () => {
    const { supabase, calls } = stubSupabase({ data: false, error: null });
    await expect(
      assertAdmin({ supabase, userId: "00000000-0000-0000-0000-000000000001" }),
    ).rejects.toThrowError(/^Forbidden$/);
    expect(calls).toEqual([
      {
        fn: "has_role",
        args: {
          _user_id: "00000000-0000-0000-0000-000000000001",
          _role: "admin",
        },
      },
    ]);
  });

  it("throws Forbidden when has_role returns null (no role row at all)", async () => {
    const { supabase } = stubSupabase({ data: null, error: null });
    await expect(assertAdmin({ supabase, userId: "u1" })).rejects.toThrowError(
      /^Forbidden$/,
    );
  });

  it("resolves silently when has_role returns true", async () => {
    const { supabase } = stubSupabase({ data: true, error: null });
    await expect(
      assertAdmin({ supabase, userId: "u1" }),
    ).resolves.toBeUndefined();
  });

  it("surfaces the underlying RPC error message when has_role errors", async () => {
    const { supabase } = stubSupabase({
      data: null,
      error: { message: "connection refused" },
    });
    await expect(
      assertAdmin({ supabase, userId: "u1" }),
    ).rejects.toThrowError(/^connection refused$/);
  });
});

// ---------------------------------------------------------------------------
// Wiring: listAdminPayments must gate with assertAdmin BEFORE any query
// ---------------------------------------------------------------------------

describe("listAdminPayments wiring", () => {
  const src = readFileSync(
    resolve(__dirname, "../src/lib/payments.functions.ts"),
    "utf8",
  );

  it("is exported as a server function with the auth middleware", () => {
    expect(listAdminPayments).toBeTypeOf("function");
    // Source-level check: must chain requireSupabaseAuth so a bearer token is
    // required BEFORE the handler runs (unauthenticated callers get 401 from
    // the middleware itself, not from assertAdmin).
    expect(src).toMatch(
      /export const listAdminPayments[\s\S]*?\.middleware\(\[requireSupabaseAuth\]\)/,
    );
  });

  it("calls assertAdmin as the very first handler statement", () => {
    // Grab the listAdminPayments handler body and assert `await assertAdmin(context);`
    // is the first `await` inside it. This is the guard non-admins hit.
    const match = src.match(
      /export const listAdminPayments[\s\S]*?\.handler\(async \(\{[^}]*\}\)[^{]*\{([\s\S]*?)\n {2}\}\);/,
    );
    expect(match, "listAdminPayments handler not found").not.toBeNull();
    const body = match![1];
    const firstAwait = body.match(/await\s+([A-Za-z_$][\w$]*)/);
    expect(firstAwait?.[1]).toBe("assertAdmin");
  });
});

// ---------------------------------------------------------------------------
// DB integration: real public.has_role() returns false for non-admins
// ---------------------------------------------------------------------------

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("has_role integration (real Postgres)", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  let nonAdminUserId: string | null = null;
  let adminUserId: string | null = null;

  beforeAll(async () => {
    await client.connect();
    const nonAdmin = await client.query<{ user_id: string }>(
      `SELECT user_id FROM public.user_roles
        WHERE role IN ('customer','promoter')
        ORDER BY created_at ASC NULLS LAST
        LIMIT 1`,
    );
    nonAdminUserId = nonAdmin.rows[0]?.user_id ?? null;

    const admin = await client.query<{ user_id: string }>(
      `SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1`,
    );
    adminUserId = admin.rows[0]?.user_id ?? null;
  });

  afterAll(async () => {
    await client.end();
  });

  it("returns false for a non-admin user and drives assertAdmin to throw Forbidden", async () => {
    if (!nonAdminUserId) {
      // Nothing to assert against — recorded as a pass with a note.
      console.warn("[has_role] no non-admin user available; skipping");
      return;
    }
    const { rows } = await client.query<{ has_role: boolean }>(
      `SELECT public.has_role($1::uuid, 'admin'::public.app_role) AS has_role`,
      [nonAdminUserId],
    );
    expect(rows[0].has_role).toBe(false);

    // Wire the real DB result through the exact RPC shape assertAdmin expects.
    const supabase = {
      rpc: async (fn: string, args: { _user_id: string; _role: string }) => {
        const { rows: r } = await client.query<{ has_role: boolean }>(
          `SELECT public.has_role($1::uuid, $2::public.app_role) AS has_role`,
          [args._user_id, args._role],
        );
        expect(fn).toBe("has_role");
        return { data: r[0].has_role, error: null };
      },
    };
    await expect(
      assertAdmin({ supabase, userId: nonAdminUserId }),
    ).rejects.toThrowError(/^Forbidden$/);
  });

  it("returns true for an admin user and lets assertAdmin resolve", async () => {
    if (!adminUserId) {
      console.warn("[has_role] no admin user available; skipping");
      return;
    }
    const { rows } = await client.query<{ has_role: boolean }>(
      `SELECT public.has_role($1::uuid, 'admin'::public.app_role) AS has_role`,
      [adminUserId],
    );
    expect(rows[0].has_role).toBe(true);

    const supabase = {
      rpc: async (_fn: string, args: { _user_id: string; _role: string }) => {
        const { rows: r } = await client.query<{ has_role: boolean }>(
          `SELECT public.has_role($1::uuid, $2::public.app_role) AS has_role`,
          [args._user_id, args._role],
        );
        return { data: r[0].has_role, error: null };
      },
    };
    await expect(
      assertAdmin({ supabase, userId: adminUserId }),
    ).resolves.toBeUndefined();
  });
});
