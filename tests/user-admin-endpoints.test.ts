/**
 * Integration test: admin user-management server functions end-to-end.
 *
 * Covers the four HTTP-callable endpoints defined in
 * `src/lib/user-admin.functions.ts` that back the admin Users page:
 *
 *   • listAllUsers
 *   • setUserBan            (revoke / restore)
 *   • deleteUser            (with last-admin safeguard)
 *   • sendPasswordResetEmail
 *   • generateTemporaryPassword (temp password reset)
 *
 * We assert three things per endpoint:
 *
 *   1. **Wiring** — the server function is defined with
 *      `requireSupabaseAuth` middleware and the very first `await` inside
 *      its handler is `assertAdmin(context)`. Anyone deleting the guard
 *      makes this test fail without needing a database.
 *
 *   2. **Input validation** — invalid userIds / missing or too-short
 *      reasons are rejected by the Zod input validator BEFORE the handler
 *      touches Supabase or the auth admin API.
 *
 *   3. **DB safety net (integration)** — with SUPABASE_DB_URL, verifies
 *      the pieces the handlers depend on are actually present in the
 *      running database:
 *        - `admin_audit_log` accepts each action string the endpoints
 *          write (`user.revoked`, `user.restored`, `user.deleted`,
 *          `user.password_reset_email`, `user.password_generated`).
 *        - `public.count_active_admins()` exists and returns an int — this
 *          is the RPC that powers the "last active administrator" safeguard
 *          in both setUserBan (revoke) and deleteUser.
 *        - `auth.users.banned_until` column exists — the field
 *          `admin_list_users` selects and `setUserBan` toggles via
 *          `auth.admin.updateUserById({ ban_duration })`.
 *
 * The DB half is gated behind SUPABASE_DB_URL so `bunx vitest run` stays
 * green in environments without database access.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  deleteUser,
  generateTemporaryPassword,
  listAllUsers,
  sendPasswordResetEmail,
  setUserBan,
} from "@/lib/user-admin.functions";

const SRC = readFileSync(
  resolve(__dirname, "../src/lib/user-admin.functions.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Wiring: every endpoint runs requireSupabaseAuth + assertAdmin first
// ---------------------------------------------------------------------------

function firstAwaitInHandler(exportName: string): string | undefined {
  const re = new RegExp(
    `export const ${exportName}[\\s\\S]*?\\.handler\\(async \\(\\{[^}]*\\}\\)[^{]*\\{([\\s\\S]*?)\\n {2}\\}\\);`,
  );
  const match = SRC.match(re);
  if (!match) return undefined;
  const body = match[1];
  const firstAwait = body.match(/await\s+([A-Za-z_$][\w$]*)/);
  return firstAwait?.[1];
}

function hasAuthMiddleware(exportName: string): boolean {
  const re = new RegExp(
    `export const ${exportName}[\\s\\S]*?\\.middleware\\(\\[requireSupabaseAuth\\]\\)`,
  );
  return re.test(SRC);
}

describe("admin user-management wiring", () => {
  const endpoints = [
    { name: "listAllUsers", fn: listAllUsers },
    { name: "setUserBan", fn: setUserBan },
    { name: "deleteUser", fn: deleteUser },
    { name: "sendPasswordResetEmail", fn: sendPasswordResetEmail },
    { name: "generateTemporaryPassword", fn: generateTemporaryPassword },
  ] as const;

  for (const { name, fn } of endpoints) {
    it(`${name} is a server function`, () => {
      expect(fn).toBeTypeOf("function");
    });

    it(`${name} requires an authenticated caller (requireSupabaseAuth)`, () => {
      expect(hasAuthMiddleware(name)).toBe(true);
    });

    it(`${name} calls assertAdmin as its first await`, () => {
      expect(firstAwaitInHandler(name)).toBe("assertAdmin");
    });
  }

  it("setUserBan prevents self-revoke before touching the auth admin API", () => {
    expect(SRC).toMatch(
      /data\.userId === context\.userId && data\.banned[\s\S]*?You cannot revoke your own account\./,
    );
  });

  it("deleteUser prevents self-delete before touching the auth admin API", () => {
    expect(SRC).toMatch(
      /data\.userId === context\.userId[\s\S]*?You cannot delete your own account\./,
    );
  });

  it("setUserBan checks count_active_admins before revoking an admin", () => {
    // Guard order matters: last-admin check must precede the ban call.
    const guardIdx = SRC.search(/last active administrator[^\n]*revoking/i);
    const banIdx = SRC.search(/ban_duration:\s*data\.banned/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(banIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(banIdx);
    expect(SRC).toMatch(/rpc\("count_active_admins"\)/);
  });

  it("deleteUser checks count_active_admins before deleting an admin", () => {
    const guardIdx = SRC.search(/last active administrator[^\n]*deleting/i);
    const deleteIdx = SRC.search(/auth\.admin\.deleteUser\(data\.userId\)/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(deleteIdx);
  });

  it("sendPasswordResetEmail delegates to supabaseAdmin.auth.resetPasswordForEmail", () => {
    expect(SRC).toMatch(
      /supabaseAdmin\.auth\.resetPasswordForEmail\(email\)/,
    );
    // And writes an audit entry with the exact action string.
    expect(SRC).toMatch(/action:\s*"user\.password_reset_email"/);
  });

  it("generateTemporaryPassword rotates via auth.admin.updateUserById and audits", () => {
    expect(SRC).toMatch(
      /supabaseAdmin\.auth\.admin\.updateUserById\(data\.userId,\s*\{\s*password/,
    );
    expect(SRC).toMatch(/action:\s*"user\.password_generated"/);
    // Refuses to rotate the caller's own password.
    expect(SRC).toMatch(
      /data\.userId === context\.userId[\s\S]*?rotate your own password/,
    );
  });

  it("setUserBan writes the correct revoke/restore action strings", () => {
    expect(SRC).toMatch(/action:\s*data\.banned \? "user\.revoked" : "user\.restored"/);
  });

  it("deleteUser writes the user.deleted audit action", () => {
    expect(SRC).toMatch(/action:\s*"user\.deleted"/);
  });
});

// ---------------------------------------------------------------------------
// Input validation: Zod rejects bad input before the handler runs
// ---------------------------------------------------------------------------

const GOOD_UUID = "00000000-0000-0000-0000-000000000123";
const GOOD_REASON = "Integration test — verifying input validation.";

describe("admin user-management input validation", () => {
  const cases = [
    { name: "setUserBan", fn: setUserBan, extra: { banned: true } },
    { name: "deleteUser", fn: deleteUser, extra: {} },
    { name: "sendPasswordResetEmail", fn: sendPasswordResetEmail, extra: {} },
    { name: "generateTemporaryPassword", fn: generateTemporaryPassword, extra: {} },
  ] as const;

  for (const { name, fn, extra } of cases) {
    it(`${name} rejects a non-UUID userId`, async () => {
      await expect(
        (fn as unknown as (a: { data: unknown }) => Promise<unknown>)({
          data: { userId: "not-a-uuid", reason: GOOD_REASON, ...extra },
        }),
      ).rejects.toThrow();
    });

    it(`${name} rejects a missing reason`, async () => {
      await expect(
        (fn as unknown as (a: { data: unknown }) => Promise<unknown>)({
          data: { userId: GOOD_UUID, ...extra },
        }),
      ).rejects.toThrow();
    });

    it(`${name} rejects a too-short reason`, async () => {
      await expect(
        (fn as unknown as (a: { data: unknown }) => Promise<unknown>)({
          data: { userId: GOOD_UUID, reason: "no", ...extra },
        }),
      ).rejects.toThrow();
    });
  }

  it("setUserBan requires the `banned` boolean", async () => {
    await expect(
      (setUserBan as unknown as (a: { data: unknown }) => Promise<unknown>)({
        data: { userId: GOOD_UUID, reason: GOOD_REASON },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB integration: the schema pieces the endpoints depend on
// ---------------------------------------------------------------------------

const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("admin user-management DB dependencies (integration)", () => {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  const runTag = `vitest-user-admin-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const insertedAuditIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    if (insertedAuditIds.length) {
      try {
        await client.query(
          `DELETE FROM public.admin_audit_log WHERE id = ANY($1::uuid[])`,
          [insertedAuditIds],
        );
      } catch {
        /* best-effort cleanup */
      }
    }
    await client.end();
  });

  it("public.count_active_admins() exists and returns an int (powers last-admin safeguard)", async () => {
    const fn = await client.query<{ src: string; prorettype: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src,
              format_type(p.prorettype, NULL) AS prorettype
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'count_active_admins'`,
    );
    expect(fn.rowCount).toBe(1);
    expect(fn.rows[0].prorettype).toBe("integer");
    // The RPC MUST exclude banned users, otherwise revoking an admin then
    // trying to revoke another would incorrectly succeed.
    expect(fn.rows[0].src).toMatch(/banned_until/i);

    const { rows } = await client.query<{ n: number }>(
      `SELECT public.count_active_admins() AS n`,
    );
    expect(typeof rows[0].n).toBe("number");
    expect(rows[0].n).toBeGreaterThanOrEqual(0);
  });

  it("auth.users has the banned_until column selected by admin_list_users", async () => {
    const { rows } = await client.query<{ data_type: string }>(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'auth'
          AND table_name = 'users'
          AND column_name = 'banned_until'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("admin_audit_log accepts every action string written by the endpoints", async () => {
    // Reuse an existing profile as actor — audit_log.actor_id FKs profiles.
    const actor = await client.query<{ id: string }>(
      `SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1`,
    );
    if (actor.rowCount === 0) {
      console.warn("[user-admin] no profile available for audit-log seed");
      return;
    }
    const actorId = actor.rows[0].id;

    const actions = [
      "user.revoked",
      "user.restored",
      "user.deleted",
      "user.password_reset_email",
      "user.password_generated",
    ];

    for (const action of actions) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO public.admin_audit_log
           (actor_id, actor_email, target_user_id, target_email,
            action, role_before, role_after, reason, metadata)
         VALUES ($1, 'vitest@example.invalid', $1, 'target@example.invalid',
                 $2, NULL, NULL, $3, '{}'::jsonb)
         RETURNING id`,
        [actorId, action, `${runTag} — ${action}`],
      );
      expect(res.rowCount).toBe(1);
      insertedAuditIds.push(res.rows[0].id);
    }
  });

  it("admin_list_users RPC exists (backing listAllUsers) and is admin-gated", async () => {
    const fn = await client.query<{ src: string; secdef: boolean }>(
      `SELECT pg_get_functiondef(p.oid) AS src, p.prosecdef AS secdef
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'admin_list_users'`,
    );
    expect(fn.rowCount).toBe(1);
    expect(fn.rows[0].secdef).toBe(true);
    expect(fn.rows[0].src).toMatch(/has_role\s*\(\s*auth\.uid\(\)\s*,\s*'admin'\s*\)/i);
    expect(fn.rows[0].src).toMatch(/ERRCODE\s*=\s*'42501'/i);
    // Selects the columns AdminUserRow depends on.
    expect(fn.rows[0].src).toMatch(/banned_until/);
    expect(fn.rows[0].src).toMatch(/last_sign_in_at/);
    expect(fn.rows[0].src).toMatch(/membership_number/);
  });

  it("non-admin caller cannot execute admin_list_users (defence in depth)", async () => {
    // sandbox_exec is not an admin — has_role(auth.uid(), 'admin') is false
    // because auth.uid() is NULL here.
    await expect(
      client.query(`SELECT * FROM public.admin_list_users()`),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
