import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const SORT_COLUMNS = ["created_at", "paid_at", "amount", "status"] as const;

const inputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(5).max(200).default(25),
  sortBy: z.enum(SORT_COLUMNS).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
});

export type AdminPaymentRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  provider: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  error_code: string | null;
  error_description: string | null;
  paid_at: string | null;
  created_at: string;
  customer_id: string;
  membership_id: string;
  installment_id: string | null;
  memberships: { membership_number: string | null } | null;
  installments: { sequence: number; due_date: string } | null;
  profile: { full_name: string | null; email: string | null } | null;
};

export type AdminPaymentsResult = {
  rows: AdminPaymentRow[];
  total: number;
  paidCount: number;
  paidSum: number;
  page: number;
  pageSize: number;
};

export const listAdminPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminPaymentsResult> => {
    await assertAdmin(context);
    const sb: any = context.supabase;

    const q = data.q?.trim() || undefined;
    const status = data.status && data.status !== "all" ? data.status : undefined;
    const fromISO = data.from ? new Date(data.from).toISOString() : undefined;
    const toISO = data.to
      ? new Date(new Date(data.to).getTime() + 86_400_000).toISOString()
      : undefined;

    // Resolve customer/membership id sets for text search across joined fields.
    let customerIds: string[] | undefined;
    let membershipIds: string[] | undefined;
    if (q) {
      const like = `%${q}%`;
      const [profRes, memRes] = await Promise.all([
        sb.from("profiles").select("id").or(`full_name.ilike.${like},email.ilike.${like}`).limit(500),
        sb.from("memberships").select("id").ilike("membership_number", like).limit(500),
      ]);
      if (profRes.error) throw new Error(profRes.error.message);
      if (memRes.error) throw new Error(memRes.error.message);
      customerIds = (profRes.data ?? []).map((r: any) => r.id);
      membershipIds = (memRes.data ?? []).map((r: any) => r.id);
    }

    // Build page query
    let query = sb
      .from("payments")
      .select(
        `id, amount, currency, status, method, provider,
         provider_order_id, provider_payment_id, error_code, error_description,
         paid_at, created_at, customer_id, membership_id, installment_id,
         memberships:membership_id ( membership_number ),
         installments:installment_id ( sequence, due_date )`,
      )
      .order(data.sortBy, { ascending: data.sortDir === "asc", nullsFirst: false });

    if (status) query = query.eq("status", status);
    if (fromISO) query = query.gte("created_at", fromISO);
    if (toISO) query = query.lt("created_at", toISO);
    if (q) {
      const like = `%${q}%`;
      const parts = [
        `provider_order_id.ilike.${like}`,
        `provider_payment_id.ilike.${like}`,
      ];
      if (customerIds && customerIds.length) parts.push(`customer_id.in.(${customerIds.join(",")})`);
      if (membershipIds && membershipIds.length) parts.push(`membership_id.in.(${membershipIds.join(",")})`);
      query = query.or(parts.join(","));
    }

    const fromIdx = data.page * data.pageSize;
    const toIdx = fromIdx + data.pageSize - 1;
    const { data: rows, error } = await query.range(fromIdx, toIdx);
    if (error) throw new Error(error.message);

    // Totals via RPC (single scan)
    const { data: totalsRow, error: tErr } = await sb.rpc("admin_payments_totals", {
      _status: status ?? null,
      _from: fromISO ?? null,
      _to: toISO ?? null,
      _customer_ids: customerIds ?? null,
      _membership_ids: membershipIds ?? null,
      _q: q ?? null,
    });
    if (tErr) throw new Error(tErr.message);
    const totals = Array.isArray(totalsRow) ? totalsRow[0] : totalsRow;

    // Attach customer profiles for the page rows
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.customer_id))).filter(Boolean);
    let profMap = new Map<string, any>();
    if (ids.length) {
      const { data: profs, error: pErr } = await sb
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      if (pErr) throw new Error(pErr.message);
      profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    }

    const enriched: AdminPaymentRow[] = (rows ?? []).map((r: any) => ({
      ...r,
      profile: profMap.get(r.customer_id)
        ? { full_name: profMap.get(r.customer_id).full_name, email: profMap.get(r.customer_id).email }
        : null,
    }));

    return {
      rows: enriched,
      total: Number(totals?.total_count ?? 0),
      paidCount: Number(totals?.paid_count ?? 0),
      paidSum: Number(totals?.paid_sum ?? 0),
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const exportAdminPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    inputSchema
      .omit({ page: true, pageSize: true })
      .extend({ limit: z.number().int().min(1).max(10_000).default(5000) })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<AdminPaymentRow[]> => {
    await assertAdmin(context);
    const res = await (listAdminPayments as any)({
      data: {
        page: 0,
        pageSize: data.limit,
        sortBy: data.sortBy,
        sortDir: data.sortDir,
        status: data.status,
        from: data.from,
        to: data.to,
        q: data.q,
      },
    });
    return res.rows;
  });
