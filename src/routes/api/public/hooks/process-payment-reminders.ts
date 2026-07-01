import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { render } from "@react-email/render";
import * as React from "react";
import PaymentReminder, {
  template as reminderTemplate,
} from "@/lib/email-templates/payment-reminder";
import type { Database } from "@/integrations/supabase/types";

/**
 * Background worker that processes queued monthly payment reminder jobs.
 *
 * Trigger: pg_cron POSTs here every minute with the Supabase publishable key
 * as the `apikey` header. Missing/mismatched key → 401 before any DB work.
 *
 * Reliability contract:
 *   - Idempotent claim: `claim_due_reminder_jobs` uses `FOR UPDATE SKIP LOCKED`
 *     inside a single UPDATE so two workers can't grab the same job.
 *   - Retries: transient failures reschedule with exponential backoff
 *     (60s, 240s, 960s, capped at 1h) until `max_attempts` (default 5).
 *   - Dead-letter: exhausted jobs are marked `failed` with `dead_letter_at`.
 *   - Audit: every terminal outcome (sent / retry / dead-letter / skipped)
 *     writes an admin_audit_log row via `finalize_reminder_job`.
 */

const BATCH_SIZE = 25;
const BACKOFF_SECONDS = [60, 240, 960, 3600, 3600];

type Job = Database["public"]["Tables"]["payment_reminder_jobs"]["Row"];

function backoffSecondsFor(attempts: number): number {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx];
}

