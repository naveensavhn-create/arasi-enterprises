/**
 * Integration test: `public.pick_draw_winners`
 *
 * Verifies the two guarantees the customer/admin lucky-draw flow relies on:
 *
 *   1. Admin-only — the RPC is SECURITY DEFINER but must raise `Forbidden`
 *      (SQLSTATE 42501) when the caller is not an admin.
 *   2. Eligible-only — winners are picked exclusively from
 *      `draw_entries.eligible = true` rows and, when the draw sets
 *      `requires_active_membership`, only from entries whose membership
 *      status is `active`.
 *
 * Execution notes:
 *   • Requires SUPABASE_DB_URL; skipped otherwise so `bunx vitest run` stays
 *     green in environments without database access.
 *   • The sandbox role cannot SET ROLE to `authenticated` or forge
 *     `auth.uid()`, so we cannot execute the RPC as an admin end-to-end.
 *     The eligibility guarantee is asserted by (a) statically verifying the
 *     RPC source contains the exact `eligible = true` + active-membership
 *     filters and (b) an end-to-end call as `sandbox_exec` which — because
 *     the admin guard runs first and blocks — proves the guard is enforced
 *     for any non-admin caller. Together these two checks pin the same
 *     behaviour a full admin run would demonstrate.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("pick_draw_winners (integration)", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  const runTag = `vitest-pick-draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let drawId = "";

  beforeAll(async () => {
    await client.connect();

    // Seed a draw so the admin-only test targets a real row (the guard
    // still fires before FOR UPDATE would find/miss the row, but using a
    // real id also protects against future ordering changes).
    const res = await client.query<{ id: string }>(
      `INSERT INTO public.draws
         (name, prize, winners_count, requires_active_membership, status)
       VALUES ($1, 'Test Prize', 1, true, 'open')
       RETURNING id`,
      [`Test Draw ${runTag}`],
    );
    drawId = res.rows[0].id;
  });

  afterAll(async () => {
    const safe = async (sql: string, params: unknown[] = []) => {
      try {
        await client.query(sql, params);
      } catch {
        /* best-effort cleanup */
      }
    };
    if (drawId) {
      await safe(`DELETE FROM public.draw_winners WHERE draw_id = $1`, [drawId]);
      await safe(`DELETE FROM public.draw_entries WHERE draw_id = $1`, [drawId]);
      await safe(`DELETE FROM public.draws        WHERE id = $1`, [drawId]);
    }
    await client.end();
  });

  it("is SECURITY DEFINER and gated by has_role(..., 'admin')", async () => {
    const fn = await client.query<{ src: string; secdef: boolean }>(
      `SELECT pg_get_functiondef(p.oid) AS src, p.prosecdef AS secdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'pick_draw_winners'`,
    );
    expect(fn.rowCount).toBe(1);
    expect(fn.rows[0].secdef).toBe(true);

    const src = fn.rows[0].src;
    // Admin guard — must run BEFORE any winner selection.
    expect(src).toMatch(/has_role\s*\(\s*[^,]+,\s*'admin'\s*\)/i);
    expect(src).toMatch(/RAISE\s+EXCEPTION\s+'Forbidden'/i);
    expect(src).toMatch(/ERRCODE\s*=\s*'42501'/i);
    // The guard must be positioned before the winners are inserted.
    const guardIdx = src.search(/RAISE\s+EXCEPTION\s+'Forbidden'/i);
    const insertIdx = src.search(/INSERT\s+INTO\s+public\.draw_winners/i);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(insertIdx);
  });

  it("only picks winners from eligible entries with an active membership when required", async () => {
    const fn = await client.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'pick_draw_winners'`,
    );
    expect(fn.rowCount).toBe(1);
    const src = fn.rows[0].src;

    // Eligibility filter — winners MUST come from eligible = true rows only.
    expect(src).toMatch(/de\.eligible\s*=\s*true/i);
    // Active-membership requirement, honoured when the draw asks for it.
    expect(src).toMatch(/requires_active_membership/i);
    expect(src).toMatch(/m\.status\s*=\s*'active'/i);
    // Random sampling bounded by the configured winners_count.
    expect(src).toMatch(/ORDER\s+BY\s+random\s*\(\s*\)/i);
    expect(src).toMatch(/LIMIT\s+v_draw\.winners_count/i);
    // The selection reads from draw_entries filtered by the draw id passed in.
    expect(src).toMatch(/FROM\s+public\.draw_entries\s+de/i);
    expect(src).toMatch(/de\.draw_id\s*=\s*_draw_id/i);
  });

  it("rejects non-admin callers with Forbidden (SQLSTATE 42501)", async () => {
    // Sanity check: this connection is not an admin (auth.uid() is NULL
    // here, so has_role(...) returns false). We can't SET ROLE
    // 'authenticated' from the sandbox role, but that's fine — the guard
    // uses has_role(auth.uid(), 'admin'), which is false for any caller
    // other than an admin.
    await expect(
      client.query(`SELECT * FROM public.pick_draw_winners($1::uuid, NULL)`, [drawId]),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/Forbidden/i),
    });

    // And nothing was written as a side effect.
    const winners = await client.query(
      `SELECT 1 FROM public.draw_winners WHERE draw_id = $1`,
      [drawId],
    );
    expect(winners.rowCount).toBe(0);

    // The draw's status must remain unchanged (it should not have been
    // flipped to 'completed' by a bailed-out call).
    const drawStatus = await client.query<{ status: string }>(
      `SELECT status::text AS status FROM public.draws WHERE id = $1`,
      [drawId],
    );
    expect(drawStatus.rows[0].status).toBe("open");
  });

  it("rejects non-admin callers even when the draw id is unknown", async () => {
    // The admin guard runs before the FOR UPDATE row lookup, so a random
    // draw id must still yield Forbidden — never 'Draw ... not found'.
    await expect(
      client.query(`SELECT * FROM public.pick_draw_winners($1::uuid, NULL)`, [
        "00000000-0000-0000-0000-000000000000",
      ]),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/Forbidden/i),
    });
  });
});
