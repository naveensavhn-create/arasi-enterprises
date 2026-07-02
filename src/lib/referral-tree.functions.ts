import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReferralTreeCustomer = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  kyc_status: string;
  created_at: string;
  membership_status: string | null;
  membership_number: string | null;
  total_paid: number;
};

export type ReferralTreePromoter = {
  promoter_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  display_id: string | null;
  referral_code: string | null;
  assigned_at: string | null;
  total_referred: number;
  active_customers: number;
  pending_kyc: number;
  conversion_rate: number; // 0..1
  total_earnings: number; // approved+paid commissions
  pending_earnings: number;
  customers: ReferralTreeCustomer[];
};

export type ReferralTreeSummary = {
  total_promoters: number;
  active_promoters: number;
  total_referrals: number;
  total_conversions: number;
  overall_conversion_rate: number;
  total_paid_out: number;
  total_pending: number;
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const getReferralTree = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const supabase = context.supabase;

    // 1. All promoters
    const { data: promoterRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "promoter");
    if (rolesError) throw new Error(rolesError.message);
    const promoterIds = (promoterRoles ?? []).map((r: { user_id: string }) => r.user_id);

    if (promoterIds.length === 0) {
      return {
        promoters: [] as ReferralTreePromoter[],
        summary: {
          total_promoters: 0,
          active_promoters: 0,
          total_referrals: 0,
          total_conversions: 0,
          overall_conversion_rate: 0,
          total_paid_out: 0,
          total_pending: 0,
        } satisfies ReferralTreeSummary,
      };
    }

    const [promoterProfilesRes, promoterIdsRes, referredCustomersRes, commissionsRes] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone")
          .in("id", promoterIds),
        supabase
          .from("promoter_ids")
          .select("user_id, display_id, referral_code, assigned_at")
          .in("user_id", promoterIds),
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, kyc_status, created_at, referred_by_promoter_id")
          .in("referred_by_promoter_id", promoterIds),
        supabase
          .from("promoter_commissions")
          .select("promoter_id, commission_amount, status")
          .in("promoter_id", promoterIds),
      ]);

    if (promoterProfilesRes.error) throw new Error(promoterProfilesRes.error.message);
    if (promoterIdsRes.error) throw new Error(promoterIdsRes.error.message);
    if (referredCustomersRes.error) throw new Error(referredCustomersRes.error.message);
    if (commissionsRes.error) throw new Error(commissionsRes.error.message);

    // 2. Memberships & payments for referred customers
    const referredIds = (referredCustomersRes.data ?? []).map((c: { id: string }) => c.id);
    let membershipsByCustomer = new Map<
      string,
      { status: string; membership_number: string | null }
    >();
    let paidByCustomer = new Map<string, number>();

    if (referredIds.length > 0) {
      const [membershipsRes, paymentsRes] = await Promise.all([
        supabase
          .from("memberships")
          .select("user_id, status, membership_number, created_at")
          .in("user_id", referredIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("payments")
          .select("customer_id, amount, status")
          .in("customer_id", referredIds)
          .eq("status", "paid"),
      ]);
      if (membershipsRes.error) throw new Error(membershipsRes.error.message);
      if (paymentsRes.error) throw new Error(paymentsRes.error.message);

      for (const m of (membershipsRes.data ?? []) as Array<{ user_id: string; status: string; membership_number: string | null }>) {
        if (!membershipsByCustomer.has(m.user_id)) {
          membershipsByCustomer.set(m.user_id, {
            status: m.status,
            membership_number: m.membership_number,
          });
        }
      }
      for (const p of (paymentsRes.data ?? []) as Array<{ customer_id: string; amount: number | string }>) {
        paidByCustomer.set(
          p.customer_id,
          (paidByCustomer.get(p.customer_id) ?? 0) + Number(p.amount ?? 0),
        );
      }
    }

    // 3. Build maps
    const profileMap = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>();
    for (const p of promoterProfilesRes.data ?? []) profileMap.set(p.id, p);

    const idMap = new Map<string, { display_id: string | null; referral_code: string | null; assigned_at: string | null }>();
    for (const p of promoterIdsRes.data ?? []) idMap.set(p.user_id, p);

    const customersByPromoter = new Map<string, ReferralTreeCustomer[]>();
    for (const c of referredCustomersRes.data ?? []) {
      const pid = c.referred_by_promoter_id as string;
      const mem = membershipsByCustomer.get(c.id);
      const entry: ReferralTreeCustomer = {
        id: c.id,
        full_name: c.full_name,
        email: c.email,
        phone: c.phone,
        kyc_status: c.kyc_status,
        created_at: c.created_at,
        membership_status: mem?.status ?? null,
        membership_number: mem?.membership_number ?? null,
        total_paid: paidByCustomer.get(c.id) ?? 0,
      };
      const list = customersByPromoter.get(pid) ?? [];
      list.push(entry);
      customersByPromoter.set(pid, list);
    }

    const earningsMap = new Map<string, { paid: number; pending: number }>();
    for (const row of commissionsRes.data ?? []) {
      const cur = earningsMap.get(row.promoter_id) ?? { paid: 0, pending: 0 };
      const amt = Number(row.commission_amount ?? 0);
      if (row.status === "paid" || row.status === "approved") cur.paid += amt;
      else if (row.status === "pending") cur.pending += amt;
      earningsMap.set(row.promoter_id, cur);
    }

    // 4. Build result
    const promoters: ReferralTreePromoter[] = promoterIds.map((pid) => {
      const profile = profileMap.get(pid);
      const idRow = idMap.get(pid);
      const customers = customersByPromoter.get(pid) ?? [];
      const active = customers.filter((c) => c.membership_status === "active").length;
      const pendingKyc = customers.filter((c) => c.kyc_status !== "approved").length;
      const earnings = earningsMap.get(pid) ?? { paid: 0, pending: 0 };
      return {
        promoter_id: pid,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        display_id: idRow?.display_id ?? null,
        referral_code: idRow?.referral_code ?? null,
        assigned_at: idRow?.assigned_at ?? null,
        total_referred: customers.length,
        active_customers: active,
        pending_kyc: pendingKyc,
        conversion_rate: customers.length > 0 ? active / customers.length : 0,
        total_earnings: earnings.paid,
        pending_earnings: earnings.pending,
        customers: customers.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      };
    });

    promoters.sort((a, b) => b.total_referred - a.total_referred);

    const summary: ReferralTreeSummary = {
      total_promoters: promoters.length,
      active_promoters: promoters.filter((p) => p.total_referred > 0).length,
      total_referrals: promoters.reduce((s, p) => s + p.total_referred, 0),
      total_conversions: promoters.reduce((s, p) => s + p.active_customers, 0),
      overall_conversion_rate: 0,
      total_paid_out: promoters.reduce((s, p) => s + p.total_earnings, 0),
      total_pending: promoters.reduce((s, p) => s + p.pending_earnings, 0),
    };
    summary.overall_conversion_rate =
      summary.total_referrals > 0 ? summary.total_conversions / summary.total_referrals : 0;

    return { promoters, summary };
  });
