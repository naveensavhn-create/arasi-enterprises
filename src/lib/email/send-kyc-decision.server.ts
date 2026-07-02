// Server-only helper: renders + sends KYC-decision emails and records every
// attempt in `kyc_email_notifications`, with automatic retry/backoff support.
//
// Two entry points:
//  - enqueueKycDecisionEmail(): create a pending log row and try to dispatch once.
//  - processDueKycEmailJobs(): claim + retry due jobs (used by admin retry button
//    and can be called by a cron/background worker).

import * as React from "react";
import { render } from "@react-email/render";
import KycDecision, {
  type KycDecisionProps,
} from "@/lib/email-templates/kyc-decision";
import { brand } from "@/lib/email-templates/_shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBrandOverrides } from "@/lib/email/load-brand.server";

export type KycDecision = "approved" | "rejected";

export interface EnqueueKycDecisionInput {
  decision: KycDecision;
  recipientEmail: string;
  recipientName?: string | null;
  reviewerName?: string | null;
  reviewerEmail?: string | null;
  reviewedAt: string;
  reviewNotes?: string | null;
  assignedRole?: string | null;
  actionUrl?: string | null;
  targetUserId?: string | null;
  auditId?: string | null;
  triggeredBy?: string | null;
  isTest?: boolean;
}

export interface KycEmailAttemptResult {
  jobId: string;
  status: string;
  error?: string;
}

const SUBJECT: Record<KycDecision, string> = {
  approved: `[${brand.name}] Your KYC has been approved`,
  rejected: `[${brand.name}] Action required on your KYC submission`,
};

export async function enqueueKycDecisionEmail(
  input: EnqueueKycDecisionInput,
): Promise<KycEmailAttemptResult> {
  const subject = SUBJECT[input.decision];

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("kyc_email_notifications")
    .insert({
      audit_id: input.auditId ?? null,
      target_user_id: input.targetUserId ?? null,
      recipient_email: input.recipientEmail,
      decision: input.decision,
      template_name: "kyc-decision",
      subject,
      status: "pending",
      is_test: input.isTest ?? false,
      triggered_by: input.triggeredBy ?? null,
      reviewer_name: input.reviewerName ?? null,
      reviewer_email: input.reviewerEmail ?? null,
      review_notes: input.reviewNotes ?? null,
      assigned_role: input.assignedRole ?? null,
      metadata: {
        recipientName: input.recipientName ?? null,
        actionUrl: input.actionUrl ?? null,
        reviewedAt: input.reviewedAt,
      },
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      jobId: "",
      status: "failed",
      error: insertErr?.message ?? "Failed to insert KYC email log row.",
    };
  }

  return await attemptSend(inserted.id);
}

