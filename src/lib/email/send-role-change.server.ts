// Server-only helper: renders + attempts to send a role-change email,
// and records the attempt in `role_email_notifications` for admin visibility.
//
// If email infrastructure isn't wired yet (no sender domain / no
// /lovable/email/transactional/send route), the send is recorded with
// status="skipped_no_email_infra" so the log still shows what would have
// gone out. Once Lovable Emails (or Resend) is configured, replace the
// TODO block with the real dispatch and the log will start recording
// "sent" / "failed".

import { render } from "@react-email/render";
import AdminRolePromoted, {
  type AdminRolePromotedProps,
} from "@/lib/email-templates/admin-role-promoted";
import AdminRoleRevoked, {
  type AdminRoleRevokedProps,
} from "@/lib/email-templates/admin-role-revoked";
import { brand } from "@/lib/email-templates/_shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBrandOverrides } from "@/lib/email/load-brand.server";
import * as React from "react";

export type RoleEmailKind = "promote" | "revoke";

export interface SendRoleChangeInput {
  kind: RoleEmailKind;
  recipientEmail: string;
  recipientName?: string | null;
  actorName: string;
  actorEmail: string;
  previousRole: string;
  newRole: string;
  changedAt: string;
  reason: string;
  dashboardUrl?: string;
  targetUserId?: string | null;
  auditId?: string | null;
  triggeredBy?: string | null;
  isTest?: boolean;
}

export interface SendRoleChangeResult {
  logId: string;
  status: string;
  error?: string;
}

const TEMPLATE_NAME: Record<RoleEmailKind, string> = {
  promote: "admin-role-promoted",
  revoke: "admin-role-revoked",
};

const SUBJECT: Record<RoleEmailKind, string> = {
  promote: `[${brand.name}] Your role has been upgraded`,
  revoke: `[${brand.name}] Your admin access has been revoked`,
};

export async function sendRoleChangeEmail(
  input: SendRoleChangeInput,
): Promise<SendRoleChangeResult> {
  const templateName = TEMPLATE_NAME[input.kind];
  const subject = SUBJECT[input.kind];

  // 1. Insert a pending log row up front so we always have a record.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("role_email_notifications")
    .insert({
      audit_id: input.auditId ?? null,
      target_user_id: input.targetUserId ?? null,
      recipient_email: input.recipientEmail,
      template_name: templateName,
      subject,
      status: "pending",
      is_test: input.isTest ?? false,
      triggered_by: input.triggeredBy ?? null,
      metadata: {
        previousRole: input.previousRole,
        newRole: input.newRole,
        actorEmail: input.actorEmail,
      },
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    // If we can't even log, surface the error but don't crash the caller.
    return {
      logId: "",
      status: "failed",
      error: insertErr?.message ?? "Failed to insert notification log row.",
    };
  }

  const logId = inserted.id;

  try {
    // 2. Render the template so we know it compiles even when infra is absent.
    let html: string;
    const brandOverrides = await loadBrandOverrides();
    if (input.kind === "promote") {
      const props: AdminRolePromotedProps = {
        recipientName: input.recipientName ?? undefined,
        actorName: input.actorName,
        actorEmail: input.actorEmail,
        previousRole: input.previousRole,
        newRole: input.newRole,
        changedAt: input.changedAt,
        reason: input.reason,
        dashboardUrl: input.dashboardUrl,
        brand: brandOverrides,
      };
      html = await render(React.createElement(AdminRolePromoted, props));
    } else {
      const props: AdminRoleRevokedProps = {
        recipientName: input.recipientName ?? undefined,
        actorName: input.actorName,
        actorEmail: input.actorEmail,
        previousRole: input.previousRole,
        newRole: input.newRole,
        changedAt: input.changedAt,
        reason: input.reason,
        brand: brandOverrides,
      };
      html = await render(React.createElement(AdminRoleRevoked, props));
    }

    // 3. Dispatch. Email infra isn't configured yet, so we short-circuit
    //    with a clearly-labeled status. When Lovable Emails / Resend is
    //    wired up, replace this block with the real send + capture the
    //    provider messageId.
    const dispatched = await dispatchIfConfigured({
      templateName,
      recipientEmail: input.recipientEmail,
      subject,
      html,
    });

    await supabaseAdmin
      .from("role_email_notifications")
      .update({
        status: dispatched.status,
        message_id: dispatched.messageId ?? null,
        error_message: dispatched.error ?? null,
      })
      .eq("id", logId);

    return { logId, status: dispatched.status, error: dispatched.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("role_email_notifications")
      .update({ status: "failed", error_message: message })
      .eq("id", logId);
    return { logId, status: "failed", error: message };
  }
}

async function dispatchIfConfigured(args: {
  templateName: string;
  recipientEmail: string;
  subject: string;
  html: string;
}): Promise<{ status: string; messageId?: string; error?: string }> {
  const senderDomain = process.env.SENDER_DOMAIN;
  const lovableApiKey = process.env.LOVABLE_API_KEY;

  // Lovable Emails path — activates automatically once email infra is set up.
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
