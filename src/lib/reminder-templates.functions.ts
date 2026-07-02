/**
 * Admin-only server functions for managing the editable reminder-template
 * catalog and dispatching a single test message to a specific recipient.
 *
 * Storage lives in public.reminder_templates. RLS admits only admins, and
 * every server fn in this file re-checks the admin role in-handler.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Sb = SupabaseClient<Database>;
type ChannelE = Database["public"]["Enums"]["reminder_channel"];

export interface ReminderTemplate {
  id: string;
  channel: ChannelE;
  reminder_kind: "upcoming" | "overdue";
  subject: string | null;
  heading: string | null;
  intro: string | null;
  outro: string | null;
  sms_greeting: string | null;
  sms_signature: string | null;
  is_active: boolean;
  version: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

async function assertAdmin(context: { supabase: Sb; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required.");
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

export const listReminderTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReminderTemplate[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("reminder_templates")
      .select("*")
      .order("channel", { ascending: true })
      .order("reminder_kind", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ReminderTemplate[];
  });

// ---------------------------------------------------------------------------
// UPSERT
// ---------------------------------------------------------------------------

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  channel: z.enum(["email", "sms"]),
  reminder_kind: z.enum(["upcoming", "overdue"]),
  subject: z.string().trim().max(200).nullable().optional(),
  heading: z.string().trim().max(200).nullable().optional(),
  intro: z.string().trim().max(2000).nullable().optional(),
  outro: z.string().trim().max(2000).nullable().optional(),
  sms_greeting: z.string().trim().max(60).nullable().optional(),
  sms_signature: z.string().trim().max(60).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const upsertReminderTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReminderTemplate> => {
    await assertAdmin(context);

    // Only email needs subject/heading/intro/outro; sms only needs greeting/signature.
    const payload = {
      channel: data.channel,
      reminder_kind: data.reminder_kind,
      subject: data.channel === "email" ? (data.subject ?? null) : null,
      heading: data.channel === "email" ? (data.heading ?? null) : null,
      intro: data.channel === "email" ? (data.intro ?? null) : null,
      outro: data.channel === "email" ? (data.outro ?? null) : null,
      sms_greeting: data.channel === "sms" ? (data.sms_greeting ?? null) : null,
      sms_signature: data.channel === "sms" ? (data.sms_signature ?? null) : null,
      is_active: data.is_active ?? true,
      updated_by: context.userId,
    };

    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("reminder_templates")
        .update({ ...payload })
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row as ReminderTemplate;
    }

    // Insert: enforce single active row per (channel, kind) by first
    // deactivating any existing active row for that combo.
    if (payload.is_active) {
      await context.supabase
        .from("reminder_templates")
        .update({ is_active: false })
        .eq("channel", payload.channel)
        .eq("reminder_kind", payload.reminder_kind)
        .eq("is_active", true);
    }

    const { data: row, error } = await context.supabase
      .from("reminder_templates")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as ReminderTemplate;
  });

// ---------------------------------------------------------------------------
// RENDER (preview for admin editor)
// ---------------------------------------------------------------------------

/**
 * Substitutes {{var}} placeholders using the sample values shown below the
 * editor. Unknown variables are left as-is so mistakes stay visible.
 */
export function interpolate(
  template: string | null | undefined,
  vars: Record<string, string>,
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-z0-9_.-]+)\s*\}\}/gi, (m, k) => {
    const key = String(k);
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m;
  });
}

// ---------------------------------------------------------------------------
// TEST-SEND
// ---------------------------------------------------------------------------

