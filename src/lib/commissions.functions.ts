import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Types ============
export type Rank = {
  id: string;
  code: string;
  name: string;
  tier_order: number;
  min_active_customers: number;
  commission_percent: number;
  one_time_incentive: number;
  gift_name: string | null;
  is_active: boolean;
};

export type CommissionRow = {
  id: string;
  ledger_number: string;
  promoter_id: string;
  customer_id: string;
  membership_id: string;
  payment_id: string;
  installment_id: string | null;
  receipt_id: string | null;
  installment_amount: number;
  commission_percent: number;
  commission_amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  paid_reference: string | null;
  remarks: string | null;
  payment_date: string;
  created_at: string;
  customer_name?: string | null;
  promoter_name?: string | null;
  membership_number?: string | null;
  receipt_number?: string | null;
};

// ============ Admin: Ranks CRUD ============
export const rankSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  tier_order: z.number().int().min(1),
  min_active_customers: z.number().int().min(0),
  commission_percent: z.number().min(0).max(100),
  one_time_incentive: z.number().min(0),
  gift_name: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export const listRanks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Rank[]> => {
    const { data, error } = await context.supabase
      .from("promoter_ranks")
      .select("*")
      .order("tier_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Rank[];
  });

export const upsertRank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => rankSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const payload = { ...data, gift_name: data.gift_name ?? null };
    const q = data.id
      ? context.supabase.from("promoter_ranks").update(payload).eq("id", data.id).select().single()
      : context.supabase.from("promoter_ranks").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    return row as Rank;
  });

export const deleteRank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase.from("promoter_ranks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Commission settings ============
export const getCommissionSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("commission_settings")
      .select("*")
      .eq("id", true)
      .single();
    if (error) throw new Error(error.message);
    return data as { commission_auto_approve: boolean; incentive_mode: "automatic" | "manual" };
  });

export const updateCommissionSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        commission_auto_approve: z.boolean(),
        incentive_mode: z.enum(["automatic", "manual"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("commission_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Commission ledger listings ============
const listSchema = z.object({
  status: z.enum(["all", "pending", "approved", "paid", "rejected"]).default("all"),
  promoterId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

async function enrichCommissions(supabase: any, rows: any[]): Promise<CommissionRow[]> {
  if (rows.length === 0) return [];
  const userIds = Array.from(new Set(rows.flatMap((r) => [r.promoter_id, r.customer_id])));
  const memIds = Array.from(new Set(rows.map((r) => r.membership_id)));
  const recIds = Array.from(new Set(rows.map((r) => r.receipt_id).filter(Boolean)));
  const [{ data: profiles }, { data: mems }, { data: recs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", userIds),
    supabase.from("memberships").select("id, membership_number").in("id", memIds),
    recIds.length
      ? supabase.from("receipts").select("id, receipt_number").in("id", recIds)
      : Promise.resolve({ data: [] }),
  ]);
  const pMap = new Map<string, { full_name?: string | null; email?: string | null }>(
    ((profiles ?? []) as Array<{ id: string; full_name?: string | null; email?: string | null }>).map((p) => [p.id, p]),
  );
  const mMap = new Map<string, { membership_number?: string | null }>(
    ((mems ?? []) as Array<{ id: string; membership_number?: string | null }>).map((m) => [m.id, m]),
  );
  const rMap = new Map<string, { receipt_number?: string | null }>(
    ((recs ?? []) as Array<{ id: string; receipt_number?: string | null }>).map((r) => [r.id, r]),
  );
  return rows.map((r) => ({
    ...r,
    installment_amount: Number(r.installment_amount),
    commission_percent: Number(r.commission_percent),
    commission_amount: Number(r.commission_amount),
    promoter_name: pMap.get(r.promoter_id)?.full_name || pMap.get(r.promoter_id)?.email || null,
    customer_name: pMap.get(r.customer_id)?.full_name || pMap.get(r.customer_id)?.email || null,
    membership_number: mMap.get(r.membership_id)?.membership_number ?? undefined,
    receipt_number: r.receipt_id ? rMap.get(r.receipt_id)?.receipt_number ?? null : null,
  })) as CommissionRow[];

}

export const listCommissionsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => listSchema.parse(i))
  .handler(async ({ data, context }): Promise<CommissionRow[]> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    let q = context.supabase
      .from("promoter_commissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.promoterId) q = q.eq("promoter_id", data.promoterId);
    if (data.from) q = q.gte("payment_date", data.from);
    if (data.to) q = q.lte("payment_date", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return enrichCommissions(context.supabase, rows ?? []);
  });

export const listMyCommissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => listSchema.pick({ status: true, from: true, to: true, limit: true }).parse(i))
  .handler(async ({ data, context }): Promise<CommissionRow[]> => {
    let q = context.supabase
      .from("promoter_commissions")
      .select("*")
      .eq("promoter_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.from) q = q.gte("payment_date", data.from);
    if (data.to) q = q.lte("payment_date", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return enrichCommissions(context.supabase, rows ?? []);
  });

// ============ Commission status update ============
export const updateCommissionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "paid", "rejected"]),
        reference: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_update_commission_status", {
      _id: data.id,
      _status: data.status,
      _reference: data.reference ?? undefined,
      _remarks: data.remarks ?? undefined,
    });
    if (error) throw new Error(error.message);
    return row;
  });

