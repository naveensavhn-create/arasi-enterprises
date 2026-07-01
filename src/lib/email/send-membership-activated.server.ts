// Server-only helper: renders + attempts to send the "membership activated"
// email after a successful advance payment, and records every attempt in
// `membership_email_notifications` for admin visibility.
//
// If email infrastructure isn't wired yet (no sender domain), the attempt is
// recorded with status="skipped_no_email_infra" so nothing crashes the webhook
// and admins can still see what would have gone out. Once the sender domain
// is verified, real sends start recording "sent"/"failed" automatically.

import { render } from "@react-email/render";
import * as React from "react";
import MembershipActivated, {
  type MembershipActivatedProps,
} from "@/lib/email-templates/membership-activated";
import { brand } from "@/lib/email-templates/_shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface SendMembershipActivatedInput {
  membershipId: string;
  /** Optional: pass through the payment id that triggered activation, for logs. */
  triggeringPaymentId?: string | null;
  triggeredBy?: string | null;
  isTest?: boolean;
  /** Optional override, e.g. for a test send from admin UI. */
  recipientEmailOverride?: string | null;
}

export interface SendMembershipActivatedResult {
  logId: string;
  status:
    | "sent"
    | "failed"
    | "skipped_no_email_infra"
    | "skipped_no_recipient"
    | "skipped_membership_not_found";
  messageId?: string;
  error?: string;
  recipientEmail?: string;
}

const SUBJECT = `[${brand.name}] Your membership is active`;
const TEMPLATE_NAME = "membership-activated";