const testSendSchema = z
  .object({
    channel: z.enum(["email", "sms"]),
    reminder_kind: z.enum(["upcoming", "overdue"]),
    /** Ad-hoc template overrides so admins can test unsaved edits. */
    subject: z.string().trim().max(200).optional(),
    heading: z.string().trim().max(200).optional(),
    intro: z.string().trim().max(2000).optional(),
    outro: z.string().trim().max(2000).optional(),
    sms_greeting: z.string().trim().max(60).optional(),
    sms_signature: z.string().trim().max(60).optional(),
    /** Sample values used to fill {{variables}} and DLT slots. */
    recipient_name: z.string().trim().max(120).default("Priya Sharma"),
    plan_name: z.string().trim().max(60).default("Gold"),
    amount: z.number().nonnegative().default(5000),
    due_date: z.string().min(1).default(
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ),
    membership: z.string().trim().max(60).default("ARE-2607-A1B2C3"),
    /** Where to send the test. */
    to_email: z.string().trim().email().optional(),
    to_phone: z.string().trim().min(10).max(20).optional(),
  })
  .refine(
    (v) =>
      (v.channel === "email" && !!v.to_email) ||
      (v.channel === "sms" && !!v.to_phone),
    { message: "Provide to_email for an email test or to_phone for SMS." },
  );

export interface TestSendResult {
  ok: boolean;
  channel: "email" | "sms";
  provider: string | null;
  provider_message_id: string | null;
  subject?: string;
  preview_html?: string;
  message?: string;
  error_code?: string;
  error_message?: string;
}

