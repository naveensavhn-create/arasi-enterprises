import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const reasonSchema = z
  .string()
  .trim()
  .min(5, "Reason is required (min 5 characters).")
  .max(500, "Reason must be 500 characters or fewer.");

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required.");
}

async function writeAudit(
  supabaseAdmin: any,
  entry: {
    actor_id: string;
    actor_email: string | null;
    target_user_id: string;
    target_email: string | null;
    action: string;
    reason: string;
    metadata?: Record<string, unknown>;
  },
) {
  await supabaseAdmin.from("admin_audit_log").insert({
    actor_id: entry.actor_id,
    actor_email: entry.actor_email,
    target_user_id: entry.target_user_id,
    target_email: entry.target_email,
    action: entry.action,
    role_before: null,
    role_after: null,
    reason: entry.reason,
    metadata: (entry.metadata ?? {}) as never,
  });
}

async function lookupActor(supabaseAdmin: any, userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  return { email: data?.email ?? null, fullName: data?.full_name ?? null };
}

async function lookupTargetEmail(supabaseAdmin: any, userId: string) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

export type AdminUserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  role: "admin" | "promoter" | "customer" | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  membership_number: string | null;
};

export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase.rpc("admin_list_users");
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminUserRow[];
  });

// --- Password reset (email link) ---
export const sendPasswordResetEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId: z.string().uuid(), reason: reasonSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = await lookupTargetEmail(supabaseAdmin, data.userId);
    if (!email) throw new Error("Target user has no email address.");

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);
    if (error) throw new Error(error.message);

    const actor = await lookupActor(supabaseAdmin, context.userId);
    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: actor.email,
      target_user_id: data.userId,
      target_email: email,
      action: "user.password_reset_email",
      reason: data.reason,
    });
    return { ok: true, sentTo: email };
  });

// --- Generate temporary password ---
function generateStrongPassword(length = 16): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+?";
  const all = upper + lower + digits + symbols;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const pick = (set: string, byte: number) => set[byte % set.length];
  const required = [
    pick(upper, bytes[0]!),
    pick(lower, bytes[1]!),
    pick(digits, bytes[2]!),
    pick(symbols, bytes[3]!),
  ];
  const rest = Array.from(bytes.slice(4), (b) => pick(all, b));
  const chars = [...required, ...rest];
  // Fisher–Yates shuffle using fresh randoms
  const shuffle = new Uint8Array(chars.length);
  crypto.getRandomValues(shuffle);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

export const generateTemporaryPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId: z.string().uuid(), reason: reasonSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("Use the account settings page to rotate your own password.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const password = generateStrongPassword(16);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password,
    });
    if (error) throw new Error(error.message);

    const email = await lookupTargetEmail(supabaseAdmin, data.userId);
    const actor = await lookupActor(supabaseAdmin, context.userId);
    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: actor.email,
      target_user_id: data.userId,
      target_email: email,
      action: "user.password_generated",
      reason: data.reason,
      metadata: { length: password.length },
    });
    return { ok: true, password, email };
  });

// --- Ban / restore access ---
export const setUserBan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        banned: z.boolean(),
        reason: reasonSchema,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId && data.banned) {
      throw new Error("You cannot revoke your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // If revoking an admin, ensure they are not the last active admin.
    if (data.banned) {
      const { data: isAdmin } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", data.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (isAdmin) {
        const { data: activeAdmins } = await supabaseAdmin.rpc("count_active_admins");
        if ((activeAdmins ?? 0) <= 1) {
          throw new Error(
            "This is the last active administrator — promote another user to admin before revoking this one.",
          );
        }
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.banned ? "876000h" : "none",
    });
    if (error) throw new Error(error.message);

    if (data.banned) {
      await supabaseAdmin.auth.admin.signOut(data.userId).catch(() => undefined);
    }

    const email = await lookupTargetEmail(supabaseAdmin, data.userId);
    const actor = await lookupActor(supabaseAdmin, context.userId);
    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: actor.email,
      target_user_id: data.userId,
      target_email: email,
      action: data.banned ? "user.revoked" : "user.restored",
      reason: data.reason,
    });
    return { ok: true };
  });

// --- Delete user ---
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId: z.string().uuid(), reason: reasonSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isAdmin } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", data.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (isAdmin) {
      const { data: activeAdmins } = await supabaseAdmin.rpc("count_active_admins");
      if ((activeAdmins ?? 0) <= 1) {
        throw new Error(
          "This is the last active administrator — promote another user to admin before deleting this one.",
        );
      }
    }

    const email = await lookupTargetEmail(supabaseAdmin, data.userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    const actor = await lookupActor(supabaseAdmin, context.userId);
    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: actor.email,
      target_user_id: data.userId,
      target_email: email,
      action: "user.deleted",
      reason: data.reason,
    });
    return { ok: true };
  });
