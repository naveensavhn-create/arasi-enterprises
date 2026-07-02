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
      _admin_note: data.admin_note ?? "",
      _tracking: data.tracking_reference ?? "",
    } as never);
    if (error) throw new Error(error.message);
    return row as unknown as CustomerRewardRow;
  });

// ============ Timeline ============
export type RewardEventMetadata = {
  reward_number?: string | null;
  tracking_reference?: string | null;
  unlocked_count?: number;
  new_status?: string | null;
  unlocked_at?: string | null;
  request_note?: string | null;
  reward_id?: string | null;
  tracking?: string | null;
};
export type RewardTimelineEvent = {
  id: string;
  event_type: string;
  from_status: RewardClaimStatus | null;
  to_status: RewardClaimStatus | null;
  reward_id: string | null;
  reward_number: string | null;
  tier_name: string | null;
  membership_id: string | null;
  membership_number: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  note: string | null;
  metadata: RewardEventMetadata;
  created_at: string;
  source: "reward_event" | "audit_log";
};

export const getCustomerRewardTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId: z.string().uuid(), limit: z.number().int().min(1).max(500).default(300) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<RewardTimelineEvent[]> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const isSelf = data.userId === context.userId;
    if (!isAdmin && !isSelf) throw new Error("Forbidden");

    const [eventsRes, auditRes] = await Promise.all([
      context.supabase
        .from("reward_events")
        .select("*")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(data.limit),
      isAdmin
        ? context.supabase
            .from("admin_audit_log")
            .select("id, actor_id, actor_email, action, reason, metadata, created_at")
            .eq("target_user_id", data.userId)
            .like("action", "reward%")
            .order("created_at", { ascending: false })
            .limit(data.limit)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (auditRes.error) throw new Error(auditRes.error.message);

    type EvRow = {
      id: string; event_type: string; from_status: RewardClaimStatus | null;
      to_status: RewardClaimStatus | null; reward_id: string | null;
      membership_id: string | null; tier_id: string | null; actor_id: string | null;
      note: string | null; metadata: Record<string, unknown> | null; created_at: string;
    };
    const events = (eventsRes.data ?? []) as EvRow[];

    const actorIds = new Set<string>();
    const rewardIds = new Set<string>();
    const memIds = new Set<string>();
    const tierIds = new Set<string>();
    events.forEach((e) => {
      if (e.actor_id) actorIds.add(e.actor_id);
      if (e.reward_id) rewardIds.add(e.reward_id);
      if (e.membership_id) memIds.add(e.membership_id);
      if (e.tier_id) tierIds.add(e.tier_id);
    });
    type AuditRow = {
      id: string; actor_id: string | null; actor_email: string | null;
      action: string; reason: string | null; metadata: Record<string, unknown> | null; created_at: string;
    };
    const audits = (auditRes.data ?? []) as AuditRow[];
    audits.forEach((a) => { if (a.actor_id) actorIds.add(a.actor_id); });

    const [profRes, rewardRes, memRes, tierRes] = await Promise.all([
      actorIds.size
        ? context.supabase.from("profiles").select("id, full_name, email").in("id", Array.from(actorIds))
        : Promise.resolve({ data: [], error: null }),
      rewardIds.size
        ? context.supabase.from("customer_rewards").select("id, reward_number, tier_id, membership_id").in("id", Array.from(rewardIds))
        : Promise.resolve({ data: [], error: null }),
      memIds.size
        ? context.supabase.from("memberships").select("id, membership_number").in("id", Array.from(memIds))
        : Promise.resolve({ data: [], error: null }),
      tierIds.size
        ? context.supabase.from("reward_tiers").select("id, name").in("id", Array.from(tierIds))
        : Promise.resolve({ data: [], error: null }),
    ]);
    const pMap = new Map(((profRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]));
    const rMap = new Map(((rewardRes.data ?? []) as Array<{ id: string; reward_number: string | null; tier_id: string | null; membership_id: string | null }>).map((r) => [r.id, r]));
    const mMap = new Map(((memRes.data ?? []) as Array<{ id: string; membership_number: string | null }>).map((m) => [m.id, m]));
    const tMap = new Map(((tierRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t]));

    const evOut: RewardTimelineEvent[] = events.map((e) => {
      const rew = e.reward_id ? rMap.get(e.reward_id) : null;
      const tierId = e.tier_id ?? rew?.tier_id ?? null;
      const memId = e.membership_id ?? rew?.membership_id ?? null;
      const actor = e.actor_id ? pMap.get(e.actor_id) : null;
      return {
        id: e.id,
        event_type: e.event_type,
        from_status: e.from_status,
        to_status: e.to_status,
        reward_id: e.reward_id,
        reward_number: rew?.reward_number ?? null,
        tier_name: tierId ? tMap.get(tierId)?.name ?? null : null,
        membership_id: memId,
        membership_number: memId ? mMap.get(memId)?.membership_number ?? null : null,
        actor_id: e.actor_id,
        actor_name: actor?.full_name ?? actor?.email ?? null,
        actor_email: actor?.email ?? null,
        note: e.note,
        metadata: (e.metadata ?? {}) as RewardEventMetadata,
        created_at: e.created_at,
        source: "reward_event",
      };
    });

    const auditOut: RewardTimelineEvent[] = audits.map((a) => {
      const meta = a.metadata ?? {};
      const rewardId = typeof meta.reward_id === "string" ? meta.reward_id : null;
      const rew = rewardId ? rMap.get(rewardId) : null;
      const actor = a.actor_id ? pMap.get(a.actor_id) : null;
      return {
        id: `audit:${a.id}`,
        event_type: a.action,
        from_status: null,
        to_status: (typeof meta.new_status === "string" ? meta.new_status : null) as RewardClaimStatus | null,
        reward_id: rewardId,
        reward_number: (typeof meta.reward_number === "string" ? meta.reward_number : rew?.reward_number) ?? null,
        tier_name: rew?.tier_id ? tMap.get(rew.tier_id)?.name ?? null : null,
        membership_id: rew?.membership_id ?? null,
        membership_number: rew?.membership_id ? mMap.get(rew.membership_id)?.membership_number ?? null : null,
        actor_id: a.actor_id,
        actor_name: actor?.full_name ?? actor?.email ?? a.actor_email ?? null,
        actor_email: actor?.email ?? a.actor_email ?? null,
        note: a.reason,
        metadata: meta,
        created_at: a.created_at,
        source: "audit_log",
      };
    });

    const merged = [...evOut, ...auditOut].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return merged.slice(0, data.limit);
  });

export const recomputeCustomerRewardsForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: mems, error } = await context.supabase
      .from("memberships")
      .select("id")
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    let unlocked = 0;
    for (const m of (mems ?? []) as Array<{ id: string }>) {
      const { data: n } = await context.supabase.rpc("recompute_customer_rewards", {
        _membership_id: m.id,
      });
      const count = Number(n ?? 0);
      unlocked += count;
      await context.supabase.rpc("log_reward_recompute", {
        _membership_id: m.id,
        _unlocked: count,
      } as never);
    }
    return { processed: mems?.length ?? 0, unlocked };
  });

export type CustomerLite = { id: string; full_name: string | null; email: string | null; membership_number: string | null };

export const getCustomerLite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<CustomerLite | null> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const isSelf = data.userId === context.userId;
    if (!isAdmin && !isSelf) throw new Error("Forbidden");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", data.userId)
      .maybeSingle();
    const { data: mem } = await context.supabase
      .from("memberships")
      .select("membership_number")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prof) return null;
    const p = prof as { id: string; full_name: string | null; email: string | null };
    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      membership_number: (mem as { membership_number: string | null } | null)?.membership_number ?? null,
    };
  });
