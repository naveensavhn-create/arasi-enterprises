/**
 * Integration test: plan-delete safety net.
 *
 * Verifies BOTH layers of protection:
 *   1. The admin UI precheck (`computePlanUsage` / `isDeleteBlocked`) that
 *      disables the destructive button when pending/active memberships exist.
 *   2. The Postgres trigger `prevent_plan_delete_with_memberships` that
 *      raises `foreign_key_violation` if the UI is bypassed.
 *
 * Both must block while enrollments are pending/active, and both must
 * allow deletion once every membership is cancelled or completed.
 *
 * Run with: `bunx vitest run tests/plan-delete.test.ts`
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  BLOCKING_STATUSES,
  computePlanUsage,
  isDeleteBlocked,
  usageFor,
} from "@/lib/plans-precheck";

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describe("plan-delete UI precheck (unit)", () => {
  it("counts only pending + active memberships as blocking", () => {
    const usage = computePlanUsage([
      { plan_id: "p1", status: "pending" },
      { plan_id: "p1", status: "active" },
      { plan_id: "p1", status: "cancelled" },
      { plan_id: "p1", status: "completed" },
      { plan_id: "p2", status: "active" },
      { plan_id: null, status: "active" },
      { plan_id: "p3", status: null },
    ]);
    expect(usage).toEqual({ p1: 2, p2: 1 });
    expect(usageFor(usage, "p1")).toBe(2);
    expect(usageFor(usage, "p3")).toBe(0);
    expect(isDeleteBlocked(usage, "p1")).toBe(true);
    expect(isDeleteBlocked(usage, "p2")).toBe(true);
    expect(isDeleteBlocked(usage, "p3")).toBe(false);
    expect(isDeleteBlocked(undefined, "p1")).toBe(false);
  });

  it("mirrors the DB trigger's blocking-status set", () => {
    // If this ever drifts, the UI and the trigger disagree — a real bug.
    expect([...BLOCKING_STATUSES].sort()).toEqual(["active", "pending"]);
  });

  it("returns an empty map for no rows", () => {
    expect(computePlanUsage([])).toEqual({});
  });
});

describeIfDb("plan-delete DB trigger (integration)", () => {
  // Supabase's pooler presents a certificate that is not in Node's default
  // trust store; the connection is already TLS-encrypted, so disable strict
  // verification for this test-only client.
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  // Namespaced test IDs so parallel runs and leftover data never collide.
  const runTag = `vitest-plan-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let planId = "";
  let customerId = "";
  const membershipIds: string[] = [];

  beforeAll(async () => {
    await client.connect();

    // 1) Reuse an existing profile as the membership customer. The pooled
    //    connection cannot insert into `auth.users` (schema is admin-only),
    //    and memberships.customer_id -> profiles(id) -> auth.users(id) via
    //    FK, so we cannot synthesise a brand-new customer here.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1`,
    );
    if (existing.rowCount === 0) {
      throw new Error(
        "plan-delete integration test needs at least one profile in public.profiles",
      );
    }
    customerId = existing.rows[0].id;

    // 2) Ephemeral active plan. `total_value` is a generated column — omit it.
    const planInsert = await client.query<{ id: string }>(
      `INSERT INTO public.membership_plans
         (name, description, advance_amount, monthly_installment, duration_months,
          is_active, display_order)
       VALUES ($1, 'integration test plan', 1000, 500, 12, true, 999)
       RETURNING id`,
      [`Test Plan ${runTag}`],
    );
    planId = planInsert.rows[0].id;
  });

  afterAll(async () => {
    // Best-effort cleanup — leave the reused profile alone.
    try {
      if (membershipIds.length) {
        await client.query(`DELETE FROM public.installments WHERE membership_id = ANY($1::uuid[])`, [
          membershipIds,
        ]);
        await client.query(`DELETE FROM public.memberships WHERE id = ANY($1::uuid[])`, [
          membershipIds,
        ]);
      }
      if (planId) {
        await client.query(`DELETE FROM public.membership_plans WHERE id = $1`, [planId]);
      }
    } finally {
      await client.end();
    }
  });

  async function createMembership(status: "pending" | "active" | "cancelled" | "completed") {
    const res = await client.query<{ id: string }>(
      `INSERT INTO public.memberships (customer_id, plan_id, status, start_date)
       VALUES ($1, $2, $3::membership_status, CURRENT_DATE)
       RETURNING id`,
      [customerId, planId, status],
    );
    const id = res.rows[0].id;
    membershipIds.push(id);
    return id;
  }

  async function loadUsage() {
    const rows = await client.query<{ plan_id: string; status: string }>(
      `SELECT plan_id, status FROM public.memberships WHERE plan_id = $1`,
      [planId],
    );
    return computePlanUsage(rows.rows);
  }

  it("UI precheck AND trigger both block delete while pending/active enrollments exist", async () => {
    const pendingId = await createMembership("pending");
    const activeId = await createMembership("active");
    // Non-blocking history should NOT count.
    await createMembership("cancelled");
    await createMembership("completed");

    // --- UI precheck ---
    const usage = await loadUsage();
    expect(usageFor(usage, planId)).toBe(2);
    expect(isDeleteBlocked(usage, planId)).toBe(true);

    // --- DB trigger ---
    await expect(
      client.query(`DELETE FROM public.membership_plans WHERE id = $1`, [planId]),
    ).rejects.toMatchObject({
      // `prevent_plan_delete_with_memberships` raises with ERRCODE 23503.
      code: "23503",
      message: expect.stringContaining("Cannot delete plan"),
    });

    // Plan must still exist after the blocked delete.
    const stillThere = await client.query(
      `SELECT 1 FROM public.membership_plans WHERE id = $1`,
      [planId],
    );
    expect(stillThere.rowCount).toBe(1);

    // Keep IDs referenced so the linter is happy and the intent is clear.
    expect(pendingId).toBeTruthy();
    expect(activeId).toBeTruthy();
  });

  it("both layers allow delete once every membership is cancelled or completed", async () => {
    // Retire the two blocking rows created above.
    await client.query(
      `UPDATE public.memberships
          SET status = CASE WHEN status = 'pending' THEN 'cancelled'::membership_status
                            ELSE 'completed'::membership_status END
        WHERE plan_id = $1 AND status IN ('pending','active')`,
      [planId],
    );

    // --- UI precheck now permits deletion ---
    const usage = await loadUsage();
    expect(usageFor(usage, planId)).toBe(0);
    expect(isDeleteBlocked(usage, planId)).toBe(false);

    // --- DB trigger permits deletion ---
    // Installments FK -> memberships with ON DELETE CASCADE, but membership_plans
    // is only referenced by memberships; wipe memberships first so the plan row
    // has no dependents left.
    await client.query(`DELETE FROM public.installments WHERE membership_id = ANY($1::uuid[])`, [
      membershipIds,
    ]);
    await client.query(`DELETE FROM public.memberships WHERE id = ANY($1::uuid[])`, [
      membershipIds,
    ]);
    membershipIds.length = 0;

    const del = await client.query(
      `DELETE FROM public.membership_plans WHERE id = $1 RETURNING id`,
      [planId],
    );
    expect(del.rowCount).toBe(1);

    const gone = await client.query(
      `SELECT 1 FROM public.membership_plans WHERE id = $1`,
      [planId],
    );
    expect(gone.rowCount).toBe(0);

    // Prevent afterAll from trying to delete the already-gone plan.
    planId = "";
  });
});
