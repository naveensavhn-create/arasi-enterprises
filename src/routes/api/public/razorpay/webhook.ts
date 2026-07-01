import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Razorpay webhook receiver.
 * Configure at Razorpay Dashboard → Settings → Webhooks
 *   URL:    https://<your-domain>/api/public/razorpay/webhook
 *   Events: payment.captured, payment.failed, order.paid
 *   Secret: value stored in RAZORPAY_WEBHOOK_SECRET
 */
export const Route = createFileRoute("/api/public/razorpay/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
          console.error("RAZORPAY_WEBHOOK_SECRET not set");
          return new Response("Server not configured", { status: 500 });
        }

        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const body = await request.text();

        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          console.warn("Razorpay webhook: invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        let event: RazorpayWebhookPayload;
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Idempotency key: prefer Razorpay's delivery id header, then in-body id,
        // finally a stable hash of the raw body so duplicates still collapse.
        const headerEventId =
          request.headers.get("x-razorpay-event-id") ??
          request.headers.get("X-Razorpay-Event-Id");
        const bodyEventId = (event as unknown as { id?: string }).id;
        const eventId =
          headerEventId ??
          bodyEventId ??
          `sha256:${createHmac("sha256", secret).update(body).digest("hex")}`;

        try {
          const eventType = event.event;
          const paymentEntity = event.payload?.payment?.entity;
          const orderEntity = event.payload?.order?.entity;

          const orderId = paymentEntity?.order_id ?? orderEntity?.id;
          if (!orderId) {
            return new Response("Missing order id", { status: 400 });
          }

          const { data: paymentRow, error: findErr } = await supabaseAdmin
            .from("payments")
            .select("id, installment_id, membership_id, status")
            .eq("provider_order_id", orderId)
            .maybeSingle();

          const orderId = paymentEntity?.order_id ?? orderEntity?.id;
          if (!orderId) {
            return new Response("Missing order id", { status: 400 });
          }

          // Atomic idempotency guard: unique(event_id) makes duplicates fail
          // insert. If already recorded, short-circuit before touching payments,
          // installments, or memberships.
          const { error: dupErr } = await supabaseAdmin
            .from("razorpay_webhook_events")
            .insert({
              event_id: eventId,
              event_type: eventType,
              order_id: orderId,
              raw: event as unknown as Record<string, unknown>,
            });
          if (dupErr) {
            const code = (dupErr as { code?: string }).code;
            if (code === "23505") {
              // Duplicate delivery — already handled successfully.
              return new Response("ok (duplicate)");
            }
            console.error("Webhook idempotency insert failed", dupErr);
            return new Response("Server error", { status: 500 });
          }

          const { data: paymentRow, error: findErr } = await supabaseAdmin
            .from("payments")
            .select("id, installment_id, membership_id, status")
            .eq("provider_order_id", orderId)
            .maybeSingle();

          if (findErr || !paymentRow) {
            console.warn("Razorpay webhook: no payment row for order", orderId);
            // Still return 200 so Razorpay doesn't retry indefinitely
            return new Response("ok");
          }

          // Link the webhook event to its payment for audit.
          await supabaseAdmin
            .from("razorpay_webhook_events")
            .update({ payment_id: paymentRow.id })
            .eq("event_id", eventId);

          if (eventType === "payment.captured" || eventType === "order.paid") {
            const paidAtSec = paymentEntity?.created_at ?? Math.floor(Date.now() / 1000);
            await supabaseAdmin
              .from("payments")
              .update({
                provider_payment_id: paymentEntity?.id ?? null,
                status: "paid",
                method: paymentEntity?.method ?? null,
                paid_at: new Date(paidAtSec * 1000).toISOString(),
                raw_webhook: event as unknown as any,
              })
              .eq("id", paymentRow.id);

            if (paymentRow.installment_id) {
              const { error: rpcErr } = await supabaseAdmin.rpc("mark_installment_paid", {
                _installment_id: paymentRow.installment_id,
                _payment_id: paymentRow.id,
                _paid_at: new Date(paidAtSec * 1000).toISOString(),
              });
              if (rpcErr) console.error("mark_installment_paid failed", rpcErr);
            } else if (paymentRow.membership_id) {
              // Advance/enrollment payment → activate the membership
              const { error: actErr } = await supabaseAdmin.rpc(
                "activate_membership_after_advance",
                { _payment_id: paymentRow.id },
              );
              if (actErr) console.error("activate_membership_after_advance failed", actErr);
            }
          } else if (eventType === "payment.failed") {
            await supabaseAdmin
              .from("payments")
              .update({
                provider_payment_id: paymentEntity?.id ?? null,
                status: "failed",
                error_code: paymentEntity?.error_code ?? null,
                error_description: paymentEntity?.error_description ?? null,
                raw_webhook: event as unknown as any,
              })
              .eq("id", paymentRow.id);
          } else {
            // Unhandled event — store raw for audit but don't fail
            await supabaseAdmin
              .from("payments")
              .update({ raw_webhook: event as unknown as any })
              .eq("id", paymentRow.id);
          }

          return new Response("ok");
        } catch (err) {
          console.error("Razorpay webhook processing error:", err);
          return new Response("Server error", { status: 500 });
        }
      },
    },
  },
});

type RazorpayPaymentEntity = {
  id: string;
  order_id: string;
  status: string;
  method?: string;
  amount: number;
  currency: string;
  created_at: number;
  error_code?: string;
  error_description?: string;
};

type RazorpayOrderEntity = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

type RazorpayWebhookPayload = {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    order?: { entity: RazorpayOrderEntity };
  };
};
