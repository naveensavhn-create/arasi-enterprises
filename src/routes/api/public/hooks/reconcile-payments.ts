import { createFileRoute } from "@tanstack/react-router";
import {
  applyPaymentStatusEq,
  coercePaymentStatusesOrLog,
  isPaymentStatus,
  type PaymentStatus,
} from "@/lib/payments/status-filter";

/**
 * JSON error helper — every rejection sent to callers follows this shape so
 * cron / operators can grep on `code` and `error` without regexing prose.
 */
function jsonError(
  status: number,
  code: string,
  detail: Record<string, unknown> & { message: string },
): Response {
  return new Response(
    JSON.stringify({ ok: false, error: code, ...detail }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}




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
          statuses?: unknown;
        } = {};
        try {
          const raw = await request.text();
          if (raw) body = JSON.parse(raw);
        } catch {
          /* ignore, use defaults */
        }

        const lookbackDays = Math.min(Math.max(body.lookbackDays ?? 7, 1), 90);
        const maxPayments = Math.min(Math.max(body.maxPayments ?? 200, 1), 1000);

        // Strict validation of caller-supplied statuses. We reject invalid
        // input with a 400 BEFORE issuing any PostgREST query so a
        // typo/stale caller (e.g. body.statuses = ["pending"]) surfaces
        // loudly instead of silently reconciling zero rows.
        //
        // `statuses` is optional; omitted / null / [] falls back to the
        // in-scope default. Anything present must be an array of valid
        // `payment_status` enum values.
        const DEFAULT_STATUSES: PaymentStatus[] = [
          "created",
          "attempted",
          "paid",
          "failed",
        ];
        let statuses: PaymentStatus[] = DEFAULT_STATUSES;
        if (body.statuses !== undefined && body.statuses !== null) {
          if (!Array.isArray(body.statuses)) {
            return jsonError(400, "INVALID_STATUSES", {
              message:
                "`statuses` must be an array of payment_status values.",
              received: typeof body.statuses,
            });
          }
          const invalid = body.statuses.filter((v) => !isPaymentStatus(v));
          if (invalid.length > 0) {
            return jsonError(400, "INVALID_PAYMENT_STATUS", {
              message:
                "One or more `statuses` values are not valid payment_status enum members.",
              invalid,
              allowed: [
                "created",
                "attempted",
                "paid",
                "failed",
                "refunded",
              ],
            });
          }
          if (body.statuses.length > 0) {
            // Strict check above already rejected any invalid entry, so
            // `coercePaymentStatuses` here only dedupes and narrows the
            // TS type to `PaymentStatus[]` before it hits the query helper.
            statuses = coercePaymentStatusesOrLog(body.statuses, {
              source: "reconcile-payments:body.statuses",
            });
          }
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { reconcileSinglePayment } = await import(
          "@/lib/payments/reconcile-one.server"
        );

        const sinceISO = new Date(
          Date.now() - lookbackDays * 86_400_000,
        ).toISOString();

        const { data: payments, error } = await applyPaymentStatusEq(
          supabaseAdmin
            .from("payments")
            .select("id, provider_order_id, provider_payment_id, status, created_at"),
          statuses,
        )
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
