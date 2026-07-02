/**
 * Schema/migration invariants for public.payment_reminder_jobs.
 *
 * This is the pgTAP-style half of the reminder-jobs RLS verification: it
 * runs directly against Postgres and asserts the structural rules that
 * every migration touching this table must preserve. Behaviour of the
 * policies themselves is exercised in `payment-reminder-jobs-rls.test.ts`.
 *
 * Gated on SUPABASE_DB_URL so `bunx vitest run` stays green without DB.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DB_URL = process.env.SUPABASE_DB_URL;
const d = DB_URL ? describe : describe.skip;

d("payment_reminder_jobs schema invariants", () => {
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

  it("has RLS enabled", async () => {
    const { rows } = await client.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class
        WHERE relname = 'payment_reminder_jobs'
          AND relnamespace = 'public'::regnamespace`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("has the admin-manage-all and customer-read-own policies (and no anon-SELECT policy)", async () => {
    const { rows } = await client.query<{
      policyname: string;
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT policyname, cmd, roles, qual, with_check
         FROM pg_policies
        WHERE schemaname='public' AND tablename='payment_reminder_jobs'
        ORDER BY policyname`,
    );

    const admin = rows.find((r) => /admin/i.test(r.policyname));
    const cust = rows.find((r) => /customer/i.test(r.policyname));

    expect(admin, "admin policy present").toBeTruthy();
    expect(admin!.cmd).toBe("ALL");
    expect(admin!.qual).toMatch(/has_role\(auth\.uid\(\), 'admin'::app_role\)/);
    expect(admin!.with_check).toMatch(
      /has_role\(auth\.uid\(\), 'admin'::app_role\)/,
    );

    expect(cust, "customer read-own policy present").toBeTruthy();
    expect(cust!.cmd).toBe("SELECT");
    expect(cust!.qual).toMatch(/recipient_id = auth\.uid\(\)/);
    // Read-only for customers: no INSERT/UPDATE/DELETE policy for them
    for (const r of rows) {
      if (r === admin) continue;
      expect(
        r.cmd,
        `unexpected non-admin write policy ${r.policyname}`,
      ).toBe("SELECT");
    }
    // Explicitly no policy targeting 'anon'
    for (const r of rows) {
      expect(
        r.roles.includes("anon"),
        `policy ${r.policyname} must not target anon`,
      ).toBe(false);
    }
  });

  it("grants service_role and authenticated table access", async () => {
    // Read ACL directly from pg_class to avoid depending on the connected
    // role's own visibility into information_schema grants.
    const { rows } = await client.query<{ relacl: string[] }>(
      `SELECT COALESCE(relacl::text[], '{}') AS relacl
         FROM pg_class
        WHERE relname='payment_reminder_jobs'
          AND relnamespace='public'::regnamespace`,
    );
    const acl = rows[0]?.relacl ?? [];
    const has = (role: string) => acl.some((entry) => entry.startsWith(`${role}=`));
    expect(has("service_role"), "service_role grant present").toBe(true);
    expect(has("authenticated"), "authenticated grant present").toBe(true);
  });

  it("enforces (installment_id, channel, reminder_kind) uniqueness", async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public'
          AND tablename='payment_reminder_jobs'`,
    );
    const unique = rows.find(
      (r) =>
        /UNIQUE/i.test(r.indexdef) &&
        /installment_id/.test(r.indexdef) &&
        /channel/.test(r.indexdef) &&
        /reminder_kind/.test(r.indexdef),
    );
    expect(unique, "unique index on (installment_id, channel, reminder_kind)").toBeTruthy();
  });

  it("cascades deletes from installments and memberships", async () => {
    const { rows } = await client.query<{
      conname: string;
      confdeltype: string;
      column_name: string;
    }>(
      `SELECT c.conname, c.confdeltype, a.attname AS column_name
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE t.relname='payment_reminder_jobs'
          AND t.relnamespace='public'::regnamespace
          AND c.contype='f'`,
    );
    const byCol = new Map(rows.map((r) => [r.column_name, r.confdeltype]));
    // 'c' = CASCADE in pg_constraint.confdeltype
    expect(byCol.get("installment_id")).toBe("c");
    expect(byCol.get("membership_id")).toBe("c");
  });

  it("keeps updated_at fresh via a BEFORE UPDATE trigger", async () => {
    const { rows } = await client.query<{ tgname: string; proname: string }>(
      `SELECT tg.tgname, p.proname
         FROM pg_trigger tg
         JOIN pg_class c  ON c.oid = tg.tgrelid
         JOIN pg_proc  p  ON p.oid = tg.tgfoid
        WHERE c.relname='payment_reminder_jobs'
          AND c.relnamespace='public'::regnamespace
          AND NOT tg.tgisinternal`,
    );
    const hit = rows.find((r) => r.proname === "set_updated_at");
    expect(hit, "set_updated_at trigger present").toBeTruthy();
  });
});
