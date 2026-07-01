import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildPlanDeletionAuditEntry,
  computeDeletionCounts,
  parseBlockingCountFromTriggerError,
} from "@/lib/plan-deletion-audit";

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
    const rawCounts: Record<(typeof statuses)[number], number> = {
      pending: 0, active: 0, cancelled: 0, completed: 0,
    };
    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabaseAdmin
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("plan_id", data.planId)
          .eq("status", s);
        rawCounts[s] = count ?? 0;
      }),
    );
    let counts = computeDeletionCounts(rawCounts);

    // Attempt delete — trigger may still raise if blocking > 0
    const { error: deleteErr } = await supabaseAdmin
      .from("membership_plans")
      .delete()
      .eq("id", data.planId);

    // If the trigger blocked us but our pre-count says 0 blocking (race:
    // a new pending/active membership was inserted between the count
    // query and the delete), recover the count from the trigger message
    // so the audit log and UI show a truthful number instead of 0.
    if (deleteErr) {
      const parsedBlocking = parseBlockingCountFromTriggerError(deleteErr.message);
      if (parsedBlocking !== null && parsedBlocking > counts.blocking) {
        // Attribute the delta to `active` — the trigger doesn't distinguish
        // pending vs active, and `active` is the safer default to display.
        const delta = parsedBlocking - counts.blocking;
        counts = computeDeletionCounts({
          pending: rawCounts.pending,
          active: rawCounts.active + delta,
          cancelled: rawCounts.cancelled,
          completed: rawCounts.completed,
        });
      }
    }

    const entry = buildPlanDeletionAuditEntry({
      actorId: context.userId,
      actorEmail: actorProfile?.email ?? null,
      plan: { id: plan.id, name: plan.name, is_active: plan.is_active },
      counts,
      deleteError: deleteErr
        ? {
            message: deleteErr.message ?? null,
            code: (deleteErr as { code?: string } | null)?.code ?? null,
            details: (deleteErr as { details?: string } | null)?.details ?? null,
          }
        : null,
    });

    // target_user_id is NOT NULL on this table; self-target the actor since
    // plan events are not tied to a user.
    const { data: audit } = await supabaseAdmin
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
        metadata: entry.metadata as never,
      })
      .select("id")
      .single();

    const blocked = entry.action === "plan_delete_blocked";
    return {
      success: !blocked,
      blocked,
      planId: plan.id,
      planName: plan.name,
      planCode: null,
      counts,
      auditLogId: audit?.id ?? null,
      error: blocked ? (deleteErr?.message ?? "Delete blocked") : undefined,
    };
  });
