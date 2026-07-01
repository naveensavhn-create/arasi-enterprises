import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  recipientName: z.string().trim().max(120).optional(),
  membershipNumber: z.string().trim().max(60).optional().nullable(),
  memberDisplayId: z.string().trim().max(60).optional().nullable(),
  planName: z.string().trim().max(60).optional().nullable(),
  invoiceNumber: z.string().trim().max(60).optional().nullable(),
  installmentSequence: z.number().int().min(1).max(120).optional().nullable(),
  installmentTotal: z.number().int().min(1).max(120).optional().nullable(),
  amountDue: z.number().nonnegative(),
  currency: z.string().trim().length(3).optional(),
  dueDate: z.string().min(1),
  payUrl: z.string().url().optional(),
  dashboardUrl: z.string().url().optional(),
});

/**
 * Renders the "gentle monthly payment reminder" template using the project's
 * current site_settings (brand name/tagline/support email/logo/colors/fonts)
 * so the preview matches what recipients will actually see.
 */
export const renderPaymentReminderEmailPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const { data: settings } = await context.supabase
      .from("site_settings")
      .select(
        "brand_name, tagline, support_email, primary_color, accent_color, heading_font, body_font, logo_url",
      )
      .limit(1)
      .maybeSingle();

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

    const React = await import("react");
    const { render } = await import("@react-email/render");
    const { default: PaymentReminder, template } = await import(
      "@/lib/email-templates/payment-reminder"
    );

    const props = {
      recipientName: data.recipientName ?? "Priya Sharma",
      membershipNumber: data.membershipNumber ?? "ARE-2607-A1B2C3",
      memberDisplayId: data.memberDisplayId ?? undefined,
      planName: data.planName ?? "Gold",
      invoiceNumber: data.invoiceNumber ?? undefined,
      installmentSequence: data.installmentSequence ?? 3,
      installmentTotal: data.installmentTotal ?? 12,
      amountDue: data.amountDue,
      currency: data.currency ?? "INR",
      dueDate: data.dueDate,
      payUrl: data.payUrl,
      dashboardUrl: data.dashboardUrl,
      brand,
    };

    const html = await render(React.createElement(PaymentReminder, props));
    return { html, subject: template.subject, sample: props };
  });
