// Server-only helper that loads the current Site Settings brand row and maps
// it to the shape every email template expects. Kept in one place so every
// sender (role change, KYC decision, membership activation, reward
// notifications, payment reminders, …) surfaces the same configured logo URL,
// brand name, tagline and colour palette without duplicating the query.
//
// Falls back silently to `undefined` when Site Settings hasn't been seeded
// yet, letting the template's `resolveBrand()` helper apply the built-in
// defaults. Never throws — email sending must not fail because of a missing
// branding row.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BrandOverrides } from "@/lib/email-templates/_shared";

let cached: { at: number; brand: BrandOverrides | undefined } | null = null;
const TTL_MS = 60_000; // 1 minute — fast enough to reflect a logo swap.

export async function loadBrandOverrides(): Promise<BrandOverrides | undefined> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.brand;

  try {
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select(
        "brand_name, tagline, support_email, primary_color, accent_color, heading_font, body_font, logo_url",
      )
      .limit(1)
      .maybeSingle();

    const brand: BrandOverrides | undefined = data
      ? {
          name: data.brand_name,
          tagline: data.tagline,
          supportEmail: data.support_email,
          logoUrl: data.logo_url,
          primaryColor: data.primary_color,
          accentColor: data.accent_color,
          headingFont: data.heading_font,
          bodyFont: data.body_font,
        }
      : undefined;

    cached = { at: now, brand };
    return brand;
  } catch {
    // Never let branding lookup break outbound notifications.
    return undefined;
  }
}

/** Test-only helper — clears the cache between assertions. */
export function __resetBrandOverridesCache() {
  cached = null;
}

/**
 * Best-effort accessor for the logo URL alone. Used by SMS senders where the
 * only brand touchpoint is the short link they can splice into a DLT
 * template variable.
 */
export async function loadBrandLogoUrl(): Promise<string | null> {
  const b = await loadBrandOverrides();
  const v = b?.logoUrl;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
