import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EnrollSchema = z.object({
  planId: z.string().uuid(),
});

/**
 * Creates a pending membership + a Razorpay order for its advance payment.
 * The membership row is created immediately (status='pending') which fires the
 * installment-schedule trigger. The webhook activates it once payment succeeds.
 */
export const createEnrollmentOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => EnrollSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load plan (RLS lets any authenticated user read active plans)
    const { data: plan, error: planErr } = await supabase
      .from("membership_plans")
      .select("id, name, advance_amount, monthly_installment, duration_months, is_active")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr || !plan) throw new Error("Plan not found");
    if (!plan.is_active) throw new Error("Plan is not active");

    // Refuse a second concurrent pending enrollment for the same plan
    const { data: existing } = await supabase
      .from("memberships")
      .select("id, status")
      .eq("user_id", userId)
      .eq("plan_id", plan.id)
      .in("status", ["pending", "active"])
      .maybeSingle();
    if (existing && existing.status === "active") {
      throw new Error("You already have an active membership on this plan");
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay is not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reuse an existing pending membership if one exists, else create a new one
    let membershipId = existing?.id ?? null;
    let membershipNumber: string | null = null;

    if (!membershipId) {
      const { data: created, error: mErr } = await supabaseAdmin
        .from("memberships")
        // membership_number + total_amount are filled by BEFORE INSERT trigger
        .insert({
          user_id: userId,
          plan_id: plan.id,
          status: "pending",
        } as never)
        .select("id, membership_number")
        .single();
      if (mErr || !created) {
        console.error("Failed to create membership:", mErr);
        throw new Error("Failed to start enrollment");
      }
      membershipId = created.id;
      membershipNumber = created.membership_number;
    } else {
      const { data: existingRow } = await supabaseAdmin
        .from("memberships")
        .select("membership_number")
        .eq("id", membershipId)
        .single();
      membershipNumber = existingRow?.membership_number ?? null;
    }

    const advanceAmount = Number(plan.advance_amount);
    if (advanceAmount <= 0) {
      // No advance required — just activate immediately
      await supabaseAdmin
        .from("memberships")
        .update({ status: "active" })
        .eq("id", membershipId!);
      return {
        skipPayment: true as const,
        membershipId: membershipId!,
        membershipNumber,
      };
    }

    // Create Razorpay order for the advance
    const amountPaise = Math.round(advanceAmount * 100);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `adv_${membershipId!.slice(0, 30)}`,
        notes: {
          type: "advance",
          membership_id: membershipId,
          membership_number: membershipNumber,
          plan_id: plan.id,
          customer_id: userId,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Razorpay advance order failed:", text);
      throw new Error("Failed to create payment order");
    }

    const order = (await res.json()) as {
      id: string;
      amount: number;
      currency: string;
      receipt: string;
    };

    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payments")
      .insert({
        membership_id: membershipId!,
        installment_id: null,
        customer_id: userId,
        provider: "razorpay",
        provider_order_id: order.id,
        amount: advanceAmount,
        currency: order.currency,
        status: "created",
        notes: { receipt: order.receipt, type: "advance" },
      })
      .select("id")
      .single();
    if (payErr) {
      console.error("Failed to record advance payment:", payErr);
      throw new Error("Failed to record payment");
    }

    return {
      skipPayment: false as const,
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      paymentRecordId: payment.id,
      membershipId: membershipId!,
      membershipNumber,
      planName: plan.name,
    };
  });

const VerifyEnrollSchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

/**
 * Defence-in-depth signature check from the browser return handler.
 * Webhook remains the source of truth for activating the membership.
 */
export const verifyEnrollmentPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => VerifyEnrollSchema.parse(data))
  .handler(async ({ data, context }) => {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new Error("Razorpay not configured");

    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", secret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(data.razorpay_signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Invalid payment signature");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("payments")
      .update({
        provider_payment_id: data.razorpay_payment_id,
        provider_signature: data.razorpay_signature,
        status: "attempted",
      })
      .eq("provider_order_id", data.razorpay_order_id)
      .eq("customer_id", context.userId);

    return { ok: true };
  });
