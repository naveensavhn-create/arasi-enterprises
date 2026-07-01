import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MembershipEmailNotification {
  id: string;
  membership_id: string | null;
  payment_id: string | null;
  recipient_email: string;
  template_name: string;
  subject: string | null;
  status: string;
  message_id: string | null;
  error_message: string | null;
  is_test: boolean;
  triggered_by: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  membership_number: string | null;
}

/**
 * Lists the 200 most recent membership-activated email attempts (admin only).
 */
export const listMembershipEmailNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MembershipEmailNotification[]> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { data, error } = await context.supabase
      .from("membership_email_notifications")
      .select(
        "id, membership_id, payment_id, recipient_email, template_name, subject, status, message_id, error_message, is_test, triggered_by, metadata, created_at, updated_at, memberships(membership_number)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return (data ?? []).map((r) => {
      const membership = (r as { memberships?: { membership_number?: string | null } | null }).memberships ?? null;
      return {
        id: r.id,
        membership_id: r.membership_id,
        payment_id: r.payment_id,
        recipient_email: r.recipient_email,
        template_name: r.template_name,
        subject: r.subject,
        status: r.status,
        message_id: r.message_id,
        error_message: r.error_message,
        is_test: r.is_test,
        triggered_by: r.triggered_by,
        metadata: r.metadata == null ? null : JSON.stringify(r.metadata),
        created_at: r.created_at,
        updated_at: r.updated_at,
        membership_number: membership?.membership_number ?? null,
      } satisfies MembershipEmailNotification;
    });
  });

const testInputSchema = z.object({
  membershipId: z.string().uuid(),
  recipientEmail: z.string().trim().toLowerCase().email().max(255).optional(),
});

/**
 * Sends a test membership-activated email for an existing membership to validate
 * rendering + delivery. Recorded with is_test=true so it doesn't get confused
 * with the real webhook-triggered send.
 */
export const sendMembershipActivatedTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { sendMembershipActivatedEmail } = await import(
      "@/lib/email/send-membership-activated.server"
    );
    return sendMembershipActivatedEmail({
      membershipId: data.membershipId,
      triggeringPaymentId: null,
      triggeredBy: context.userId,
      isTest: true,
      recipientEmailOverride: data.recipientEmail ?? null,
    });
  });

/**
 * Recent memberships an admin can pick from to trigger a test send.
 */
export const listMembershipsForTest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { data, error } = await context.supabase
      .from("memberships")
      .select("id, membership_number, status, profiles:user_id(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const p = (r as { profiles?: { full_name?: string | null; email?: string | null } | null }).profiles ?? null;
      return {
        id: r.id,
        membership_number: r.membership_number,
        status: r.status,
        customer_name: p?.full_name ?? null,
        customer_email: p?.email ?? null,
      };
    });
  });
