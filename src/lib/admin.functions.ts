import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const reasonSchema = z
  .string()
  .trim()
  .min(5, "Reason is required (min 5 characters).")
  .max(500, "Reason must be 500 characters or fewer.");

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  reason: reasonSchema,
});

const roleChangeSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "promoter", "customer"]),
  reason: reasonSchema,
});

type AppRole = "admin" | "promoter" | "customer";

async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}
type SupabaseAdmin = Awaited<ReturnType<typeof getAdmin>>;

async function writeAudit(
  supabaseAdmin: SupabaseAdmin,
  entry: {
    actor_id: string;
    actor_email: string | null;
    target_user_id: string;
    target_email: string | null;
    action: "promote" | "revoke" | "role_change" | "bootstrap_claim";
    role_before: AppRole | null;
    role_after: AppRole | null;
    reason: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("admin_audit_log")
    .insert({
      actor_id: entry.actor_id,
      actor_email: entry.actor_email,
      target_user_id: entry.target_user_id,
      target_email: entry.target_email,
      action: entry.action,
      role_before: entry.role_before,
      role_after: entry.role_after,
      reason: entry.reason,
      metadata: (entry.metadata ?? {}) as never,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

async function lookupProfile(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
): Promise<{ email: string | null; fullName: string | null }> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  return {
    email: data?.email ?? null,
    fullName: data?.full_name ?? null,
  };
}

async function lookupEmail(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
): Promise<string | null> {
  return (await lookupProfile(supabaseAdmin, userId)).email;
}


async function currentRole(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
): Promise<AppRole | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.role as AppRole | null) ?? null;
}


/**
 * Public status endpoint — no auth required.
 */
// PUBLIC_OK: Bootstrap probe returning only a boolean "hasAdmin"; used by the
// first-run onboarding UI before any account exists. No PII, no secrets.
export const getAdminBootstrapStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { hasAdmin: (count ?? 0) > 0 };
  },
);

/**
 * One-time bootstrap: if NO admin exists yet, the signed-in user may claim admin.
 */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count, error: countError } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error("An administrator already exists. Ask an existing admin to promote you.");
    }

    const before = await currentRole(supabaseAdmin, context.userId);
    const email = await lookupEmail(supabaseAdmin, context.userId);

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });
    if (insertError) throw new Error(insertError.message);

    await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: email,
      target_user_id: context.userId,
      target_email: email,
      action: "bootstrap_claim",
      role_before: before,
      role_after: "admin",
      reason: "Initial admin bootstrap",
    });

    return { ok: true };
  });

/**
 * Promote a user (by email) to admin. Caller MUST already be an admin.
 */
export const promoteToAdminByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => emailSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let targetId: string | null = null;
    let page = 1;
    while (page < 20 && !targetId) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error(error.message);
      const match = list.users.find((u) => u.email?.toLowerCase() === data.email);
      if (match) targetId = match.id;
      if (list.users.length < 200) break;
      page += 1;
    }
    if (!targetId) throw new Error(`No user found with email ${data.email}.`);

    const before = await currentRole(supabaseAdmin, targetId);
    const actor = await lookupProfile(supabaseAdmin, context.userId);
    const target = await lookupProfile(supabaseAdmin, targetId);

    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", targetId)
      .eq("role", "admin")
      .maybeSingle();
    if (!existing) {
      const { error: insertError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: targetId, role: "admin" });
      if (insertError) throw new Error(insertError.message);
    }

    const changedAt = new Date().toISOString();
    const auditId = await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: actor.email,
      target_user_id: targetId,
      target_email: data.email,
      action: "promote",
      role_before: before,
      role_after: "admin",
      reason: data.reason ?? null,
      metadata: { already_admin: !!existing },
    });

    // Fire-and-log email notification (never fail the promote if email breaks)
    try {
      const { sendRoleChangeEmail } = await import("@/lib/email/send-role-change.server");
      await sendRoleChangeEmail({
        kind: "promote",
        recipientEmail: data.email,
        recipientName: target.fullName,
        actorName: actor.fullName ?? actor.email ?? "Administrator",
        actorEmail: actor.email ?? "unknown@arasienterprises.com",
        previousRole: before ?? "customer",
        newRole: "admin",
        changedAt,
        reason: data.reason,
        targetUserId: targetId,
        auditId,
        triggeredBy: context.userId,
      });
    } catch (e) {
      console.error("[admin.promoteToAdminByEmail] email send failed", e);
    }

    return { ok: true, userId: targetId };
  });



