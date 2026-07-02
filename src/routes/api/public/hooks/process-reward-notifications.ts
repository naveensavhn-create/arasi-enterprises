import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { render } from "@react-email/render";
import * as React from "react";
import RewardUnlocked from "@/lib/email-templates/reward-unlocked";
import RewardClaimStatusEmail, {
  type RewardClaimStatus,
} from "@/lib/email-templates/reward-claim-status";
import { brand } from "@/lib/email-templates/_shared";
import { loadBrandOverrides } from "@/lib/email/load-brand.server";
import type { Database } from "@/integrations/supabase/types";

/**
 * Background worker that processes queued reward notification jobs.
 *
 * Trigger: pg_cron POSTs here every minute with the Supabase publishable
 * key as the `apikey` header (same auth contract as
 * process-payment-reminders). Missing / mismatched key → 401 before any
 * DB work.
 *
 * One job per (reward_event, channel). Retries use exponential backoff
 * and dead-letter after `max_attempts` (default 5).
 */

const BATCH_SIZE = 25;
const BACKOFF_SECONDS = [60, 240, 960, 3600, 3600];

type Job = Database["public"]["Tables"]["reward_notification_jobs"]["Row"];

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
  const { error } = await supabase.rpc("finalize_reward_notification_job", {
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
    console.error(
      "finalize_reward_notification_job failed",
      jobId,
      error.message,
    );
  }
}