export async function sendMembershipActivatedEmail(
  input: SendMembershipActivatedInput,
): Promise<SendMembershipActivatedResult> {
  // 1. Load membership + plan + customer profile
  const { data: membership, error: mErr } = await supabaseAdmin
    .from("memberships")
    .select(
      "id, membership_number, user_id, plan_id, status, start_date, end_date, advance_paid, total_amount, updated_at",
    )
    .eq("id", input.membershipId)
    .maybeSingle();

  if (mErr || !membership) {
    const logId = await logAttempt({
      membershipId: input.membershipId,
      paymentId: input.triggeringPaymentId ?? null,
      recipientEmail: input.recipientEmailOverride ?? "(unknown)",
      status: "skipped_membership_not_found",
      errorMessage: mErr?.message ?? `Membership ${input.membershipId} not found`,
      isTest: input.isTest ?? false,
      triggeredBy: input.triggeredBy ?? null,
      metadata: null,
    });
    return {
      logId,
      status: "skipped_membership_not_found",
      error: mErr?.message ?? `Membership ${input.membershipId} not found`,
    };
  }

  const [{ data: plan }, { data: profile }, { data: nextDue }] =
    await Promise.all([
      supabaseAdmin
        .from("membership_plans")
        .select("name, monthly_installment, duration_months")
        .eq("id", membership.plan_id)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("full_name, email")
        .eq("id", membership.user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("installments")
        .select("due_date, amount")
        .eq("membership_id", membership.id)
        .in("status", ["pending", "overdue"])
        .order("sequence", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const recipientEmail =
    input.recipientEmailOverride ?? profile?.email ?? null;
  const baseMetadata = {
    membershipNumber: membership.membership_number,
    planName: plan?.name ?? null,
    advancePaid: Number(membership.advance_paid ?? 0),
    monthlyInstallment: Number(plan?.monthly_installment ?? 0),
    totalAmount: Number(membership.total_amount ?? 0),
    triggeringPaymentId: input.triggeringPaymentId ?? null,
  };

  if (!recipientEmail) {
    const logId = await logAttempt({
      membershipId: membership.id,
      paymentId: input.triggeringPaymentId ?? null,
      recipientEmail: "(none)",
      status: "skipped_no_recipient",
      errorMessage: "Customer profile has no email address.",
      isTest: input.isTest ?? false,
      triggeredBy: input.triggeredBy ?? null,
      metadata: baseMetadata,
    });
    return {
      logId,
      status: "skipped_no_recipient",
      error: "Customer profile has no email address.",
    };
  }

  // 2. Insert a pending log row up front so we always have a record.
  const logId = await logAttempt({
    membershipId: membership.id,
    paymentId: input.triggeringPaymentId ?? null,
    recipientEmail,
    status: "pending",
    errorMessage: null,
    isTest: input.isTest ?? false,
    triggeredBy: input.triggeredBy ?? null,
    metadata: baseMetadata,
  });

  try {
    const props: MembershipActivatedProps = {
      recipientName: profile?.full_name ?? undefined,
      membershipNumber: membership.membership_number,
      planName: plan?.name ?? "Membership",
      advancePaid: Number(membership.advance_paid ?? 0),
      monthlyInstallment: Number(plan?.monthly_installment ?? 0),
      durationMonths: Number(plan?.duration_months ?? 0),
      totalAmount: Number(membership.total_amount ?? 0),
      startDate: membership.start_date,
      endDate: membership.end_date,
      activatedAt: membership.updated_at ?? new Date().toISOString(),
      nextDueDate: nextDue?.due_date ?? null,
      nextDueAmount:
        nextDue?.amount != null ? Number(nextDue.amount) : null,
      currency: "INR",
    };

    const html = await render(React.createElement(MembershipActivated, props));
    const dispatched = await dispatchIfConfigured({
      recipientEmail,
      subject: SUBJECT,
      html,
      membershipId: membership.id,
      triggeringPaymentId: input.triggeringPaymentId ?? null,
      isTest: input.isTest ?? false,
    });

    await updateAttempt(logId, {
      status: dispatched.status,
      messageId: dispatched.messageId ?? null,
      errorMessage: dispatched.error ?? null,
    });

    return {
      logId,
      status: dispatched.status,
      recipientEmail,
      messageId: dispatched.messageId,
      error: dispatched.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAttempt(logId, { status: "failed", errorMessage: message });
    return { logId, status: "failed", recipientEmail, error: message };
  }
}

// ---------------- internals ----------------

async function logAttempt(args: {
  membershipId: string | null;
  paymentId: string | null;
  recipientEmail: string;
  status: SendMembershipActivatedResult["status"] | "pending";
  errorMessage: string | null;
  isTest: boolean;
  triggeredBy: string | null;
  metadata: Record<string, unknown> | null;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("membership_email_notifications")
    .insert({
      membership_id: args.membershipId,
      payment_id: args.paymentId,
      recipient_email: args.recipientEmail,
      template_name: TEMPLATE_NAME,
      subject: SUBJECT,
      status: args.status,
      error_message: args.errorMessage,
      is_test: args.isTest,
      triggered_by: args.triggeredBy,
      metadata: args.metadata,
    })
    .select("id")
    .single();
  if (error || !data) return "";
  return data.id;
}

async function updateAttempt(
  logId: string,
  patch: { status: string; messageId?: string | null; errorMessage?: string | null },
) {
  if (!logId) return;
  await supabaseAdmin
    .from("membership_email_notifications")
    .update({
      status: patch.status,
      message_id: patch.messageId ?? null,
      error_message: patch.errorMessage ?? null,
    })
    .eq("id", logId);
}

async function dispatchIfConfigured(args: {
  recipientEmail: string;
  subject: string;
  html: string;
  membershipId: string;
  triggeringPaymentId: string | null;
  isTest: boolean;
}): Promise<{
  status: SendMembershipActivatedResult["status"];
  messageId?: string;
  error?: string;
}> {
  const senderDomain = process.env.SENDER_DOMAIN;
  const lovableApiKey = process.env.LOVABLE_API_KEY;

  if (senderDomain && lovableApiKey) {
    try {
      const res = await fetch(
        `${process.env.SUPABASE_URL ?? ""}`.replace(/\/$/, "") +
          "/functions/v1/lovable-email-send",
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
            template: TEMPLATE_NAME,
            // Tests should NOT collide with real webhook idempotency.
            idempotency_key: args.isTest
              ? `membership-activated-test:${args.membershipId}:${Date.now()}`
              : `membership-activated:${args.membershipId}:${
                  args.triggeringPaymentId ?? "advance"
                }`,
          }),
        },
      );
      if (!res.ok) {
        return {
          status: "failed",
          error: `Email provider returned ${res.status}: ${await res.text()}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        message_id?: string;
        id?: string;
      };
      return { status: "sent", messageId: body.message_id ?? body.id };
    } catch (err) {
      return {
        status: "failed",
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
