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

const baseFilterSchema = z.object({
  sortBy: z.enum(SORT_COLUMNS).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
});

const pageSchema = baseFilterSchema.extend({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(5).max(200).default(25),
});

const exportSchema = baseFilterSchema.extend({
  limit: z.number().int().min(1).max(10_000).default(5000),
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

type Filters = z.infer<typeof baseFilterSchema>;

async function resolveSearchIds(sb: any, q: string | undefined) {
  if (!q) return { customerIds: undefined as string[] | undefined, membershipIds: undefined as string[] | undefined };
  const like = `%${q}%`;
  const [profRes, memRes] = await Promise.all([
    sb.from("profiles").select("id").or(`full_name.ilike.${like},email.ilike.${like}`).limit(500),
    sb.from("memberships").select("id").ilike("membership_number", like).limit(500),
  ]);
  if (profRes.error) throw new Error(profRes.error.message);
  if (memRes.error) throw new Error(memRes.error.message);
  return {
    customerIds: (profRes.data ?? []).map((r: any) => r.id) as string[],
    membershipIds: (memRes.data ?? []).map((r: any) => r.id) as string[],
  };
}

function normalizeFilters(f: Filters) {
  const q = f.q?.trim() || undefined;
  const status = f.status && f.status !== "all" ? f.status : undefined;
  const fromISO = f.from ? new Date(f.from).toISOString() : undefined;
  const toISO = f.to ? new Date(new Date(f.to).getTime() + 86_400_000).toISOString() : undefined;
  return { q, status, fromISO, toISO, sortBy: f.sortBy, sortDir: f.sortDir };
}

async function fetchPaymentRows(
  sb: any,
  n: ReturnType<typeof normalizeFilters>,
  customerIds: string[] | undefined,
  membershipIds: string[] | undefined,
  fromIdx: number,
  toIdx: number,
): Promise<AdminPaymentRow[]> {
  let query = sb
    .from("payments")
    .select(
      `id, amount, currency, status, method, provider,
       provider_order_id, provider_payment_id, error_code, error_description,
       paid_at, created_at, customer_id, membership_id, installment_id,
       memberships:membership_id ( membership_number ),
       installments:installment_id ( sequence, due_date )`,
    )
    .order(n.sortBy, { ascending: n.sortDir === "asc", nullsFirst: false });

  if (n.status) query = query.eq("status", n.status);
  if (n.fromISO) query = query.gte("created_at", n.fromISO);
  if (n.toISO) query = query.lt("created_at", n.toISO);
  if (n.q) {
    const like = `%${n.q}%`;
    const parts = [
      `provider_order_id.ilike.${like}`,
      `provider_payment_id.ilike.${like}`,
    ];
    if (customerIds && customerIds.length) parts.push(`customer_id.in.(${customerIds.join(",")})`);
    if (membershipIds && membershipIds.length) parts.push(`membership_id.in.(${membershipIds.join(",")})`);
    query = query.or(parts.join(","));
  }

  const { data: rows, error } = await query.range(fromIdx, toIdx);
  if (error) throw new Error(error.message);

  const ids = Array.from(new Set((rows ?? []).map((r: any) => r.customer_id))).filter(Boolean);
  const profMap = new Map<string, any>();
  if (ids.length) {
    const { data: profs, error: pErr } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);
    for (const p of profs ?? []) profMap.set(p.id, p);
  }

  return (rows ?? []).map((r: any) => ({
    ...r,
    profile: profMap.get(r.customer_id)
      ? { full_name: profMap.get(r.customer_id).full_name, email: profMap.get(r.customer_id).email }
      : null,
  }));
}

export const listAdminPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pageSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminPaymentsResult> => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const n = normalizeFilters(data);
    const { customerIds, membershipIds } = await resolveSearchIds(sb, n.q);

    const fromIdx = data.page * data.pageSize;
    const toIdx = fromIdx + data.pageSize - 1;

    const [rows, totalsRes] = await Promise.all([
      fetchPaymentRows(sb, n, customerIds, membershipIds, fromIdx, toIdx),
      sb.rpc("admin_payments_totals", {
        _status: n.status ?? null,
        _from: n.fromISO ?? null,
        _to: n.toISO ?? null,
        _customer_ids: customerIds ?? null,
        _membership_ids: membershipIds ?? null,
        _q: n.q ?? null,
      }),
    ]);
    if (totalsRes.error) throw new Error(totalsRes.error.message);
    const totals = Array.isArray(totalsRes.data) ? totalsRes.data[0] : totalsRes.data;

    return {
      rows,
      total: Number(totals?.total_count ?? 0),
      paidCount: Number(totals?.paid_count ?? 0),
      paidSum: Number(totals?.paid_sum ?? 0),
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const exportAdminPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => exportSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminPaymentRow[]> => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const n = normalizeFilters(data);
    const { customerIds, membershipIds } = await resolveSearchIds(sb, n.q);
    return fetchPaymentRows(sb, n, customerIds, membershipIds, 0, data.limit - 1);
  });

