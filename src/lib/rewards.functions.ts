import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Types ============
export type RewardTriggerType =
  | "installments_paid"
  | "membership_completed"
  | "on_time_streak"
  | "advance_paid";

export type RewardClaimStatus =
  | "locked"
  | "eligible"
  | "requested"
  | "approved"
  | "dispatched"
  | "delivered"
  | "rejected";

export type RewardTier = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: RewardTriggerType;
  threshold: number;
  plan_id: string | null;
  reward_value: number;
  certificate_title: string | null;
  certificate_body: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CustomerRewardRow = {
  id: string;
  reward_number: string;
  user_id: string;
  membership_id: string;
  tier_id: string;
  status: RewardClaimStatus;
  unlocked_at: string;
  requested_at: string | null;
  approved_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  rejected_at: string | null;
  request_note: string | null;
  admin_note: string | null;
  tracking_reference: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  tier?: RewardTier | null;
  customer_name?: string | null;
  customer_email?: string | null;
  membership_number?: string | null;
};

// ============ Reward Tiers (Admin) ============
const tierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  trigger_type: z.enum([
    "installments_paid",
    "membership_completed",
    "on_time_streak",
    "advance_paid",
  ]),
  threshold: z.number().int().min(0).max(120),
  plan_id: z.string().uuid().nullable().optional(),
  reward_value: z.number().min(0).default(0),
  certificate_title: z.string().nullable().optional(),
  certificate_body: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
});

export const listRewardTiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RewardTier[]> => {
    const { data, error } = await context.supabase
      .from("reward_tiers")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("threshold", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as RewardTier[];
  });

export const upsertRewardTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => tierSchema.parse(i))
  .handler(async ({ data, context }): Promise<RewardTier> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const payload = {
      ...data,
      description: data.description ?? null,
      plan_id: data.plan_id ?? null,
      certificate_title: data.certificate_title ?? null,
      certificate_body: data.certificate_body ?? null,
    };
    const q = data.id
      ? context.supabase.from("reward_tiers").update(payload).eq("id", data.id).select().single()
      : context.supabase.from("reward_tiers").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    return row as RewardTier;
  });

export const deleteRewardTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase.from("reward_tiers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Recompute (admin utility) ============
export const recomputeAllRewards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: mems, error } = await context.supabase.from("memberships").select("id");
    if (error) throw new Error(error.message);
    let unlocked = 0;
    for (const m of mems ?? []) {
      const { data: n } = await context.supabase.rpc("recompute_customer_rewards", {
        _membership_id: (m as { id: string }).id,
      });
      unlocked += Number(n ?? 0);
    }
    return { processed: mems?.length ?? 0, unlocked };
  });

// ============ Enrichment ============
type SupaLike = { from: (t: string) => { select: (c: string) => { in: (col: string, ids: string[]) => Promise<{ data: unknown[] | null }> } } };
async function enrichRewards(
  supabase: SupaLike,
  rows: CustomerRewardRow[],
): Promise<CustomerRewardRow[]> {
  if (!rows.length) return [];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const memIds = Array.from(new Set(rows.map((r) => r.membership_id)));
  const tierIds = Array.from(new Set(rows.map((r) => r.tier_id)));
  const [profRes, memRes, tierRes] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", userIds),
    supabase.from("memberships").select("id, membership_number").in("id", memIds),
    supabase.from("reward_tiers").select("*").in("id", tierIds),
  ]);
  const pMap = new Map(
    ((profRes.data ?? []) as Array<{ id: string; full_name?: string | null; email?: string | null }>).map(
      (p) => [p.id, p] as const,
    ),
  );
  const mMap = new Map(
    ((memRes.data ?? []) as Array<{ id: string; membership_number?: string | null }>).map(
      (m) => [m.id, m] as const,
    ),
  );
  const tMap = new Map(
    ((tierRes.data ?? []) as RewardTier[]).map((t) => [t.id, t] as const),
  );
  return rows.map((r) => ({
    ...r,
    customer_name: pMap.get(r.user_id)?.full_name ?? pMap.get(r.user_id)?.email ?? null,
    customer_email: pMap.get(r.user_id)?.email ?? null,
    membership_number: mMap.get(r.membership_id)?.membership_number ?? null,
    tier: tMap.get(r.tier_id) ?? null,
  }));
}

// ============ Customer ============
export const listMyRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CustomerRewardRow[]> => {
    const { data, error } = await context.supabase
      .from("customer_rewards")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return enrichRewards(context.supabase as unknown as SupaLike, (data ?? []) as CustomerRewardRow[]);
  });

export const getRewardById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<CustomerRewardRow | null> => {
    const { data: row, error } = await context.supabase
      .from("customer_rewards")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const enriched = await enrichRewards(context.supabase as unknown as SupaLike, [row as CustomerRewardRow]);
    return enriched[0] ?? null;
  });

export const requestReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().max(1000).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("request_customer_reward", {
      _reward_id: data.id,
      _note: data.note ?? "",
    } as never);
    if (error) throw new Error(error.message);
    return row as unknown as CustomerRewardRow;
  });

// ============ Admin ledger ============
const adminListSchema = z.object({
  status: z
    .enum(["all", "eligible", "requested", "approved", "dispatched", "delivered", "rejected"])
    .default("all"),
  userId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listRewardsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => adminListSchema.parse(i))
  .handler(async ({ data, context }): Promise<CustomerRewardRow[]> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    let q = context.supabase
      .from("customer_rewards")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.userId) q = q.eq("user_id", data.userId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return enrichRewards(context.supabase as unknown as SupaLike, (rows ?? []) as CustomerRewardRow[]);
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected", "dispatched", "delivered", "eligible"]),
  admin_note: z.string().max(1000).optional(),
  tracking_reference: z.string().max(200).optional(),
});

export const adminUpdateRewardStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_update_reward_status", {
      _reward_id: data.id,
      _new_status: data.status,
      _admin_note: data.admin_note ?? null,
      _tracking: data.tracking_reference ?? null,
    });
    if (error) throw new Error(error.message);
    return row as CustomerRewardRow;
  });
