import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

const roleChangeSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "promoter", "customer"]),
});

/**
 * Public status endpoint — no auth required.
 * Reports whether any admin exists in the system (used to gate the one-time
 * bootstrap flow) and, if the caller is signed in, whether they are that admin.
 */
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
 * One-time bootstrap: if NO admin exists yet, the currently signed-in user
 * may claim the admin role. Once any admin exists, this endpoint refuses.
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

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });
    if (insertError) throw new Error(insertError.message);

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

    // Look up target user by email via Auth Admin API
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

    const { error: upsertError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: targetId, role: "admin" }, { onConflict: "user_id,role" });
    if (upsertError) throw new Error(upsertError.message);

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

    if (data.role !== "admin" && data.userId === context.userId) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new Error("Cannot remove the last remaining admin.");
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (deleteError) throw new Error(deleteError.message);

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (insertError) throw new Error(insertError.message);

    return { ok: true };
  });

/**
 * List all admins (admin only). Powers the settings UI.
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
