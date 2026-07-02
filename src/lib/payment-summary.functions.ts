import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Customer-facing "Payment Processing Summary".
 *
 * For each of the caller's successful payments we return the downstream
 * cascade the orchestrator produced:
 *  - which receipt was generated
 *  - the membership status before/after this payment
 *  - reward events unlocked / status-changed by the recompute run
 *  - lucky-draw entries auto-enrolled after payment
 *
 * We correlate rows by (membership_id, user_id) within a ±5 minute window
 * of `payments.paid_at`. That is a comfortable envelope for the orchestrator
 * trigger (which runs synchronously in the same transaction as the payment
 * insert/update) while remaining tight enough that a later manual
 * recomputation on the same membership doesn't get attributed to an older
 * payment.
 */

// Window (ms) around paid_at that we treat as "caused by this payment".
const CORRELATION_WINDOW_MS = 5 * 60 * 1000;

export type MembershipSnapshot = {
  membership_id: string;
  membership_number: string | null;
  member_display_id: string | null;
  plan_name: string | null;
  plan_total_amount: number | null;
  status_after: string;
  paid_amount: number;
  paid_installments: number;
  total_installments: number;
  progress_percent: number;
  status_changed: boolean;
  became_active: boolean;
  became_completed: boolean;
};

export type RewardEventLite = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  tier_name: string | null;
  tier_value: number | null;
  reward_number: string | null;
  note: string | null;
  created_at: string;
};

export type DrawEntryLite = {
  id: string;
  draw_id: string;
  draw_title: string | null;
  draw_status: string | null;
  entry_number: string | null;
  entered_at: string;
};

export type PaymentSummary = {
  payment_id: string;
  paid_at: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  provider_payment_id: string | null;
  installment_sequence: number | null;
  installment_due_date: string | null;
  receipt_number: string | null;
  receipt_id: string | null;
  membership: MembershipSnapshot | null;
  rewards: RewardEventLite[];
  draws: DrawEntryLite[];
};