// Claim due jobs and try to send each one. Safe to call from admin actions
// or a background scheduler.
export async function processDueKycEmailJobs(limit = 25): Promise<{
  claimed: number;
  results: KycEmailAttemptResult[];
}> {
  const { data: claimed, error } = await supabaseAdmin.rpc(
    "claim_due_kyc_email_jobs" as never,
    { _limit: limit } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (claimed ?? []) as Array<{ id: string }>;
  const results: KycEmailAttemptResult[] = [];
  for (const r of rows) {
    // Job was just marked 'sending' by the claim RPC — perform render + dispatch + finalize.
    // eslint-disable-next-line no-await-in-loop
    results.push(await finalizeClaimedJob(r.id));
  }
  return { claimed: rows.length, results };
}

// Force a retry of a specific job right now (admin action). Uses the claim RPC
// via a targeted requeue + processing pass.
export async function retryKycEmailJob(jobId: string): Promise<KycEmailAttemptResult> {
  const { error } = await supabaseAdmin.rpc("requeue_kyc_email_job" as never, {
    _job_id: jobId,
  } as never);
  if (error) throw new Error(error.message);
  // Claim just this one job (loop guard) then finalize it.
  const { data: claimed } = await supabaseAdmin.rpc(
    "claim_due_kyc_email_jobs" as never,
    { _limit: 5 } as never,
  );
  const target = ((claimed ?? []) as Array<{ id: string }>).find((r) => r.id === jobId);
  if (!target) {
    // Something else claimed it or backoff moved it; return current state.
    const { data: row } = await supabaseAdmin
      .from("kyc_email_notifications")
      .select("id,status,error_message")
      .eq("id", jobId)
      .single();
    return {
      jobId,
      status: (row?.status as string) ?? "unknown",
      error: (row?.error_message as string) ?? undefined,
    };
  }
  return finalizeClaimedJob(jobId);
}

// ---------------- internal ----------------

async function attemptSend(jobId: string): Promise<KycEmailAttemptResult> {
  // Move to 'sending' + bump attempts via the claim path. We bypass the queue
  // ordering by writing the transition inline for a just-inserted row.
  const { data: row, error } = await supabaseAdmin
    .from("kyc_email_notifications")
    .update({
      status: "sending",
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (error || !row) {
    return { jobId, status: "failed", error: error?.message ?? "Job not claimable" };
  }

  return finalizeClaimedJob(jobId);
}

async function finalizeClaimedJob(jobId: string): Promise<KycEmailAttemptResult> {
  const { data: row, error } = await supabaseAdmin
    .from("kyc_email_notifications")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !row) {
    return { jobId, status: "failed", error: error?.message ?? "Job not found" };
  }
  const job = row as {
    id: string;
    decision: KycDecision;
    recipient_email: string;
    subject: string | null;
    reviewer_name: string | null;
    reviewer_email: string | null;
    review_notes: string | null;
    assigned_role: string | null;
    metadata: Record<string, unknown> | null;
  };

  try {
    const props: KycDecisionProps = {
      decision: job.decision,
      recipientName:
        (job.metadata?.recipientName as string | undefined) ?? undefined,
      reviewerName: job.reviewer_name ?? undefined,
      reviewerEmail: job.reviewer_email ?? undefined,
      reviewedAt:
        (job.metadata?.reviewedAt as string | undefined) ??
        new Date().toISOString(),
      reviewNotes: job.review_notes ?? undefined,
      assignedRole: job.assigned_role ?? undefined,
      actionUrl: (job.metadata?.actionUrl as string | undefined) ?? undefined,
    };
    const html = await render(React.createElement(KycDecision, props));
    const dispatched = await dispatchIfConfigured({
      recipientEmail: job.recipient_email,
      subject: job.subject ?? SUBJECT[job.decision],
      html,
    });

    const finalStatus =
      dispatched.status === "sent"
        ? "sent"
        : dispatched.status === "skipped_no_email_infra"
          ? "skipped"
          : "failed";

    const { data: finalized, error: finErr } = await supabaseAdmin.rpc(
      "finalize_kyc_email_job" as never,
      {
        _job_id: jobId,
        _status: finalStatus,
        _provider: dispatched.provider ?? null,
        _message_id: dispatched.messageId ?? null,
        _error_code: dispatched.errorCode ?? null,
        _error_message: dispatched.error ?? null,
        _retry_in_seconds: null,
        _metadata: {},
      } as never,
    );
    if (finErr) throw new Error(finErr.message);
    const out = finalized as unknown as { status: string; error_message: string | null } | null;
    return {
      jobId,
      status: out?.status ?? finalStatus,
      error: out?.error_message ?? dispatched.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin.rpc("finalize_kyc_email_job" as never, {
      _job_id: jobId,
      _status: "failed",
      _provider: null,
      _message_id: null,
      _error_code: "render_or_dispatch_error",
      _error_message: message,
      _retry_in_seconds: null,
      _metadata: {},
    } as never);
    return { jobId, status: "failed", error: message };
  }
}

async function dispatchIfConfigured(args: {
  recipientEmail: string;
  subject: string;
  html: string;
}): Promise<{
  status: "sent" | "failed" | "skipped_no_email_infra";
  provider?: string;
  messageId?: string;
  error?: string;
  errorCode?: string;
}> {
  const senderDomain = process.env.SENDER_DOMAIN;
  const lovableApiKey = process.env.LOVABLE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (senderDomain && lovableApiKey && supabaseUrl) {
    try {
      const res = await fetch(
        supabaseUrl.replace(/\/$/, "") + "/functions/v1/lovable-email-send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableApiKey}`,
          },
          body: JSON.stringify({
            to: args.recipientEmail,
            from: `notify@${senderDomain}`,
            subject: args.subject,
            html: args.html,
            template: "kyc-decision",
          }),
        },
      );
      if (!res.ok) {
        return {
          status: "failed",
          provider: "lovable-emails",
          errorCode: `http_${res.status}`,
          error: `Email provider returned ${res.status}: ${await res.text()}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        message_id?: string;
        id?: string;
      };
      return {
        status: "sent",
        provider: "lovable-emails",
        messageId: body.message_id ?? body.id,
      };
    } catch (err) {
      return {
        status: "failed",
        provider: "lovable-emails",
        errorCode: "network_error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return {
    status: "skipped_no_email_infra",
    error:
      "Sender domain not configured. Set up an email domain in Cloud → Emails to activate sending.",
  };
}
