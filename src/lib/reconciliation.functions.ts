import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const sb: any = ctx.supabase;
  const { data, error } = await sb.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export type ReconciliationFinding = {
  id: string;
  category: string;
  code: string;
  severity: "info" | "warning" | "critical";
  entity_type: string;
  entity_id: string | null;
  entity_ref: string | null;
  description: string;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  status: "open" | "resolved" | "ignored";
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  created_at: string;
};

const listSchema = z
  .object({
    status: z.enum(["open", "resolved", "ignored", "all"]).optional(),
    category: z
      .enum([
        "membership",
        "receipt",
        "reward",
        "draw",
        "commission",
        "audit",
        "all",
      ])
      .optional(),
    severity: z.enum(["info", "warning", "critical", "all"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .default({});

export const listReconciliationFindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    let q = sb
      .from("reconciliation_findings")
      .select("*")
      .order("severity", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (!data.status || data.status !== "all") {
      q = q.eq("status", data.status ?? "open");
    }
    if (data.category && data.category !== "all") {
      q = q.eq("category", data.category);
    }
    if (data.severity && data.severity !== "all") {
      q = q.eq("severity", data.severity);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ReconciliationFinding[];
  });

export const getReconciliationSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const { data, error } = await sb
      .from("reconciliation_findings")
      .select("status, severity, category");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      status: string;
      severity: string;
      category: string;
    }>;
    const summary = {
      open: rows.filter((r) => r.status === "open").length,
      critical: rows.filter(
        (r) => r.status === "open" && r.severity === "critical",
      ).length,
      warning: rows.filter(
        (r) => r.status === "open" && r.severity === "warning",
      ).length,
      resolved: rows.filter((r) => r.status === "resolved").length,
      ignored: rows.filter((r) => r.status === "ignored").length,
      byCategory: {} as Record<string, number>,
    };
    for (const r of rows) {
      if (r.status !== "open") continue;
      summary.byCategory[r.category] = (summary.byCategory[r.category] ?? 0) + 1;
    }
    return summary;
  });

const resolveSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["resolved", "ignored", "open"]),
  note: z.string().max(500).optional(),
});

export const resolveReconciliationFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resolveSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb: any = context.supabase;
    const { data: row, error } = await sb.rpc(
      "resolve_reconciliation_finding",
      {
        p_finding_id: data.id,
        p_status: data.status,
        p_note: data.note ?? null,
      },
    );
    if (error) throw new Error(error.message);
    return row as ReconciliationFinding;
  });

export const runReconciliationNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin.rpc("run_reconciliation");
    if (error) throw new Error(error.message);
    return data as Record<string, number | string>;
  });