export const listMyPaymentSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { limit?: number }) =>
    z
      .object({ limit: z.number().int().min(1).max(200).optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PaymentSummary[]> => {
    const supabase = context.supabase;
    const userId = context.userId;
    const limit = data.limit ?? 50;

    // 1. All successful payments the caller made. RLS scopes to customer_id.
    const { data: payments, error: paymentsErr } = await supabase
      .from("payments")
      .select(
        "id, membership_id, installment_id, amount, currency, method, provider_payment_id, paid_at, created_at, status",
      )
      .eq("customer_id", userId)
      .eq("status", "paid")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (paymentsErr) throw new Error(paymentsErr.message);
    const paidPayments = (payments ?? []).filter((p) => p.paid_at);
    if (paidPayments.length === 0) return [];

    const paymentIds = paidPayments.map((p) => p.id);
    const membershipIds = Array.from(
      new Set(paidPayments.map((p) => p.membership_id).filter(Boolean) as string[]),
    );
    const installmentIds = Array.from(
      new Set(
        paidPayments.map((p) => p.installment_id).filter(Boolean) as string[],
      ),
    );

    // Time window covering every payment we're summarising.
    const minPaidAt = paidPayments.reduce(
      (min, p) => (p.paid_at! < min ? p.paid_at! : min),
      paidPayments[0].paid_at!,
    );
    const maxPaidAt = paidPayments.reduce(
      (max, p) => (p.paid_at! > max ? p.paid_at! : max),
      paidPayments[0].paid_at!,
    );
    const windowFrom = new Date(
      new Date(minPaidAt).getTime() - CORRELATION_WINDOW_MS,
    ).toISOString();
    const windowTo = new Date(
      new Date(maxPaidAt).getTime() + CORRELATION_WINDOW_MS,
    ).toISOString();

    const [
      receiptsRes,
      membershipsRes,
      installmentsRes,
      rewardEventsRes,
      drawEntriesRes,
    ] = await Promise.all([
      supabase
        .from("receipts")
        .select("id, receipt_number, payment_id, voided_at")
        .in("payment_id", paymentIds),
      membershipIds.length
        ? supabase
            .from("memberships")
            .select(
              "id, membership_number, member_display_id, plan_id, status, paid_amount",
            )
            .in("id", membershipIds)
        : Promise.resolve({ data: [], error: null }),
      installmentIds.length
        ? supabase
            .from("installments")
            .select("id, sequence, due_date")
            .in("id", installmentIds)
        : Promise.resolve({ data: [], error: null }),
      membershipIds.length
        ? supabase
            .from("reward_events")
            .select(
              "id, event_type, from_status, to_status, tier_id, reward_id, membership_id, note, created_at",
            )
            .eq("user_id", userId)
            .in("membership_id", membershipIds)
            .gte("created_at", windowFrom)
            .lte("created_at", windowTo)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("draw_entries")
        .select("id, draw_id, entry_number, entered_at")
        .eq("customer_id", userId)
        .gte("entered_at", windowFrom)
        .lte("entered_at", windowTo),
    ]);

    if (receiptsRes.error) throw new Error(receiptsRes.error.message);
    if (membershipsRes.error) throw new Error(membershipsRes.error.message);
    if (installmentsRes.error) throw new Error(installmentsRes.error.message);
    if (rewardEventsRes.error) throw new Error(rewardEventsRes.error.message);
    if (drawEntriesRes.error) throw new Error(drawEntriesRes.error.message);

    // Enrich lookups (plans, reward tiers/rewards, draws).
    const planIds = Array.from(
      new Set(
        (membershipsRes.data ?? [])
          .map((m: any) => m.plan_id)
          .filter(Boolean),
      ),
    );
    const tierIds = Array.from(
      new Set(
        (rewardEventsRes.data ?? [])
          .map((e: any) => e.tier_id)
          .filter(Boolean),
      ),
    );
    const rewardIds = Array.from(
      new Set(
        (rewardEventsRes.data ?? [])
          .map((e: any) => e.reward_id)
          .filter(Boolean),
      ),
    );
    const drawIds = Array.from(
      new Set((drawEntriesRes.data ?? []).map((d: any) => d.draw_id)),
    );

    const [plansRes, tiersRes, rewardsRes, drawsRes, allInstsRes] =
      await Promise.all([
        planIds.length
          ? supabase
              .from("membership_plans")
              .select("id, name, total_amount")
              .in("id", planIds)
          : Promise.resolve({ data: [], error: null }),
        tierIds.length
          ? supabase
              .from("reward_tiers")
              .select("id, name, reward_value")
              .in("id", tierIds)
          : Promise.resolve({ data: [], error: null }),
        rewardIds.length
          ? supabase
              .from("customer_rewards")
              .select("id, reward_number")
              .in("id", rewardIds)
          : Promise.resolve({ data: [], error: null }),
        drawIds.length
          ? supabase
              .from("draws")
              .select("id, title, status")
              .in("id", drawIds)
          : Promise.resolve({ data: [], error: null }),
        membershipIds.length
          ? supabase
              .from("installments")
              .select("id, membership_id, status")
              .in("membership_id", membershipIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    const receiptByPayment = new Map<string, any>(
      (receiptsRes.data ?? []).map((r: any) => [r.payment_id, r]),
    );
    const membershipMap = new Map<string, any>(
      (membershipsRes.data ?? []).map((m: any) => [m.id, m]),
    );
    const installmentMap = new Map<string, any>(
      (installmentsRes.data ?? []).map((i: any) => [i.id, i]),
    );
    const planMap = new Map<string, any>(
      (plansRes.data ?? []).map((p: any) => [p.id, p]),
    );
    const tierMap = new Map<string, any>(
      (tiersRes.data ?? []).map((t: any) => [t.id, t]),
    );
    const rewardMap = new Map<string, any>(
      (rewardsRes.data ?? []).map((r: any) => [r.id, r]),
    );
    const drawMap = new Map<string, any>(
      (drawsRes.data ?? []).map((d: any) => [d.id, d]),
    );

    // Per-membership installment counts (current). We can't reliably know
    // the exact count at time of payment, so we surface the latest paid
    // count from installments — the trigger recomputes it in the same
    // transaction so this is faithful for the most recent payment and a
    // safe upper-bound for older ones.
    const perMembershipInstalls = new Map<
      string,
      { total: number; paid: number }
    >();
    for (const inst of (allInstsRes.data ?? []) as Array<{
      membership_id: string;
      status: string;
    }>) {
      const bucket = perMembershipInstalls.get(inst.membership_id) ?? {
        total: 0,
        paid: 0,
      };
      bucket.total += 1;
      if (inst.status === "paid") bucket.paid += 1;
      perMembershipInstalls.set(inst.membership_id, bucket);
    }

    // Rank payments per-membership so we can detect the "activation" and
    // "completion" boundaries without touching admin_audit_log.
    const paymentsByMembership = new Map<string, typeof paidPayments>();
    for (const p of paidPayments) {
      if (!p.membership_id) continue;
      const list = paymentsByMembership.get(p.membership_id) ?? [];
      list.push(p);
      paymentsByMembership.set(p.membership_id, list);
    }
    for (const list of paymentsByMembership.values()) {
      list.sort((a, b) =>
        (a.paid_at ?? a.created_at ?? "").localeCompare(
          b.paid_at ?? b.created_at ?? "",
        ),
      );
    }

    return paidPayments.map((p): PaymentSummary => {
      const receipt = receiptByPayment.get(p.id) ?? null;
      const inst = p.installment_id ? installmentMap.get(p.installment_id) : null;
      const membershipRow = p.membership_id
        ? membershipMap.get(p.membership_id)
        : null;
      const plan = membershipRow?.plan_id
        ? planMap.get(membershipRow.plan_id)
        : null;
      const counts = p.membership_id
        ? perMembershipInstalls.get(p.membership_id) ?? { total: 0, paid: 0 }
        : { total: 0, paid: 0 };
      const orderedForMembership = p.membership_id
        ? paymentsByMembership.get(p.membership_id) ?? []
        : [];
      const paymentIndex = orderedForMembership.findIndex((x) => x.id === p.id);
      const isFirstPayment = paymentIndex === 0;
      const isLastPayment = paymentIndex === orderedForMembership.length - 1;

      const membership: MembershipSnapshot | null = membershipRow
        ? {
            membership_id: membershipRow.id,
            membership_number: membershipRow.membership_number ?? null,
            member_display_id: membershipRow.member_display_id ?? null,
            plan_name: plan?.name ?? null,
            plan_total_amount: plan?.total_amount
              ? Number(plan.total_amount)
              : null,
            status_after: membershipRow.status,
            paid_amount: Number(membershipRow.paid_amount ?? 0),
            paid_installments: counts.paid,
            total_installments: counts.total,
            progress_percent: counts.total
              ? Math.round((counts.paid / counts.total) * 100)
              : 0,
            status_changed:
              isFirstPayment ||
              (isLastPayment && membershipRow.status === "completed"),
            became_active: isFirstPayment && membershipRow.status !== "pending",
            became_completed:
              isLastPayment && membershipRow.status === "completed",
          }
        : null;

      const paidAtMs = new Date(p.paid_at!).getTime();
      const rewards: RewardEventLite[] = ((rewardEventsRes.data ?? []) as any[])
        .filter((e) => {
          if (e.membership_id !== p.membership_id) return false;
          const dt = new Date(e.created_at).getTime();
          return Math.abs(dt - paidAtMs) <= CORRELATION_WINDOW_MS;
        })
        .map((e) => {
          const tier = e.tier_id ? tierMap.get(e.tier_id) : null;
          const reward = e.reward_id ? rewardMap.get(e.reward_id) : null;
          return {
            id: e.id,
            event_type: e.event_type,
            from_status: e.from_status,
            to_status: e.to_status,
            tier_name: tier?.name ?? null,
            tier_value: tier?.reward_value ? Number(tier.reward_value) : null,
            reward_number: reward?.reward_number ?? null,
            note: e.note ?? null,
            created_at: e.created_at,
          };
        })
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      const draws: DrawEntryLite[] = ((drawEntriesRes.data ?? []) as any[])
        .filter((d) => {
          const dt = new Date(d.entered_at).getTime();
          return Math.abs(dt - paidAtMs) <= CORRELATION_WINDOW_MS;
        })
        .map((d) => {
          const draw = drawMap.get(d.draw_id);
          return {
            id: d.id,
            draw_id: d.draw_id,
            draw_title: draw?.title ?? null,
            draw_status: draw?.status ?? null,
            entry_number: d.entry_number ?? null,
            entered_at: d.entered_at,
          };
        })
        .sort((a, b) => a.entered_at.localeCompare(b.entered_at));

      return {
        payment_id: p.id,
        paid_at: p.paid_at!,
        amount: Number(p.amount),
        currency: p.currency ?? "INR",
        payment_method: p.payment_method ?? null,
        provider_payment_id: p.provider_payment_id ?? null,
        installment_sequence: inst?.sequence ?? null,
        installment_due_date: inst?.due_date ?? null,
        receipt_number: receipt?.receipt_number ?? null,
        receipt_id: receipt?.id ?? null,
        membership,
        rewards,
        draws,
      };
    });
  });