// ============ Promoter dashboard ============
export type PromoterDashboard = {
  activeCustomers: number;
  pendingCustomers: number;
  currentRank: Rank | null;
  nextRank: Rank | null;
  remainingToNext: number;
  progressPercent: number;
  commissionPercent: number;
  oneTimeIncentive: number;
  giftName: string | null;
  todayEarnings: number;
  monthEarnings: number;
  lifetimeEarnings: number;
  pendingPayoutAmount: number;
};

export const getMyPromoterDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoterDashboard> => {
    const uid = context.userId;
    const [ranksRes, stateRes, memsRes, commRes] = await Promise.all([
      context.supabase.from("promoter_ranks").select("*").order("tier_order", { ascending: true }),
      context.supabase.from("promoter_rank_state").select("*").eq("promoter_id", uid).maybeSingle(),
      context.supabase.from("memberships").select("status").eq("promoter_id", uid),
      context.supabase
        .from("promoter_commissions")
        .select("commission_amount, status, payment_date")
        .eq("promoter_id", uid),
    ]);
    if (ranksRes.error) throw new Error(ranksRes.error.message);
    const ranks = (ranksRes.data ?? []) as Rank[];
    const state = stateRes.data as { active_customer_count: number; current_rank_id: string | null } | null;
    const mems = memsRes.data ?? [];
    const active = mems.filter((m: any) => m.status === "active").length;
    const pending = mems.filter((m: any) => m.status === "pending").length;
    const currentRank = state?.current_rank_id ? ranks.find((r) => r.id === state.current_rank_id) ?? null : null;
    const nextRank = ranks.find((r) => r.min_active_customers > active) ?? null;
    const remainingToNext = nextRank ? Math.max(0, nextRank.min_active_customers - active) : 0;
    const base = currentRank?.min_active_customers ?? 0;
    const target = nextRank?.min_active_customers ?? base;
    const progressPercent =
      target === base ? 100 : Math.round(((active - base) / (target - base)) * 100);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    let today = 0,
      month = 0,
      lifetime = 0,
      pendingPayout = 0;
    for (const c of commRes.data ?? []) {
      const amt = Number(c.commission_amount);
      if (c.status === "paid") lifetime += amt;
      if (c.status !== "rejected") {
        if (c.payment_date >= monthStart) month += amt;
        if (c.payment_date >= todayStart) today += amt;
      }
      if (c.status === "pending" || c.status === "approved") pendingPayout += amt;
    }

    return {
      activeCustomers: active,
      pendingCustomers: pending,
      currentRank,
      nextRank,
      remainingToNext,
      progressPercent: Math.min(100, Math.max(0, progressPercent)),
      commissionPercent: Number(currentRank?.commission_percent ?? 0),
      oneTimeIncentive: Number(currentRank?.one_time_incentive ?? 0),
      giftName: currentRank?.gift_name ?? null,
      todayEarnings: today,
      monthEarnings: month,
      lifetimeEarnings: lifetime,
      pendingPayoutAmount: pendingPayout,
    };
  });

// ============ Incentives ============
export const listIncentivesAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("promoter_incentives")
      .select("*")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMyIncentives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("promoter_incentives")
      .select("*")
      .eq("promoter_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const generateRankIncentives = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: count, error } = await context.supabase.rpc("admin_generate_rank_incentives");
    if (error) throw new Error(error.message);
    return { generated: (count as number) ?? 0 };
  });

export const updateIncentiveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "paid", "rejected"]),
        reference: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_update_incentive_status", {
      _id: data.id,
      _status: data.status,
      _reference: data.reference ?? undefined,
      _remarks: data.remarks ?? undefined,
    });
    if (error) throw new Error(error.message);
    return row;
  });

// ============ Gifts ============
export const listGiftsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("promoter_gifts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMyGifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("promoter_gifts")
      .select("*")
      .eq("promoter_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateGiftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["eligible", "approved", "dispatched", "delivered", "completed", "rejected"]),
        courier: z.string().nullable().optional(),
        tracking: z.string().nullable().optional(),
        serial: z.string().nullable().optional(),
        proof_url: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_update_gift", {
      _id: data.id,
      _status: data.status,
      _courier: data.courier ?? undefined,
      _tracking: data.tracking ?? undefined,
      _serial: data.serial ?? undefined,
      _proof_url: data.proof_url ?? undefined,
      _remarks: data.remarks ?? undefined,
    });
    if (error) throw new Error(error.message);
    return row;
  });

// ============ Rank history ============
export const listMyRankHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("promoter_rank_history")
      .select("*")
      .eq("promoter_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
