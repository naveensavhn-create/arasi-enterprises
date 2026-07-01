// Server-only helper: renders and attempts to send the "membership activated"
// email after a successful advance payment. Mirrors send-role-change.server.ts:
// if email infrastructure isn't wired yet (no sender domain), we short-circuit
// with status="skipped_no_email_infra" so nothing crashes the webhook.
//
// Callers must be server-only (webhook handler / server fn). Do NOT import
// from client-reachable module scope.

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
}

export interface SendMembershipActivatedResult {
  status: "sent" | "failed" | "skipped_no_email_infra" | "skipped_no_recipient";
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
    return {
      status: "failed",
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

  const recipientEmail = profile?.email ?? null;
  if (!recipientEmail) {
    return { status: "skipped_no_recipient" };
  }

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
  return dispatchIfConfigured({
    templateName: TEMPLATE_NAME,
    recipientEmail,
    subject: SUBJECT,
    html,
    membershipId: membership.id,
    triggeringPaymentId: input.triggeringPaymentId ?? null,
  });
}

async function dispatchIfConfigured(args: {
  templateName: string;
  recipientEmail: string;
  subject: string;
  html: string;
  membershipId: string;
  triggeringPaymentId: string | null;
}): Promise<SendMembershipActivatedResult> {
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
            template: args.templateName,
            // Idempotency: never resend the activation email for the same
            // membership + payment combination.
            idempotency_key: `membership-activated:${args.membershipId}:${
              args.triggeringPaymentId ?? "advance"
            }`,
          }),
        },
      );
      if (!res.ok) {
        return {
          status: "failed",
          recipientEmail: args.recipientEmail,
          error: `Email provider returned ${res.status}: ${await res.text()}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        message_id?: string;
        id?: string;
      };
      return {
        status: "sent",
        recipientEmail: args.recipientEmail,
        messageId: body.message_id ?? body.id,
      };
    } catch (err) {
      return {
        status: "failed",
        recipientEmail: args.recipientEmail,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    status: "skipped_no_email_infra",
    recipientEmail: args.recipientEmail,
    error:
      "Sender domain not configured. Set up an email domain in Cloud → Emails to activate sending.",
  };
}
