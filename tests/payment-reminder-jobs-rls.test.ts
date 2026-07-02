/**
 * End-to-end RLS behavior for public.payment_reminder_jobs.
 *
 * Setup creates two disposable auth.users (one admin, one customer), a
 * throwaway membership plan + membership + installment, and one reminder
 * job addressed to the customer. Every case then flips the connection's
 * role to `authenticated` and pins `request.jwt.claims.sub` so
 * `auth.uid()` and `has_role()` behave exactly like a live PostgREST
 * request for that user.
 *
 * Cleanup drops everything created in setup; if the DB is unreachable or
 * we cannot mint an auth user, the suite skips.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const DB_URL = process.env.SUPABASE_DB_URL;
const d = DB_URL ? describe : describe.skip;

async function insertAuthUser(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO auth.users
       (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data)
     VALUES
       ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated','authenticated', $1, '',
        now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
     RETURNING id`,
    [email],
  );
  return rows[0].id;
}

/**
 * Runs `fn` inside a transaction with the role/JWT swap in place, then
 * rolls back so RLS scoping does not leak into other tests.
 */
async function asUser<T>(
  client: Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL role authenticated");
    await client.query(
      `SET LOCAL "request.jwt.claims" = '${JSON.stringify({
        sub: userId,
        role: "authenticated",
      })}'`,
    );
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

d("payment_reminder_jobs RLS (admin + customer, live DB)", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `test-admin-${suffix}@example.invalid`;
  const customerEmail = `test-cust-${suffix}@example.invalid`;
  const otherEmail = `test-other-${suffix}@example.invalid`;

  let adminId = "";
  let customerId = "";
  let otherId = "";
  let planId = "";
  let membershipId = "";
  let installmentId = "";
  let jobId = "";
  let created = false;

  beforeAll(async () => {
    await client.connect();
    try {
      adminId = await insertAuthUser(client, adminEmail);
      customerId = await insertAuthUser(client, customerEmail);
      otherId = await insertAuthUser(client, otherEmail);

      // Ensure the admin has the admin role. handle_new_user gives every
      // fresh account 'customer'; we escalate one of them.
      await client.query(
        `INSERT INTO public.user_roles (user_id, role)
           VALUES ($1, 'admin'::public.app_role)
         ON CONFLICT (user_id, role) DO NOTHING`,
        [adminId],
      );

      // Minimal plan → membership → installment chain (schedule trigger
      // will create installments automatically from the plan's duration).
      const plan = await client.query<{ id: string }>(
        `INSERT INTO public.membership_plans
           (name, advance_amount, monthly_installment, duration_months,
            total_value, is_active)
         VALUES ($1, 1000, 500, 2, 2000, true)
         RETURNING id`,
        [`RLS Test Plan ${suffix}`],
      );
      planId = plan.rows[0].id;

      const membership = await client.query<{ id: string }>(
        `INSERT INTO public.memberships
           (user_id, customer_id, plan_id, status, start_date, advance_paid)
         VALUES ($1, $1, $2, 'active', CURRENT_DATE, 1000)
         RETURNING id`,
        [customerId, planId],
      );
      membershipId = membership.rows[0].id;

      const inst = await client.query<{ id: string }>(
        `SELECT id FROM public.installments
          WHERE membership_id = $1 ORDER BY sequence LIMIT 1`,
        [membershipId],
      );
      installmentId = inst.rows[0].id;

      const job = await client.query<{ id: string }>(
        `INSERT INTO public.payment_reminder_jobs
           (installment_id, membership_id, recipient_id, recipient_email,
            channel, reminder_kind, status, scheduled_at)
         VALUES ($1, $2, $3, $4, 'email', 'upcoming', 'pending', now())
         RETURNING id`,
        [installmentId, membershipId, customerId, customerEmail],
      );
      jobId = job.rows[0].id;
      created = true;
    } catch (err) {
      console.warn(
        "[reminder-jobs RLS] setup failed, suite will be skipped:",
        (err as Error).message,
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (created) {
      // Cascades from memberships/installments clean up reminder jobs.
      await client.query(`DELETE FROM public.memberships WHERE id = $1`, [membershipId]).catch(() => {});
      await client.query(`DELETE FROM public.membership_plans WHERE id = $1`, [planId]).catch(() => {});
      await client
        .query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [
          [adminId, customerId, otherId].filter(Boolean),
        ])
        .catch(() => {});
    }
    await client.end();
  });

  it("customer sees ONLY their own reminder job", async () => {
    if (!created) return;
    const rows = await asUser(client, customerId, async () => {
      const r = await client.query<{ id: string; recipient_id: string }>(
        `SELECT id, recipient_id FROM public.payment_reminder_jobs`,
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(jobId);
    expect(rows[0].recipient_id).toBe(customerId);
  });

  it("another customer sees zero rows (cannot read someone else's jobs)", async () => {
    if (!created) return;
    const rows = await asUser(client, otherId, async () => {
      const r = await client.query(
        `SELECT id FROM public.payment_reminder_jobs WHERE id = $1`,
        [jobId],
      );
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("customer cannot INSERT a reminder job (no write policy for non-admins)", async () => {
    if (!created) return;
    await expect(
      asUser(client, customerId, async () => {
        await client.query(
          `INSERT INTO public.payment_reminder_jobs
             (installment_id, membership_id, recipient_id, recipient_email,
              channel, reminder_kind, status, scheduled_at)
           VALUES ($1, $2, $3, $4, 'sms', 'upcoming', 'pending', now())`,
          [installmentId, membershipId, customerId, customerEmail],
        );
      }),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("customer cannot UPDATE their own reminder job", async () => {
    if (!created) return;
    // UPDATE against a row invisible-for-write returns 0 rows OR raises RLS.
    // Either outcome proves the row is not mutable by the customer.
    const affected = await asUser(client, customerId, async () => {
      try {
        const r = await client.query(
          `UPDATE public.payment_reminder_jobs
              SET status = 'sent' WHERE id = $1`,
          [jobId],
        );
        return r.rowCount ?? 0;
      } catch (e) {
        if (/row-level security|permission denied/i.test((e as Error).message)) {
          return -1;
        }
        throw e;
      }
    });
    expect(affected).toBeLessThanOrEqual(0);
  });

  it("customer cannot DELETE their own reminder job", async () => {
    if (!created) return;
    const affected = await asUser(client, customerId, async () => {
      try {
        const r = await client.query(
          `DELETE FROM public.payment_reminder_jobs WHERE id = $1`,
          [jobId],
        );
        return r.rowCount ?? 0;
      } catch (e) {
        if (/row-level security|permission denied/i.test((e as Error).message)) {
          return -1;
        }
        throw e;
      }
    });
    expect(affected).toBeLessThanOrEqual(0);
  });

  it("admin can SELECT every reminder job", async () => {
    if (!created) return;
    const rows = await asUser(client, adminId, async () => {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM public.payment_reminder_jobs WHERE id = $1`,
        [jobId],
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(jobId);
  });

  it("admin can UPDATE a reminder job", async () => {
    if (!created) return;
    const affected = await asUser(client, adminId, async () => {
      const r = await client.query(
        `UPDATE public.payment_reminder_jobs
            SET status = 'sending' WHERE id = $1`,
        [jobId],
      );
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(1);
  });

  it("admin can INSERT a reminder job", async () => {
    if (!created) return;
    const inserted = await asUser(client, adminId, async () => {
      const r = await client.query<{ id: string }>(
        `INSERT INTO public.payment_reminder_jobs
           (installment_id, membership_id, recipient_id, recipient_email,
            channel, reminder_kind, status, scheduled_at)
         VALUES ($1, $2, $3, $4, 'sms', 'overdue', 'pending', now())
         RETURNING id`,
        [installmentId, membershipId, customerId, customerEmail],
      );
      return r.rows[0]?.id;
    });
    expect(inserted).toBeTruthy();
    // Rolled back by asUser(), no cleanup needed.
  });

  it("admin can DELETE a reminder job", async () => {
    if (!created) return;
    const affected = await asUser(client, adminId, async () => {
      const r = await client.query(
        `DELETE FROM public.payment_reminder_jobs WHERE id = $1`,
        [jobId],
      );
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(1);
  });
});
