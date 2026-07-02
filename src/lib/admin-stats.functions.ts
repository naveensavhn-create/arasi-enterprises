import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminDashboardStats = {
  promoters: number;
  customers: number;
  totalRevenue: number;
  commissions: { total: number; paid: number; pending: number };
  pendingAmount: number;
  overdueAmount: number;
  kycPending: number;
  kycNotSubmitted: number;
  nextDraw: {
    id: string;
    name: string;
    draw_at: string | null;
    status: string;
  } | null;
  latestDraw: {
    id: string;
    name: string;
    drawn_at: string | null;
    winners: number;
  } | null;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const getAdminDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminDashboardStats> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin;

    const [
      promotersQ,
      customersQ,
      revenueQ,
      commissionsQ,
      pendingQ,
      overdueQ,
      kycPendingQ,
      kycNotSubmittedQ,
      nextDrawQ,
      latestDrawQ,
    ] = await Promise.all([
      db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "promoter"),
      db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "customer"),
      db.from("payments").select("amount").eq("status", "paid"),
      db.from("promoter_commissions").select("commission_amount,status"),
      db.from("installments").select("amount,paid_amount").eq("status", "pending"),
      db.from("installments").select("amount,paid_amount").eq("status", "overdue"),
      db.from("profiles").select("id", { count: "exact", head: true }).eq("kyc_status", "pending"),
      db.from("profiles").select("id", { count: "exact", head: true }).eq("kyc_status", "unsubmitted"),
      db
        .from("draws")
        .select("id,name,draw_at,status")
        .in("status", ["scheduled", "open"])
        .order("draw_at", { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("draws")
        .select("id,name,drawn_at")
        .eq("status", "completed")
        .order("drawn_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const num = (x: unknown) => (typeof x === "number" ? x : x == null ? 0 : Number(x) || 0);
    const sumRemaining = (rows: Array<{ amount: any; paid_amount: any }> | null) =>
      (rows ?? []).reduce((acc, r) => acc + Math.max(0, num(r.amount) - num(r.paid_amount)), 0);

    const totalRevenue = (revenueQ.data ?? []).reduce((a, r: any) => a + num(r.amount), 0);
    const commissions = (commissionsQ.data ?? []).reduce(
      (acc, r: any) => {
        const amt = num(r.commission_amount);
        acc.total += amt;
        if (r.status === "paid") acc.paid += amt;
        else acc.pending += amt;
        return acc;
      },
      { total: 0, paid: 0, pending: 0 },
    );

    let winners = 0;
    if (latestDrawQ.data?.id) {
      const w = await db
        .from("draw_winners")
        .select("id", { count: "exact", head: true })
        .eq("draw_id", latestDrawQ.data.id);
      winners = w.count ?? 0;
    }

    return {
      promoters: promotersQ.count ?? 0,
      customers: customersQ.count ?? 0,
      totalRevenue,
      commissions,
      pendingAmount: sumRemaining(pendingQ.data as any),
      overdueAmount: sumRemaining(overdueQ.data as any),
      kycPending: kycPendingQ.count ?? 0,
      kycNotSubmitted: kycNotSubmittedQ.count ?? 0,
      nextDraw: nextDrawQ.data
        ? {
            id: nextDrawQ.data.id,
            name: nextDrawQ.data.name,
            draw_at: nextDrawQ.data.draw_at,
            status: nextDrawQ.data.status,
          }
        : null,
      latestDraw: latestDrawQ.data
        ? {
            id: latestDrawQ.data.id,
            name: latestDrawQ.data.name,
            drawn_at: latestDrawQ.data.drawn_at,
            winners,
          }
        : null,
    };
  });
