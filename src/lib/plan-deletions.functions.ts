import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const filtersSchema = z.object({
  q: z.string().trim().optional().default(""),
  actor: z.string().trim().optional().default(""),
  plan: z.string().trim().optional().default(""),
  status: z.enum(["all", "blocked", "success"]).optional().default("all"),
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(200).optional().default(50),
});

export type PlanDeletionRow = {
  id: string;
  created_at: string;
  action: "plan_delete_blocked" | "plan_delete_success";
  actor_id: string;
  actor_email: string | null;
  plan_id: string | null;
  plan_name: string | null;
  counts: { pending: number; active: number; cancelled: number; completed: number; blocking: number; total: number };
  error_message: string | null;
  metadata: Record<string, unknown>;
};

export type PlanDeletionListResult = {
  rows: PlanDeletionRow[];
  total: number;
  page: number;
  pageSize: number;
};

export const listPlanDeletionAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtersSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PlanDeletionListResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const actions =
      data.status === "blocked"
        ? ["plan_delete_blocked"]
        : data.status === "success"
        ? ["plan_delete_success"]
        : ["plan_delete_blocked", "plan_delete_success"];

    let query = context.supabase
      .from("admin_audit_log")
      .select("id, created_at, action, actor_id, actor_email, metadata", { count: "exact" })
      .in("action", actions)
      .order("created_at", { ascending: false });

    if (data.actor) query = query.ilike("actor_email", `%${data.actor}%`);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lt("created_at", data.to);

    // Server-side pagination happens after client filtering below when we need
    // to match plan_name inside metadata; do a wider fetch then filter.
    const needsMetaFilter = !!(data.plan || data.q);
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    if (!needsMetaFilter) query = query.range(from, to);
    else query = query.range(0, 999); // cap

    const { data: raw, error, count } = await query;
    if (error) throw new Error(error.message);

    let mapped: PlanDeletionRow[] = (raw ?? []).map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const counts = (m.counts ?? {}) as PlanDeletionRow["counts"];
      const dbErr = (m.db_error ?? null) as { message?: string } | null;
      return {
        id: r.id,
        created_at: r.created_at,
        action: r.action as PlanDeletionRow["action"],
        actor_id: r.actor_id,
        actor_email: r.actor_email,
        plan_id: (m.plan_id as string) ?? null,
        plan_name: (m.plan_name as string) ?? null,
        counts: {
          pending: counts?.pending ?? 0,
          active: counts?.active ?? 0,
          cancelled: counts?.cancelled ?? 0,
          completed: counts?.completed ?? 0,
          blocking: counts?.blocking ?? 0,
          total: counts?.total ?? 0,
        },
        error_message: dbErr?.message ?? null,
        metadata: m,
      };
    });

    if (needsMetaFilter) {
      const planQ = data.plan.toLowerCase();
      const q = data.q.toLowerCase();
      mapped = mapped.filter((r) => {
        if (planQ && !(r.plan_name?.toLowerCase().includes(planQ) || r.plan_id?.toLowerCase().includes(planQ))) {
          return false;
        }
        if (q) {
          const hay = `${r.actor_email ?? ""} ${r.plan_name ?? ""} ${r.plan_id ?? ""} ${r.error_message ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const total = mapped.length;
      return {
        rows: mapped.slice(from, from + data.pageSize),
        total,
        page: data.page,
        pageSize: data.pageSize,
      };
    }

    return { rows: mapped, total: count ?? mapped.length, page: data.page, pageSize: data.pageSize };
  });