export const sendReminderTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => testSendSchema.parse(input))
  .handler(async ({ data, context }): Promise<TestSendResult> => {
    await assertAdmin(context);

    // Load site branding + admin profile so preview matches production.
    const [{ data: settings }, { data: me }] = await Promise.all([
      context.supabase
        .from("site_settings")
        .select(
          "brand_name, tagline, support_email, primary_color, accent_color, heading_font, body_font, logo_url",
        )
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);

    const brand = settings
      ? {
          name: settings.brand_name ?? undefined,
          tagline: settings.tagline ?? undefined,
          supportEmail: settings.support_email ?? undefined,
          logoUrl: settings.logo_url ?? undefined,
          primaryColor: settings.primary_color ?? undefined,
          accentColor: settings.accent_color ?? undefined,
          headingFont: settings.heading_font ?? undefined,
          bodyFont: settings.body_font ?? undefined,
        }
      : undefined;

    const amountFormatted = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(data.amount);
    const dueFormatted = (() => {
      try {
        return new Date(data.due_date).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      } catch {
        return data.due_date;
      }
    })();
    const vars: Record<string, string> = {
      name: data.recipient_name,
      plan_name: data.plan_name,
      amount: amountFormatted,
      due_date: dueFormatted,
      membership: data.membership,
      support_email: brand?.supportEmail ?? "support@arasienterprises.com",
    };

    // -----------------------------------------------------------------------
    // EMAIL — render component with overrides and POST to lovable-email-send.
    // -----------------------------------------------------------------------
    if (data.channel === "email") {
      const React = await import("react");
      const { render } = await import("@react-email/render");
      const { default: PaymentReminder, template: emailTpl } = await import(
        "@/lib/email-templates/payment-reminder"
      );

      const props = {
        recipientName: data.recipient_name,
        membershipNumber: data.membership,
        memberDisplayId: undefined,
        planName: data.plan_name,
        installmentSequence: 3,
        installmentTotal: 12,
        amountDue: data.amount,
        currency: "INR",
        dueDate: data.due_date,
        headingOverride: data.heading ? interpolate(data.heading, vars) : null,
        introOverride: data.intro ? interpolate(data.intro, vars) : null,
        outroOverride: data.outro ? interpolate(data.outro, vars) : null,
        brand,
      };
      const html = await render(React.createElement(PaymentReminder, props));
      const subject = interpolate(
        data.subject ?? emailTpl.subject,
        vars,
      );

      const senderDomain = process.env.SENDER_DOMAIN;
      const lovableApiKey = process.env.LOVABLE_API_KEY;
      if (!senderDomain || !lovableApiKey) {
        return {
          ok: false,
          channel: "email",
          provider: null,
          provider_message_id: null,
          subject,
          preview_html: html,
          error_code: "no_email_infra",
          error_message:
            "Email sender not configured. Set up your email domain in Cloud → Emails, then retry the test.",
        };
      }
      const url =
        `${process.env.SUPABASE_URL ?? ""}`.replace(/\/$/, "") +
        "/functions/v1/lovable-email-send";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableApiKey}`,
          },
          body: JSON.stringify({
            to: data.to_email,
            from: `notify@${senderDomain}`,
            subject,
            html,
            template: "payment-reminder-test",
            idempotency_key: `reminder-test:${context.userId}:${Date.now()}`,
          }),
        });
        if (!res.ok) {
          return {
            ok: false,
            channel: "email",
            provider: "lovable-emails",
            provider_message_id: null,
            subject,
            preview_html: html,
            error_code: `http_${res.status}`,
            error_message: `Email provider returned ${res.status}: ${await res.text()}`,
          };
        }
        const body = (await res.json().catch(() => ({}))) as {
          message_id?: string;
          id?: string;
        };
        return {
          ok: true,
          channel: "email",
          provider: "lovable-emails",
          provider_message_id: body.message_id ?? body.id ?? null,
          subject,
          preview_html: html,
          message: `Test email sent to ${data.to_email}.`,
        };
      } catch (err) {
        return {
          ok: false,
          channel: "email",
          provider: "lovable-emails",
          provider_message_id: null,
          subject,
          preview_html: html,
          error_code: "network_error",
          error_message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // -----------------------------------------------------------------------
    // SMS — MSG91 flow. The message body is fixed by the DLT-approved
    // template; we only forward the variable slots.
    // -----------------------------------------------------------------------
    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_REMINDER_TEMPLATE_ID;
    const senderId = process.env.MSG91_SENDER_ID;
    if (!authKey || !templateId || !senderId) {
      return {
        ok: false,
        channel: "sms",
        provider: null,
        provider_message_id: null,
        error_code: "no_sms_infra",
        error_message:
          "SMS provider not configured. Set MSG91_AUTH_KEY, MSG91_SENDER_ID and MSG91_REMINDER_TEMPLATE_ID, then retry.",
      };
    }
    const mobile = (data.to_phone ?? "").replace(/[^\d]/g, "");
    if (!mobile || mobile.length < 10) {
      return {
        ok: false,
        channel: "sms",
        provider: "msg91",
        provider_message_id: null,
        error_code: "invalid_recipient",
        error_message: `Recipient phone "${data.to_phone}" is not a valid number.`,
      };
    }
    const greeting = (data.sms_greeting ?? "Dear").trim() || "Dear";
    const nameSlot = `${greeting} ${data.recipient_name}`.slice(0, 60);
    try {
      const res = await fetch("https://control.msg91.com/api/v5/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json", authkey: authKey },
        body: JSON.stringify({
          template_id: templateId,
          sender: senderId,
          short_url: "0",
          recipients: [
            {
              mobiles: mobile,
              name: nameSlot,
              amount: amountFormatted,
              due: dueFormatted,
              membership: data.membership,
            },
          ],
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          channel: "sms",
          provider: "msg91",
          provider_message_id: null,
          error_code: `http_${res.status}`,
          error_message: `MSG91 returned ${res.status}: ${text.slice(0, 500)}`,
        };
      }
      const parsed = (() => {
        try {
          return JSON.parse(text) as { type?: string; message?: string; request_id?: string };
        } catch {
          return {} as Record<string, string>;
        }
      })();
      if (parsed.type && parsed.type !== "success") {
        return {
          ok: false,
          channel: "sms",
          provider: "msg91",
          provider_message_id: null,
          error_code: "provider_error",
          error_message: parsed.message ?? text.slice(0, 500),
        };
      }
      return {
        ok: true,
        channel: "sms",
        provider: "msg91",
        provider_message_id: parsed.request_id ?? null,
        message: `Test SMS dispatched to ${data.to_phone}.`,
      };
    } catch (err) {
      return {
        ok: false,
        channel: "sms",
        provider: "msg91",
        provider_message_id: null,
        error_code: "network_error",
        error_message: err instanceof Error ? err.message : String(err),
      };
    }
  });