/**
 * Change a user's role (admin only). Safeguards against demoting the last admin.
 */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => roleChangeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Last-admin safeguard: applies to ANY admin being demoted, not just self.
    if (data.role !== "admin") {
      const { data: targetIsAdmin } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", data.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (targetIsAdmin) {
        const { count } = await supabaseAdmin
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("role", "admin");
        if ((count ?? 0) <= 1) {
          throw new Error(
            "LAST_ADMIN: This is the only administrator account. Promote another user to admin before revoking this one — otherwise no one will be able to manage the system.",
          );
        }
      }
    }


    const before = await currentRole(supabaseAdmin, data.userId);
    const actor = await lookupProfile(supabaseAdmin, context.userId);
    const target = await lookupProfile(supabaseAdmin, data.userId);

    const { error: deleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (deleteError) throw new Error(deleteError.message);

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (insertError) throw new Error(insertError.message);

    const action =
      before === "admin" && data.role !== "admin"
        ? "revoke"
        : data.role === "admin" && before !== "admin"
          ? "promote"
          : "role_change";

    const changedAt = new Date().toISOString();
    const auditId = await writeAudit(supabaseAdmin, {
      actor_id: context.userId,
      actor_email: actor.email,
      target_user_id: data.userId,
      target_email: target.email,
      action,
      role_before: before,
      role_after: data.role,
      reason: data.reason ?? null,
    });

    // Fire-and-log email notification when the change is a promote or revoke.
    if ((action === "promote" || action === "revoke") && target.email) {
      try {
        const { sendRoleChangeEmail } = await import("@/lib/email/send-role-change.server");
        await sendRoleChangeEmail({
          kind: action,
          recipientEmail: target.email,
          recipientName: target.fullName,
          actorName: actor.fullName ?? actor.email ?? "Administrator",
          actorEmail: actor.email ?? "unknown@arasienterprises.com",
          previousRole: before ?? "customer",
          newRole: data.role,
          changedAt,
          reason: data.reason,
          targetUserId: data.userId,
          auditId,
          triggeredBy: context.userId,
        });
      } catch (e) {
        console.error("[admin.setUserRole] email send failed", e);
      }
    }

    return { ok: true };
  });


/**
 * List all admins (admin only).
 */
export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, created_at")
      .eq("role", "admin");
    if (error) throw new Error(error.message);

    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", roles.map((r) => r.user_id));
    if (profilesErr) throw new Error(profilesErr.message);

    const byId = new Map(profiles.map((p) => [p.id, p]));
    return roles.map((r) => ({
      userId: r.user_id,
      grantedAt: r.created_at,
      email: byId.get(r.user_id)?.email ?? null,
      fullName: byId.get(r.user_id)?.full_name ?? null,
    }));
  });

/**
 * List admin audit log entries (admin only), most recent first.
 */
export const listAdminAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { data, error } = await context.supabase
      .from("admin_audit_log")
      .select(
        "id, created_at, action, actor_id, actor_email, target_user_id, target_email, role_before, role_after, reason, metadata",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const testEmailSchema = z.object({
  kind: z.enum(["promote", "revoke"]),
  recipientEmail: z.string().trim().toLowerCase().email().max(255).optional(),
});

/**
 * Sends a role-change email to the caller (or a chosen address) to validate
 * template rendering + delivery infrastructure. Records the attempt in
 * role_email_notifications with is_test=true.
 */
export const sendRoleChangeTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testEmailSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actor = await lookupProfile(supabaseAdmin, context.userId);
    const recipient = data.recipientEmail ?? actor.email;
    if (!recipient) throw new Error("No recipient email available for test send.");

    const { sendRoleChangeEmail } = await import("@/lib/email/send-role-change.server");
    const result = await sendRoleChangeEmail({
      kind: data.kind,
      recipientEmail: recipient,
      recipientName: actor.fullName,
      actorName: actor.fullName ?? actor.email ?? "Administrator",
      actorEmail: actor.email ?? "unknown@arasienterprises.com",
      previousRole: data.kind === "promote" ? "customer" : "admin",
      newRole: data.kind === "promote" ? "admin" : "customer",
      changedAt: new Date().toISOString(),
      reason: "Test email triggered from Admin Settings to verify delivery.",
      targetUserId: context.userId,
      triggeredBy: context.userId,
      isTest: true,
    });
    return result;
  });

export interface RoleEmailNotification {
  id: string;
  audit_id: string | null;
  target_user_id: string | null;
  recipient_email: string;
  template_name: string;
  subject: string | null;
  status: string;
  message_id: string | null;
  error_message: string | null;
  is_test: boolean;
  triggered_by: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Lists the 100 most recent role-change email notifications (admin only).
 */
export const listRoleEmailNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RoleEmailNotification[]> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { data, error } = await context.supabase
      .from("role_email_notifications")
      .select("id, audit_id, target_user_id, recipient_email, template_name, subject, status, message_id, error_message, is_test, triggered_by, metadata, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      ...r,
      metadata: r.metadata == null ? null : JSON.stringify(r.metadata),
    })) as RoleEmailNotification[];
  });