async function finalize(
  supabase: SupabaseClient<Database>,
  jobId: string,
  args: {
    status: "sent" | "failed" | "dead_letter" | "skipped";
    provider?: string | null;
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryInSeconds?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.rpc("finalize_reminder_job", {
    _job_id: jobId,
    _status: args.status,
    _provider: args.provider ?? undefined,
    _provider_message_id: args.providerMessageId ?? undefined,
    _error_code: args.errorCode ?? undefined,
    _error_message: args.errorMessage ?? undefined,
    _retry_in_seconds: args.retryInSeconds ?? undefined,
    _metadata: (args.metadata ?? {}) as never,
  });
  if (error) {
    // Nothing else we can do — surface for logs.
    console.error("finalize_reminder_job failed", jobId, error.message);
  }
}

async function loadContext(supabase: SupabaseClient<Database>, job: Job) {
  const [
    { data: installment },
    { data: membership },
  ] = await Promise.all([
    supabase
      .from("installments")
      .select("id, sequence, due_date, amount, status")
      .eq("id", job.installment_id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select(
        "id, membership_number, member_display_id, user_id, plan_id, plan:membership_plans(name, duration_months)",
      )
      .eq("id", job.membership_id)
      .maybeSingle(),
  ]);

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", job.recipient_id)
    .maybeSingle();

  return { installment, membership, profile };
}

async function loadBrand(supabase: SupabaseClient<Database>) {
  const { data: settings } = await supabase
    .from("site_settings")
    .select(
      "brand_name, tagline, support_email, primary_color, accent_color, heading_font, body_font, logo_url",
    )
    .limit(1)
    .maybeSingle();
  if (!settings) return undefined;
  return {
    name: settings.brand_name ?? undefined,
    tagline: settings.tagline ?? undefined,
    supportEmail: settings.support_email ?? undefined,
    logoUrl: settings.logo_url ?? undefined,
    primaryColor: settings.primary_color ?? undefined,
    accentColor: settings.accent_color ?? undefined,
    headingFont: settings.heading_font ?? undefined,
    bodyFont: settings.body_font ?? undefined,
  };
}

async function dispatchEmail(args: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<{
  status: "sent" | "failed" | "skipped_no_email_infra";
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}> {
  const senderDomain = process.env.SENDER_DOMAIN;
  const lovableApiKey = process.env.LOVABLE_API_KEY;
  if (!senderDomain || !lovableApiKey) {
    return {
      status: "skipped_no_email_infra",
      errorCode: "no_email_infra",
      errorMessage:
        "Sender domain not configured. Set up an email domain in Cloud → Emails.",
    };
  }
  try {
    const url =
      `${process.env.SUPABASE_URL ?? ""}`.replace(/\/$/, "") +
      "/functions/v1/lovable-email-send";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        to: args.to,
        from: `notify@${senderDomain}`,
        subject: args.subject,
        html: args.html,
        template: "payment-reminder",
        idempotency_key: args.idempotencyKey,
      }),
    });
    if (!res.ok) {
      return {
        status: "failed",
        errorCode: `http_${res.status}`,
        errorMessage: `Email provider returned ${res.status}: ${await res.text()}`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      id?: string;
    };
    return {
      status: "sent",
      providerMessageId: body.message_id ?? body.id,
    };
  } catch (err) {
    return {
      status: "failed",
      errorCode: "network_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function processJob(
  supabase: SupabaseClient<Database>,
  job: Job,
): Promise<{ jobId: string; outcome: string }> {
  // Only email is wired today; SMS jobs get skipped with a clear reason.
  if (job.channel !== "email") {
    await finalize(supabase, job.id, {
      status: "skipped",
      errorCode: "unsupported_channel",
      errorMessage: `Channel "${job.channel}" is not implemented yet.`,
    });
    return { jobId: job.id, outcome: "skipped_channel" };
  }

  const recipient = job.recipient_email;
  if (!recipient) {
    await finalize(supabase, job.id, {
      status: "skipped",
      errorCode: "no_recipient",
      errorMessage: "Recipient email is missing.",
    });
    return { jobId: job.id, outcome: "skipped_no_recipient" };
  }

  const { installment, membership, profile } = await loadContext(supabase, job);
  if (!installment || !membership) {
    await finalize(supabase, job.id, {
      status: "skipped",
      errorCode: "missing_context",
      errorMessage: "Installment or membership no longer exists.",
    });
    return { jobId: job.id, outcome: "skipped_missing_context" };
  }
  // Don't chase an installment that's already been paid since we queued it.
  if (installment.status === "paid") {
    await finalize(supabase, job.id, {
      status: "skipped",
      errorCode: "already_paid",
      errorMessage: "Installment was paid before the reminder was sent.",
    });
    return { jobId: job.id, outcome: "skipped_already_paid" };
  }

  const brand = await loadBrand(supabase);
  const planName =
    (membership as unknown as { plan?: { name?: string | null } }).plan?.name ??
    null;
  const totalMonths =
    (
      membership as unknown as {
        plan?: { duration_months?: number | null };
      }
    ).plan?.duration_months ?? null;

  const html = await render(
    React.createElement(PaymentReminder, {
      recipientName: profile?.full_name ?? undefined,
      membershipNumber: membership.membership_number,
      memberDisplayId: membership.member_display_id ?? undefined,
      planName: planName ?? undefined,
      installmentSequence: installment.sequence,
      installmentTotal: totalMonths ?? undefined,
      amountDue: Number(installment.amount),
      currency: "INR",
      dueDate: installment.due_date,
      brand,
    }),
  );

  const dispatched = await dispatchEmail({
    to: recipient,
    subject: reminderTemplate.subject,
    html,
    // Stable per (job + attempt) so retries never re-send an already-accepted email.
    idempotencyKey: `payment-reminder:${job.id}:${job.attempts}`,
  });

  if (dispatched.status === "sent") {
    await finalize(supabase, job.id, {
      status: "sent",
      provider: "lovable-emails",
      providerMessageId: dispatched.providerMessageId ?? null,
    });
    return { jobId: job.id, outcome: "sent" };
  }

  if (dispatched.status === "skipped_no_email_infra") {
    await finalize(supabase, job.id, {
      status: "skipped",
      errorCode: dispatched.errorCode ?? null,
      errorMessage: dispatched.errorMessage ?? null,
    });
    return { jobId: job.id, outcome: "skipped_no_infra" };
  }

  // Transient failure — let finalize decide retry vs dead-letter.
  await finalize(supabase, job.id, {
    status: "failed",
    errorCode: dispatched.errorCode ?? null,
    errorMessage: dispatched.errorMessage ?? null,
    retryInSeconds: backoffSecondsFor(job.attempts),
  });
  return { jobId: job.id, outcome: "retry_or_dead_letter" };
}

export const Route = createFileRoute(
  "/api/public/hooks/process-payment-reminders",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ??
          request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          process.env.SUPABASE_ANON_KEY ??
          "";
        if (!expected || apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const supabaseAdmin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { data: claimed, error: claimErr } = await supabaseAdmin.rpc(
          "claim_due_reminder_jobs",
          { _limit: BATCH_SIZE },
        );
        if (claimErr) {
          return Response.json(
            { ok: false, error: `claim failed: ${claimErr.message}` },
            { status: 500 },
          );
        }

        const jobs = (claimed ?? []) as Job[];
        const results: Array<{ jobId: string; outcome: string }> = [];
        for (const job of jobs) {
          try {
            results.push(await processJob(supabaseAdmin, job));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await finalize(supabaseAdmin, job.id, {
              status: "failed",
              errorCode: "worker_exception",
              errorMessage: message,
              retryInSeconds: backoffSecondsFor(job.attempts),
            });
            results.push({ jobId: job.id, outcome: "exception" });
          }
        }

        return Response.json({
          ok: true,
          claimed: jobs.length,
          results,
        });
      },
    },
  },
});
