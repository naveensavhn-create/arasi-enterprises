import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const deleteSchema = z.object({ planId: z.string().uuid() });

type PlanDeleteResult = {
  success: boolean;
  blocked: boolean;
  planId: string;
  planName: string | null;
  planCode: null;
  counts: {
    pending: number;
    active: number;
    cancelled: number;
    completed: number;
    blocking: number; // pending + active
    total: number;
  };
  auditLogId: string | null;
  error?: string;
};

/**
 * Admin-only plan deletion that:
 *  1. Counts memberships per status for the plan.
 *  2. Attempts the delete (RLS bypassed via service role, but the
 *     `prevent_plan_delete_with_memberships` trigger still fires).
 *  3. Records the attempt in `admin_audit_log` with actor details and
 *     enrollment counts — both blocked and successful attempts.
 */
export const deletePlanAudited = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<PlanDeleteResult> => {
    // Authz
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Actor profile (for actor_email)
    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    // Plan snapshot
    const { data: plan, error: planErr } = await supabaseAdmin
      .from("membership_plans")
      .select("id, name, is_active")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!plan) throw new Error("Plan not found.");

    // Enrollment counts by status
    const statuses = ["pending", "active", "cancelled", "completed"] as const;
    const counts = { pending: 0, active: 0, cancelled: 0, completed: 0 };
    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabaseAdmin
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("plan_id", data.planId)
          .eq("status", s);
        counts[s] = count ?? 0;
      }),
    );
    const blocking = counts.pending + counts.active;
    const total = counts.pending + counts.active + counts.cancelled + counts.completed;

    // Attempt delete — trigger may still raise if blocking > 0
    const { error: deleteErr } = await supabaseAdmin
      .from("membership_plans")
      .delete()
      .eq("id", data.planId);

    const blocked = !!deleteErr;
    const action = blocked ? "plan_delete_blocked" : "plan_delete_success";
    const metadata = {
      plan_id: plan.id,
      plan_name: plan.name,
      plan_code: null,
      plan_was_active: plan.is_active,
      counts: { ...counts, blocking, total },
      db_error: blocked
        ? {
            message: deleteErr?.message ?? null,
            code: (deleteErr as { code?: string } | null)?.code ?? null,
            details: (deleteErr as { details?: string } | null)?.details ?? null,
          }
        : null,
    };

    // Write audit — target_user_id is NOT NULL on this table; self-target the
    // actor since plan events are not tied to a user.
    const { data: audit } = await supabaseAdmin
      .from("admin_audit_log")
      .insert({
        actor_id: context.userId,
        actor_email: actorProfile?.email ?? null,
        target_user_id: context.userId,
        target_email: actorProfile?.email ?? null,
        action,
        role_before: null,
        role_after: null,
        reason: null,
        metadata: metadata as never,
      })
      .select("id")
      .single();

    return {
      success: !blocked,
      blocked,
      planId: plan.id,
      planName: plan.name,
      planCode: null,
      counts: { ...counts, blocking, total },
      auditLogId: audit?.id ?? null,
      error: blocked ? (deleteErr?.message ?? "Delete blocked") : undefined,
    };
  });
