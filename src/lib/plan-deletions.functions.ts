import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];


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
  metadata: JsonValue;
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
      const m = (r.metadata ?? {}) as Record<string, JsonValue>;
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

const exportSchema = filtersSchema.omit({ page: true, pageSize: true });

export const exportPlanDeletionAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => exportSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ csv: string; count: number }> => {
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
      .select("id, created_at, action, actor_id, actor_email, metadata")
      .in("action", actions)
      .order("created_at", { ascending: false })
      .range(0, 9999);

    if (data.actor) query = query.ilike("actor_email", `%${data.actor}%`);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lt("created_at", data.to);

    const { data: raw, error } = await query;
    if (error) throw new Error(error.message);

    const planQ = data.plan.toLowerCase();
    const q = data.q.toLowerCase();

    const rows = (raw ?? [])
      .map((r) => {
        const m = (r.metadata ?? {}) as Record<string, JsonValue>;
        const counts = (m.counts ?? {}) as PlanDeletionRow["counts"];
        const dbErr = (m.db_error ?? null) as { message?: string } | null;
        return {
          id: r.id,
          created_at: r.created_at,
          action: r.action as PlanDeletionRow["action"],
          actor_id: r.actor_id,
          actor_email: r.actor_email as string | null,
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
        };
      })
      .filter((r) => {
        if (planQ && !(r.plan_name?.toLowerCase().includes(planQ) || r.plan_id?.toLowerCase().includes(planQ))) {
          return false;
        }
        if (q) {
          const hay = `${r.actor_email ?? ""} ${r.plan_name ?? ""} ${r.plan_id ?? ""} ${r.error_message ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    const headers = [
      "audit_id",
      "created_at",
      "status",
      "actor_id",
      "actor_email",
      "plan_id",
      "plan_name",
      "blocking_pending",
      "blocking_active",
      "blocking_total",
      "non_blocking_cancelled",
      "non_blocking_completed",
      "enrollments_total",
      "error_message",
    ];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.created_at,
          r.action === "plan_delete_success" ? "success" : "blocked",
          r.actor_id,
          r.actor_email ?? "",
          r.plan_id ?? "",
          r.plan_name ?? "",
          r.counts.pending,
          r.counts.active,
          r.counts.blocking,
          r.counts.cancelled,
          r.counts.completed,
          r.counts.total,
          r.error_message ?? "",
        ].map(esc).join(","),
      );
    }
    return { csv: "\ufeff" + lines.join("\n"), count: rows.length };
  });

