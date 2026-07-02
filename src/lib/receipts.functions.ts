import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  return Boolean(data);
}

export type ReceiptRow = {
  id: string;
  receipt_number: string;
  payment_id: string;
  membership_id: string;
  installment_id: string | null;
  customer_id: string;
  promoter_id: string | null;
  amount: number;
  currency: string;
  payment_method: string | null;
  transaction_id: string | null;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
  // Joined fields (populated by app layer):
  customer_name?: string | null;
  customer_email?: string | null;
  membership_number?: string | null;
  coupon_no?: string | null;
  member_display_id?: string | null;
  promoter_name?: string | null;
  promoter_email?: string | null;
  installment_sequence?: number | null;
  installment_due_date?: string | null;
  plan_name?: string | null;
};

async function enrichReceipts(supabase: any, rows: any[]): Promise<ReceiptRow[]> {
  if (!rows.length) return [];
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean)));
  const promoterIds = Array.from(new Set(rows.map((r) => r.promoter_id).filter(Boolean)));
  const membershipIds = Array.from(new Set(rows.map((r) => r.membership_id).filter(Boolean)));
  const installmentIds = Array.from(new Set(rows.map((r) => r.installment_id).filter(Boolean)));

  const [profilesRes, membershipsRes, installmentsRes] = await Promise.all([
    (customerIds.length || promoterIds.length)
      ? supabase.from("profiles").select("id, full_name, email").in("id", Array.from(new Set([...customerIds, ...promoterIds])))
      : Promise.resolve({ data: [], error: null }),
    membershipIds.length
      ? supabase.from("memberships").select("id, membership_number, coupon_no, member_display_id, plan_id").in("id", membershipIds)
      : Promise.resolve({ data: [], error: null }),
    installmentIds.length
      ? supabase.from("installments").select("id, sequence, due_date").in("id", installmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const pMap = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [p.id, p]));
  const mMap = new Map<string, any>((membershipsRes.data ?? []).map((m: any) => [m.id, m]));
  const iMap = new Map<string, any>((installmentsRes.data ?? []).map((i: any) => [i.id, i]));

  const planIds = Array.from(new Set((membershipsRes.data ?? []).map((m: any) => m.plan_id).filter(Boolean)));
  const plansRes = planIds.length
    ? await supabase.from("membership_plans").select("id, name").in("id", planIds)
    : { data: [] };
  const planMap = new Map<string, any>((plansRes.data ?? []).map((p: any) => [p.id, p]));

  return rows.map((r) => {
    const m = mMap.get(r.membership_id);
    const inst = r.installment_id ? iMap.get(r.installment_id) : null;
    const cust = pMap.get(r.customer_id);
    const prom = r.promoter_id ? pMap.get(r.promoter_id) : null;
    const plan = m?.plan_id ? planMap.get(m.plan_id) : null;
    return {
      ...r,
      amount: Number(r.amount),
      customer_name: cust?.full_name ?? null,
      customer_email: cust?.email ?? null,
      membership_number: m?.membership_number ?? null,
      coupon_no: m?.coupon_no ?? null,
      member_display_id: m?.member_display_id ?? null,
      promoter_name: prom?.full_name ?? null,
      promoter_email: prom?.email ?? null,
      installment_sequence: inst?.sequence ?? null,
      installment_due_date: inst?.due_date ?? null,
      plan_name: plan?.name ?? null,
    };
  });
}

export const listMyReceipts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("receipts")
      .select("*")
      .eq("customer_id", context.userId)
      .order("issued_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return enrichReceipts(context.supabase, data ?? []);
  });

export const getReceiptByNumber = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receiptNumber: string }) =>
    z.object({ receiptNumber: z.string().min(3) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("receipts")
      .select("*")
      .eq("receipt_number", data.receiptNumber)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Receipt not found");
    const [enriched] = await enrichReceipts(context.supabase, [row]);
    return enriched;
  });

export const adminListReceipts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; includeVoided?: boolean; limit?: number }) =>
    z
      .object({
        search: z.string().optional(),
        includeVoided: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) throw new Error("Forbidden");
    let q = context.supabase
      .from("receipts")
      .select("*")
      .order("issued_at", { ascending: false })
      .limit(data.limit ?? 500);
    if (!data.includeVoided) q = q.is("voided_at", null);
    if (data.search && data.search.trim()) {
      const s = data.search.trim();
      q = q.or(
        `receipt_number.ilike.%${s}%,transaction_id.ilike.%${s}%`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return enrichReceipts(context.supabase, rows ?? []);
  });

export const adminVoidReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receiptId: string; reason: string }) =>
    z.object({ receiptId: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_void_receipt", {
      _receipt_id: data.receiptId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return row;
  });
