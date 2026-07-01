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

export const listMembershipsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string; search?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    let q = sb
      .from("memberships")
      .select(
        "id, membership_number, user_id, plan_id, promoter_id, status, start_date, end_date, advance_paid, total_amount, paid_amount, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(
      new Set(
        (rows ?? []).flatMap((r: any) => [r.user_id, r.promoter_id].filter(Boolean)),
      ),
    );
    const planIds = Array.from(new Set((rows ?? []).map((r: any) => r.plan_id)));

    const [profilesRes, plansRes] = await Promise.all([
      userIds.length
        ? context.supabase.from("profiles").select("id, full_name, email, phone").in("id", userIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      planIds.length
        ? context.supabase.from("membership_plans").select("id, name, code").in("id", planIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (plansRes.error) throw new Error(plansRes.error.message);

    const pMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const planMap = new Map((plansRes.data ?? []).map((p: any) => [p.id, p]));

    let enriched = (rows ?? []).map((r: any) => ({
      ...r,
      customer: pMap.get(r.user_id) ?? null,
      promoter: r.promoter_id ? pMap.get(r.promoter_id) ?? null : null,
      plan: planMap.get(r.plan_id) ?? null,
    }));

    if (data.search) {
      const s = data.search.toLowerCase();
      enriched = enriched.filter(
        (r: any) =>
          r.membership_number?.toLowerCase().includes(s) ||
          r.customer?.full_name?.toLowerCase().includes(s) ||
          r.customer?.email?.toLowerCase().includes(s) ||
          r.plan?.name?.toLowerCase().includes(s),
      );
    }
    return enriched;
  });

export const listCustomerOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: roles, error: rErr } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "customer")
      .limit(2000);
    if (rErr) throw new Error(rErr.message);
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (!ids.length) return [];
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", ids)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listPromoterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: roles, error: rErr } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "promoter")
      .limit(2000);
    if (rErr) throw new Error(rErr.message);
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (!ids.length) return [];
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listActivePlanOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("membership_plans")
      .select("id, code, name, duration_months, monthly_installment, advance_amount, total_value")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createSchema = z.object({
  user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  promoter_id: z.string().uuid().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  advance_paid: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
  activate: z.boolean().optional(),
});

export const createMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const { data: row, error } = await sb
      .from("memberships")
      .insert({
        user_id: data.user_id,
        plan_id: data.plan_id,
        promoter_id: data.promoter_id ?? null,
        start_date: data.start_date,
        advance_paid: data.advance_paid ?? 0,
        paid_amount: data.advance_paid ?? 0,
        notes: data.notes ?? null,
        status: data.activate ? "active" : "pending",
      })
      .select("id, membership_number")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  promoter_id: z.string().uuid().nullable().optional(),
  status: z.enum(["pending", "active", "completed", "cancelled", "defaulted"]).optional(),
  notes: z.string().max(1000).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...patch } = data;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    const sb: any = context.supabase;
    const { error } = await sb.from("memberships").update(clean).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const activateMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("memberships")
      .update({ status: "active" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cancelMembershipAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("memberships")
      .update({ status: "cancelled" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