async function loadContext(supabase: SupabaseClient<Database>, job: Job) {
  const [{ data: reward }, { data: tier }, { data: membership }, { data: profile }] =
    await Promise.all([
      job.reward_id
        ? supabase
            .from("customer_rewards")
            .select(
              "id, reward_number, status, tracking_reference, admin_note, unlocked_at",
            )
            .eq("id", job.reward_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.tier_id
        ? supabase
            .from("reward_tiers")
            .select("id, name, description, reward_value")
            .eq("id", job.tier_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      job.membership_id
        ? supabase
            .from("memberships")
            .select("id, membership_number, member_display_id")
            .eq("id", job.membership_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", job.recipient_id)
        .maybeSingle(),
    ]);
  return { reward, tier, membership, profile };
}

async function dispatchEmail(args: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  template: string;
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
        template: args.template,
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
    return { status: "sent", providerMessageId: body.message_id ?? body.id };
  } catch (err) {
    return {
      status: "failed",
      errorCode: "network_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send an SMS via MSG91's Flow API. Requires MSG91_AUTH_KEY, MSG91_SENDER_ID
 * and a DLT-approved reward flow template ID
 * (MSG91_REWARD_UNLOCKED_TEMPLATE_ID or MSG91_REWARD_STATUS_TEMPLATE_ID).
 * Missing credentials → skipped_no_sms_infra so ops can see the gap.
 */
async function dispatchSms(args: {
  to: string;
  templateId: string;
  variables: Record<string, string>;
  idempotencyKey: string;
}): Promise<{
  status: "sent" | "failed" | "skipped_no_sms_infra";
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const senderId = process.env.MSG91_SENDER_ID;
  if (!authKey || !senderId || !args.templateId) {
    return {
      status: "skipped_no_sms_infra",
      errorCode: "no_sms_infra",
      errorMessage:
        "SMS provider not configured. Set MSG91_AUTH_KEY, MSG91_SENDER_ID and the reward template IDs.",
    };
  }
  const mobile = args.to.replace(/[^\d]/g, "");
  if (!mobile || mobile.length < 10) {
    return {
      status: "failed",
      errorCode: "invalid_recipient",
      errorMessage: `Recipient phone "${args.to}" is not a valid number.`,
    };
  }
  try {
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: authKey },
      body: JSON.stringify({
        template_id: args.templateId,
        sender: senderId,
        short_url: "0",
        recipients: [{ mobiles: mobile, ...args.variables }],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        status: "failed",
        errorCode: `http_${res.status}`,
        errorMessage: `MSG91 returned ${res.status}: ${text.slice(0, 500)}`,
      };
    }
    const parsed = (() => {
      try {
        return JSON.parse(text) as {
          type?: string;
          message?: string;
          request_id?: string;
        };
      } catch {
        return {} as Record<string, string>;
      }
    })();
    if (parsed.type && parsed.type !== "success") {
      return {
        status: "failed",
        errorCode: "provider_error",
        errorMessage: parsed.message ?? text.slice(0, 500),
      };
    }
    return {
      status: "sent",
      providerMessageId: parsed.request_id ?? args.idempotencyKey,
    };
  } catch (err) {
    return {
      status: "failed",
      errorCode: "network_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function subjectFor(
  kind: Job["notification_kind"],
  tierName: string,
): string {
  return kind === "unlocked"
    ? `[${brand.name}] You've unlocked ${tierName}`
    : `[${brand.name}] Reward claim update — ${tierName}`;
}

async function processJob(
  supabase: SupabaseClient<Database>,
  job: Job,
): Promise<{ jobId: string; outcome: string }> {
  const recipient =
    job.channel === "email" ? job.recipient_email : job.recipient_phone;
  if (!recipient) {
    await finalize(supabase, job.id, {
      status: "skipped",
      errorCode: "no_recipient",
      errorMessage:
        job.channel === "email"
          ? "Recipient email is missing."
          : "Recipient phone is missing.",
    });
    return { jobId: job.id, outcome: "skipped_no_recipient" };
  }

  const { reward, tier, membership, profile } = await loadContext(supabase, job);
  const tierName = tier?.name ?? "your reward";
  const rewardNumber = reward?.reward_number ?? null;
  const recipientName =
    ((job.metadata as Record<string, unknown>)?.recipient_name as string | undefined) ??
    profile?.full_name ??
    undefined;
  const membershipNumber =
    membership?.member_display_id ?? membership?.membership_number ?? null;
  const adminNote =
    reward?.admin_note ??
    ((job.metadata as Record<string, unknown>)?.event_note as string | undefined) ??
    null;

  let dispatched:
    | Awaited<ReturnType<typeof dispatchEmail>>
    | Awaited<ReturnType<typeof dispatchSms>>;
  let providerName: string;
  let skippedInfraCode: "skipped_no_email_infra" | "skipped_no_sms_infra";

  if (job.channel === "email") {
    const subject = subjectFor(job.notification_kind, tierName);
    let html: string;
    let templateName: string;

    if (job.notification_kind === "unlocked") {
      html = await render(
        React.createElement(RewardUnlocked, {
          recipientName,
          rewardNumber,
          tierName,
          tierDescription: tier?.description ?? null,
          rewardValue: tier?.reward_value ? Number(tier.reward_value) : null,
          membershipNumber,
          unlockedAt:
            reward?.unlocked_at ?? job.created_at ?? new Date().toISOString(),
          actionUrl: process.env.APP_URL
            ? `${process.env.APP_URL.replace(/\/$/, "")}/customer/rewards`
            : undefined,
        }),
      );
      templateName = "reward-unlocked";
    } else {
      html = await render(
        React.createElement(RewardClaimStatusEmail, {
          recipientName,
          rewardNumber,
          tierName,
          fromStatus: (job.from_status ?? null) as RewardClaimStatus | null,
          toStatus: (job.to_status ?? reward?.status ?? "eligible") as RewardClaimStatus,
          trackingReference: reward?.tracking_reference ?? null,
          adminNote,
          changedAt: job.created_at ?? new Date().toISOString(),
          actionUrl: process.env.APP_URL
            ? `${process.env.APP_URL.replace(/\/$/, "")}/customer/rewards`
            : undefined,
        }),
      );
      templateName = "reward-claim-status";
    }

    dispatched = await dispatchEmail({
      to: recipient,
      subject,
      html,
      idempotencyKey: `reward-notification:${job.id}:${job.attempts}`,
      template: templateName,
    });
    providerName = "lovable-emails";
    skippedInfraCode = "skipped_no_email_infra";
  } else {
    // SMS. Variables map to MSG91 DLT template placeholders:
    //   ##name## ##tier## ##status## ##reward## ##tracking##
    const templateId =
      job.notification_kind === "unlocked"
        ? process.env.MSG91_REWARD_UNLOCKED_TEMPLATE_ID ?? ""
        : process.env.MSG91_REWARD_STATUS_TEMPLATE_ID ?? "";

    dispatched = await dispatchSms({
      to: recipient,
      templateId,
      variables: {
        name: (recipientName ?? "Member").slice(0, 60),
        tier: tierName.slice(0, 60),
        status: (job.to_status ?? "").toString(),
        reward: rewardNumber ?? "",
        tracking: reward?.tracking_reference ?? "",
      },
      idempotencyKey: `reward-notification:${job.id}:${job.attempts}`,
    });
    providerName = "msg91";
    skippedInfraCode = "skipped_no_sms_infra";
  }

  if (dispatched.status === "sent") {
    await finalize(supabase, job.id, {
      status: "sent",
      provider: providerName,
      providerMessageId: dispatched.providerMessageId ?? null,
    });
    return { jobId: job.id, outcome: "sent" };
  }

  if (dispatched.status === skippedInfraCode) {
    await finalize(supabase, job.id, {
      status: "skipped",
      provider: providerName,
      errorCode: dispatched.errorCode ?? null,
      errorMessage: dispatched.errorMessage ?? null,
    });
    return { jobId: job.id, outcome: "skipped_no_infra" };
  }

  await finalize(supabase, job.id, {
    status: "failed",
    provider: providerName,
    errorCode: dispatched.errorCode ?? null,
    errorMessage: dispatched.errorMessage ?? null,
    retryInSeconds: backoffSecondsFor(job.attempts),
  });
  return { jobId: job.id, outcome: "retry_or_dead_letter" };
}

export const Route = createFileRoute(
  "/api/public/hooks/process-reward-notifications",
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
          "claim_due_reward_notification_jobs",
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

        return Response.json({ ok: true, claimed: jobs.length, results });
      },
    },
  },
});
