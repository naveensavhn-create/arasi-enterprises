import { createFileRoute } from "@tanstack/react-router";
import { applyPaymentStatusIn } from "@/lib/payments/status-filter";


/**
 * Daily reconciliation cron.
 * Selects in-scope payments (recent + not-yet-terminal or recently paid) and
 * reconciles each against Razorpay, appending rows to `payment_reconciliations`.
 *
 * Auth: called by pg_cron with the Supabase anon key in the `apikey` header.
 * The `/api/public/*` prefix bypasses edge auth on published sites; we
 * additionally require the anon key to prevent casual external calls.
 */
export const Route = createFileRoute("/api/public/hooks/reconcile-payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("x-api-key") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!anon || provided !== anon) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: {
          lookbackDays?: number;
          maxPayments?: number;
          statuses?: string[];
        } = {};
        try {
          const raw = await request.text();
          if (raw) body = JSON.parse(raw);
        } catch {
          /* ignore, use defaults */
        }

        const lookbackDays = Math.min(Math.max(body.lookbackDays ?? 7, 1), 90);
        const maxPayments = Math.min(Math.max(body.maxPayments ?? 200, 1), 1000);
        // In-scope by default: anything not yet in a terminal state, plus
        // recently-paid rows (catches refunds/chargebacks that flipped on the
        // provider side after we recorded "paid").
        const statuses =
          body.statuses && body.statuses.length > 0
            ? body.statuses
            : ["created", "attempted", "pending", "paid", "failed"];

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { reconcileSinglePayment } = await import(
          "@/lib/payments/reconcile-one.server"
        );

        const sinceISO = new Date(
          Date.now() - lookbackDays * 86_400_000,
        ).toISOString();

        const { data: payments, error } = await supabaseAdmin
          .from("payments")
          .select("id, provider_order_id, provider_payment_id, status, created_at")
          // payments.status is an enum; cast to text so PG15/16 accepts the IN filter.
          .filter("status::text", "in", `(${statuses.join(",")})`)
          .gte("created_at", sinceISO)
          .order("created_at", { ascending: false })
          .limit(maxPayments);

        if (error) {
          console.error("reconcile-payments cron: select failed", error);
          return new Response(
            JSON.stringify({ ok: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const startedAt = Date.now();
        let matched = 0,
          mismatch = 0,
          skipped = 0,
          errors = 0,
          disabled = 0;

        for (const p of payments ?? []) {
          const outcome = await reconcileSinglePayment(supabaseAdmin, {
            paymentId: p.id,
            providerPaymentId: p.provider_payment_id,
            providerOrderId: p.provider_order_id,
            eventId: `cron:${new Date().toISOString().slice(0, 10)}`,
          });
          if (outcome.status === "matched") matched += 1;
          else if (outcome.status === "mismatch") mismatch += 1;
          else if (outcome.status === "skipped") skipped += 1;
          else if (outcome.status === "disabled") disabled += 1;
          else errors += 1;
        }

        const durationMs = Date.now() - startedAt;
        const summary = {
          ok: true,
          checked: payments?.length ?? 0,
          matched,
          mismatch,
          skipped,
          errors,
          disabled,
          lookbackDays,
          maxPayments,
          statuses,
          durationMs,
          finishedAt: new Date().toISOString(),
        };
        console.log("reconcile-payments cron finished", summary);
        return new Response(JSON.stringify(summary), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