/* ---------- Per-installment webhook timeline ---------- */

export type InstallmentWebhookEvent = {
  id: string;
  event_id: string;
  event_type: string | null;
  status: string;
  received_at: string;
  processed_at: string;
  order_id: string | null;
  payment_id: string | null;
  payment_provider_id: string | null;
  payment_status: string | null;
  amount: number | null;
  currency: string | null;
  error_code: string | null;
  error_description: string | null;
  resulting_installment_status: string | null;
  raw: Record<string, any> | null;
};

export type InstallmentWebhookTimeline = {
  installment: {
    id: string;
    sequence: number;
    due_date: string;
    amount: number;
    status: string;
    paid_at: string | null;
    membership_number: string | null;
  };
  events: InstallmentWebhookEvent[];
};

export const getInstallmentWebhookTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ installmentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<InstallmentWebhookTimeline> => {
    const sb: any = context.supabase;

    // Authorization: admin OR the installment's membership belongs to the caller.
    const { data: isAdmin } = await sb.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    const { data: inst, error: iErr } = await sb
      .from("installments")
      .select(
        "id, sequence, due_date, amount, status, paid_at, membership_id, memberships!inner(membership_number, user_id)",
      )
      .eq("id", data.installmentId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inst) throw new Error("Installment not found");

    const membership = Array.isArray(inst.memberships) ? inst.memberships[0] : inst.memberships;
    if (!isAdmin && membership?.user_id !== context.userId) {
      throw new Error("Forbidden");
    }

    // Load privileged clients only after authorization succeeds.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: pays, error: pErr } = await supabaseAdmin
      .from("payments")
      .select("id, provider_order_id, provider_payment_id, status, amount, currency, error_code, error_description")
      .eq("installment_id", data.installmentId);
    if (pErr) throw new Error(pErr.message);

    const paymentIds = (pays ?? []).map((p) => p.id);
    const orderIds = (pays ?? []).map((p) => p.provider_order_id).filter(Boolean) as string[];

    let events: any[] = [];
    if (paymentIds.length || orderIds.length) {
      const filters: string[] = [];
      if (paymentIds.length) filters.push(`payment_id.in.(${paymentIds.join(",")})`);
      if (orderIds.length) filters.push(`order_id.in.(${orderIds.map((o) => `"${o}"`).join(",")})`);
      const { data: evs, error: eErr } = await supabaseAdmin
        .from("razorpay_webhook_events")
        .select("id, event_id, event_type, status, received_at, processed_at, order_id, payment_id, raw")
        .or(filters.join(","))
        .order("received_at", { ascending: true })
        .limit(200);
      if (eErr) throw new Error(eErr.message);
      events = evs ?? [];
    }

    const payById = new Map((pays ?? []).map((p) => [p.id, p]));

    const enriched: InstallmentWebhookEvent[] = events.map((e) => {
      const pay = e.payment_id ? payById.get(e.payment_id) : null;
      const et = (e.event_type ?? "").toLowerCase();
      let resulting: string | null = null;
      if (et.includes("payment.captured") || et.includes("order.paid")) resulting = "paid";
      else if (et.includes("payment.failed")) resulting = "payment failed";
      else if (et.includes("refund")) resulting = "refunded";
      else if (et.includes("payment.authorized")) resulting = "authorized";
      return {
        id: e.id,
        event_id: e.event_id,
        event_type: e.event_type,
        status: e.status,
        received_at: e.received_at,
        processed_at: e.processed_at,
        order_id: e.order_id,
        payment_id: e.payment_id,
        payment_provider_id: pay?.provider_payment_id ?? null,
        payment_status: pay?.status ?? null,
        amount: pay?.amount ?? null,
        currency: pay?.currency ?? null,
        error_code: pay?.error_code ?? null,
        error_description: pay?.error_description ?? null,
        resulting_installment_status: resulting,
        raw: e.raw,
      };
    });

    return {
      installment: {
        id: inst.id,
        sequence: inst.sequence,
        due_date: inst.due_date,
        amount: Number(inst.amount),
        status: inst.status,
        paid_at: inst.paid_at,
        membership_number: membership?.membership_number ?? null,
      },
      events: enriched,
    };
  });

