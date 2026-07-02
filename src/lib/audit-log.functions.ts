import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Strip PostgREST filter meta-characters so user input can't inject
 * additional clauses when spliced into `.or()` expressions.
 * Mirrors the helper in payments.functions.ts.
 */
function sanitizePostgrestLike(input: string): string {
  return input.replace(/[\\%,_()*:]/g, "").trim();
}

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

const filtersSchema = z.object({
  q: z.string().trim().optional().default(""),
  actor: z.string().trim().optional().default(""),
  actions: z.array(z.string()).optional().default([]),
  reviewedField: z.string().trim().optional().default(""),
  paymentId: z.string().trim().optional().default(""),
  customerId: z.string().trim().optional().default(""),
  promoterId: z.string().trim().optional().default(""),
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(200).optional().default(50),
});

export type AuditLogRow = {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  role_before: string | null;
  role_after: string | null;
  reason: string | null;
  reviewed_fields: string[];
  metadata: JsonValue;
};

export type AuditLogListResult = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  actionOptions: string[];
  reviewedFieldOptions: string[];
};


function mapRow(r: {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  role_before: string | null;
  role_after: string | null;
  reason: string | null;
  metadata: unknown;
}): AuditLogRow {
  const m = (r.metadata ?? {}) as Record<string, JsonValue>;
  const rf = Array.isArray(m.reviewed_fields) ? (m.reviewed_fields as JsonValue[]).filter((x): x is string => typeof x === "string") : [];
  return {
    id: r.id,
    created_at: r.created_at,
    action: r.action,
    actor_id: r.actor_id,
    actor_email: r.actor_email,
    target_user_id: r.target_user_id,
    target_email: r.target_email,
    role_before: r.role_before,
    role_after: r.role_after,
    reason: r.reason,
    reviewed_fields: rf,
    metadata: m as JsonValue,
  };
}

export const listAdminAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtersSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<AuditLogListResult> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    // Distinct action + reviewed-field options for filter dropdowns.
    const { data: allActions } = await context.supabase
      .from("admin_audit_log")
      .select("action")
      .limit(2000);
    const actionOptions = Array.from(new Set((allActions ?? []).map((r) => r.action as string))).sort();

    let query = context.supabase
      .from("admin_audit_log")
      .select(
        "id, created_at, action, actor_id, actor_email, target_user_id, target_email, role_before, role_after, reason, metadata",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (data.actions.length > 0) query = query.in("action", data.actions);
    if (data.actor) query = query.ilike("actor_email", `%${data.actor}%`);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lt("created_at", data.to);
    if (data.reviewedField) query = query.contains("metadata", { reviewed_fields: [data.reviewedField] });
    if (data.paymentId) query = query.or(`metadata->>payment_id.eq.${data.paymentId},metadata->>razorpay_payment_id.eq.${data.paymentId}`);
    if (data.customerId) query = query.or(`target_user_id.eq.${data.customerId},metadata->>customer_id.eq.${data.customerId},metadata->>user_id.eq.${data.customerId}`);
    if (data.promoterId) query = query.or(`metadata->>promoter_id.eq.${data.promoterId},metadata->>promoter_user_id.eq.${data.promoterId}`);

    const needsQFilter = !!data.q;
    const fromIdx = (data.page - 1) * data.pageSize;
    const toIdx = fromIdx + data.pageSize - 1;
    if (!needsQFilter) query = query.range(fromIdx, toIdx);
    else query = query.range(0, 999);

    const { data: raw, error, count } = await query;
    if (error) throw new Error(error.message);

    let mapped = (raw ?? []).map(mapRow);
    const reviewedFieldOptions = Array.from(
      new Set(mapped.flatMap((r) => r.reviewed_fields)),
    ).sort();

    if (needsQFilter) {
      const q = data.q.toLowerCase();
      mapped = mapped.filter((r) => {
        const hay = `${r.actor_email ?? ""} ${r.target_email ?? ""} ${r.action} ${r.reason ?? ""} ${r.reviewed_fields.join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
      const total = mapped.length;
      return {
        rows: mapped.slice(fromIdx, fromIdx + data.pageSize),
        total,
        page: data.page,
        pageSize: data.pageSize,
        actionOptions,
        reviewedFieldOptions,
      };
    }

    return {
      rows: mapped,
      total: count ?? mapped.length,
      page: data.page,
      pageSize: data.pageSize,
      actionOptions,
      reviewedFieldOptions,
    };
  });

const exportSchema = filtersSchema.omit({ page: true, pageSize: true });

export const exportAdminAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => exportSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ csv: string; count: number }> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    let query = context.supabase
      .from("admin_audit_log")
      .select(
        "id, created_at, action, actor_id, actor_email, target_user_id, target_email, role_before, role_after, reason, metadata",
      )
      .order("created_at", { ascending: false })
      .range(0, 9999);

    if (data.actions.length > 0) query = query.in("action", data.actions);
    if (data.actor) query = query.ilike("actor_email", `%${data.actor}%`);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lt("created_at", data.to);
    if (data.reviewedField) query = query.contains("metadata", { reviewed_fields: [data.reviewedField] });
    if (data.paymentId) query = query.or(`metadata->>payment_id.eq.${data.paymentId},metadata->>razorpay_payment_id.eq.${data.paymentId}`);
    if (data.customerId) query = query.or(`target_user_id.eq.${data.customerId},metadata->>customer_id.eq.${data.customerId},metadata->>user_id.eq.${data.customerId}`);
    if (data.promoterId) query = query.or(`metadata->>promoter_id.eq.${data.promoterId},metadata->>promoter_user_id.eq.${data.promoterId}`);

    const { data: raw, error } = await query;
    if (error) throw new Error(error.message);

    let rows = (raw ?? []).map(mapRow);
    if (data.q) {
      const q = data.q.toLowerCase();
      rows = rows.filter((r) => {
        const hay = `${r.actor_email ?? ""} ${r.target_email ?? ""} ${r.action} ${r.reason ?? ""} ${r.reviewed_fields.join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const headers = [
      "audit_id",
      "created_at",
      "action",
      "actor_id",
      "actor_email",
      "target_user_id",
      "target_email",
      "role_before",
      "role_after",
      "reason",
      "reviewed_fields",
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
          r.action,
          r.actor_id ?? "",
          r.actor_email ?? "",
          r.target_user_id ?? "",
          r.target_email ?? "",
          r.role_before ?? "",
          r.role_after ?? "",
          r.reason ?? "",
          r.reviewed_fields.join("|"),
        ].map(esc).join(","),
      );
    }
    return { csv: "\ufeff" + lines.join("\n"), count: rows.length };
  });
