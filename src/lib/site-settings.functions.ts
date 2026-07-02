import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";

export type SiteSettings = {
  brand_name: string;
  tagline: string | null;
  support_email: string | null;
  support_phone: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  heading_font: string;
  body_font: string;
  logo_url: string | null;
  favicon_url: string | null;
  footer_text: string | null;
  reminder_cron_schedule: string;
  reminder_cron_timezone: string;
  updated_at: string;
};

export const DEFAULT_REMINDER_CRON_SCHEDULE = "* * * * *";
export const DEFAULT_REMINDER_CRON_TIMEZONE = "Asia/Kolkata";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

const COLUMNS =
  "brand_name, tagline, support_email, support_phone, primary_color, secondary_color, accent_color, heading_font, body_font, logo_url, favicon_url, footer_text, reminder_cron_schedule, reminder_cron_timezone, updated_at";


export const getSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteSettings | null> => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase
      .from("site_settings")
      .select(COLUMNS)
      .eq("id", SETTINGS_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as SiteSettings | null;
  },
);

const hslTriplet = /^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/;

const cronExpression = z
  .string()
  .trim()
  .min(1, "Required")
  .max(120)
  .regex(/^[0-9*\-,/\s]+$/, "Only digits, spaces and * , - / are allowed")
  .refine(
    (v) => v.trim().split(/\s+/).length === 5,
    "Must be a 5-field cron expression (min hour dom mon dow)",
  );

// IANA timezone names: Continent/City, plus a few single-segment ones (UTC, GMT).
const ianaTimezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z][A-Za-z0-9+\-]*(?:\/[A-Za-z0-9_+\-]+){0,2}$/,
    "Use an IANA timezone name, e.g. Asia/Kolkata",
  );

const updateSchema = z.object({
  brand_name: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).nullable().optional(),
  support_email: z.string().trim().email().max(255).nullable().or(z.literal("")).optional(),
  support_phone: z.string().trim().max(40).nullable().or(z.literal("")).optional(),
  primary_color: z.string().trim().regex(hslTriplet, "Use HSL triplet e.g. 220 70% 25%"),
  secondary_color: z.string().trim().regex(hslTriplet, "Use HSL triplet e.g. 45 80% 55%"),
  accent_color: z.string().trim().regex(hslTriplet, "Use HSL triplet e.g. 45 80% 55%"),
  heading_font: z.string().trim().min(1).max(80),
  body_font: z.string().trim().min(1).max(80),
  logo_url: z.string().trim().url().max(500).nullable().or(z.literal("")).optional(),
  favicon_url: z.string().trim().url().max(500).nullable().or(z.literal("")).optional(),
  footer_text: z.string().trim().max(500).nullable().optional(),
  reminder_cron_schedule: cronExpression.default(DEFAULT_REMINDER_CRON_SCHEDULE),
  reminder_cron_timezone: ianaTimezone.default(DEFAULT_REMINDER_CRON_TIMEZONE),
});


export const updateSiteSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateSchema.parse(i))
  .handler(async ({ data, context }): Promise<SiteSettings> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required.");

    const payload = {
      ...data,
      support_email: data.support_email || null,
      support_phone: data.support_phone || null,
      logo_url: data.logo_url || null,
      favicon_url: data.favicon_url || null,
      updated_by: context.userId,
    };

    // Snapshot the current row so we can diff changed fields for the audit log.
    const { data: before } = await context.supabase
      .from("site_settings")
      .select(COLUMNS)
      .eq("id", SETTINGS_ID)
      .maybeSingle();

    const { data: row, error } = await context.supabase
      .from("site_settings")
      .update(payload)
      .eq("id", SETTINGS_ID)
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    // Compute a compact list of changed fields for the audit trail. Best-effort
    // — a logging failure must NOT roll back a successful settings update.
    try {
      const beforeRow = (before ?? {}) as Record<string, unknown>;
      const afterRow = row as Record<string, unknown>;
      const changed: string[] = [];
      for (const key of Object.keys(payload)) {
        if (key === "updated_by") continue;
        if (beforeRow[key] !== afterRow[key]) changed.push(key);
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: actorProfile } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", context.userId)
        .maybeSingle();

      await supabaseAdmin.from("admin_audit_log").insert({
        actor_id: context.userId,
        actor_email: actorProfile?.email ?? null,
        target_user_id: null,
        target_email: null,
        action: "site_settings.updated",
        role_before: null,
        role_after: null,
        reason: changed.length
          ? `Updated branding fields: ${changed.join(", ")}`
          : "Saved branding (no field changes detected)",
        metadata: { changed_fields: changed, before: beforeRow, after: afterRow } as never,
      });
    } catch (err) {
      // Swallow — audit logging is best-effort for this global settings row.
      console.warn("site_settings audit log failed", err);
    }

    return row as SiteSettings;
  });

