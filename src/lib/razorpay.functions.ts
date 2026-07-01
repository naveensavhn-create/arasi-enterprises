import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateOrderSchema = z.object({
  installmentId: z.string().uuid(),
});

/**
 * Creates a Razorpay order for a specific installment owned by the current user.
 * Returns the order details + public key id needed to open Razorpay Checkout.
 */
export const createRazorpayOrderForInstallment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateOrderSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch installment + parent membership, enforcing ownership via RLS
    const { data: inst, error: instErr } = await supabase
      .from("installments")
      .select("id, amount, status, membership_id, sequence, memberships!inner(id, user_id, membership_number)")
      .eq("id", data.installmentId)
      .single();

    if (instErr || !inst) throw new Error("Installment not found");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const membership: any = Array.isArray(inst.memberships) ? inst.memberships[0] : inst.memberships;
    if (!membership || membership.user_id !== userId) throw new Error("Forbidden");
    if (inst.status === "paid") throw new Error("Installment already paid");

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay is not configured");

    const amountPaise = Math.round(Number(inst.amount) * 100);
    const receipt = `inst_${inst.id.slice(0, 30)}`;

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
        receipt,
        notes: {
          installment_id: inst.id,
          membership_id: membership.id,
          membership_number: membership.membership_number,
          customer_id: userId,
          sequence: String(inst.sequence),
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Razorpay order creation failed:", text);
      throw new Error("Failed to create payment order");
    }

    const order = (await res.json()) as {
      id: string;
      amount: number;
      currency: string;
      receipt: string;
      status: string;
    };

    // Record the pending payment (admin client used to bypass RLS insert restriction on customers)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payments")
      .insert({
        membership_id: membership.id,
        installment_id: inst.id,
        customer_id: userId,
        provider: "razorpay",
        provider_order_id: order.id,
        amount: Number(inst.amount),
        currency: order.currency,
        status: "created",
        notes: { receipt: order.receipt },
      })
      .select("id")
      .single();

    if (payErr) {
      console.error("Failed to record payment:", payErr);
      throw new Error("Failed to record payment");
    }

    return {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      paymentRecordId: payment.id,
      installmentId: inst.id,
      membershipNumber: membership.membership_number,
    };
  });

/**
 * Client-side signature verification fallback (defense-in-depth; the webhook is source of truth).
 */
const VerifySchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => VerifySchema.parse(data))
  .handler(async ({ data, context }) => {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new Error("Razorpay not configured");

    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", secret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(data.razorpay_signature);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) throw new Error("Invalid payment signature");

    // Update payment status to attempted; webhook will finalize as paid
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
