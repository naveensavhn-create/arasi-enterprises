// Shared brand tokens for Arasi Enterprises transactional email templates.
// Kept as plain constants so React Email inlines them into the final HTML
// (no external CSS, no <style> tags).
//
// Every template must render the header via `<BrandHeader />` after resolving
// overrides through `resolveBrand()` so the Site Settings logo URL, brand
// name, and colours are applied consistently across email + PDF surfaces.

import * as React from "react";
import { Img, Section, Text } from "@react-email/components";

export const brand = {
  name: "Arasi Enterprises",
  tagline: "Advance Booking & Monthly Installment Membership",
  supportEmail: "support@arasienterprises.com",
} as const;

export const colors = {
  bodyBg: "#ffffff", // React Email Body must remain white per Lovable rules
  surface: "#0b1220", // deep navy card
  surfaceAlt: "#111a2e",
  border: "#1e293b",
  text: "#e5e7eb",
  textMuted: "#94a3b8",
  gold: "#d4af37",
  goldSoft: "#f5d97a",
  success: "#22c55e",
  danger: "#ef4444",
} as const;

export const styles = {
  main: {
    backgroundColor: colors.bodyBg,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
    margin: 0,
    padding: "24px 0",
  } as const,
  container: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: "0 16px",
  } as const,
  card: {
    backgroundColor: colors.surface,
    borderRadius: "14px",
    border: `1px solid ${colors.border}`,
    padding: "32px",
    color: colors.text,
  } as const,
  header: {
    borderBottom: `1px solid ${colors.border}`,
    paddingBottom: "20px",
    marginBottom: "24px",
  } as const,
  brandName: {
    color: colors.gold,
    fontSize: "20px",
    fontWeight: 700,
    letterSpacing: "0.5px",
    margin: 0,
  } as const,
  tagline: {
    color: colors.textMuted,
    fontSize: "12px",
    margin: "4px 0 0",
  } as const,
  h1: {
    color: colors.text,
    fontSize: "22px",
    fontWeight: 600,
    margin: "0 0 12px",
    lineHeight: 1.3,
  } as const,
  p: {
    color: colors.text,
    fontSize: "15px",
    lineHeight: 1.6,
    margin: "0 0 14px",
  } as const,
  muted: {
    color: colors.textMuted,
    fontSize: "13px",
    lineHeight: 1.6,
    margin: "0 0 8px",
  } as const,
  detailBox: {
    backgroundColor: colors.surfaceAlt,
    border: `1px solid ${colors.border}`,
    borderRadius: "10px",
    padding: "16px 18px",
    margin: "16px 0",
  } as const,
  detailLabel: {
    color: colors.textMuted,
    fontSize: "11px",
    letterSpacing: "0.6px",
    textTransform: "uppercase" as const,
    margin: "0 0 4px",
    fontWeight: 600,
  } as const,
  detailValue: {
    color: colors.text,
    fontSize: "14px",
    margin: "0 0 12px",
    wordBreak: "break-word" as const,
  } as const,
  reasonBox: {
    backgroundColor: "rgba(212, 175, 55, 0.08)",
    borderLeft: `3px solid ${colors.gold}`,
    borderRadius: "6px",
    padding: "12px 14px",
    margin: "8px 0 0",
    color: colors.text,
    fontSize: "14px",
    lineHeight: 1.55,
    fontStyle: "italic" as const,
  } as const,
  button: {
    display: "inline-block",
    backgroundColor: colors.gold,
    color: "#0b1220",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
    marginTop: "8px",
  } as const,
  footer: {
    color: colors.textMuted,
    fontSize: "12px",
    textAlign: "center" as const,
    margin: "20px 0 0",
    lineHeight: 1.6,
  } as const,
  divider: {
    borderColor: colors.border,
    borderStyle: "solid",
    borderWidth: "0 0 1px",
    margin: "20px 0",
  } as const,
};

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }) + " IST";
  } catch {
    return iso;
  }
}

// ============================================================================
// Brand override resolution — shared by every transactional template so the
// Site Settings logo URL + colours flow through identically.
// ============================================================================

export interface BrandOverrides {
  name?: string | null;
  tagline?: string | null;
  supportEmail?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
}

export interface ResolvedBrand {
  name: string;
  tagline: string;
  supportEmail: string;
  logoUrl: string | null;
  primary: string;
  accent: string;
  headingFont?: string;
  bodyFont?: string;
}

const nonEmpty = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
};

const safeHex = (v: unknown, fallback: string): string => {
  const t = nonEmpty(v);
  return t && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t) ? t : fallback;
};

const safeUrl = (v: unknown): string | null => {
  const t = nonEmpty(v);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

const safeFont = (v: unknown): string | undefined => {
  const t = nonEmpty(v);
  // Allow letters, digits, spaces, dashes and single quotes only — keeps
  // inline CSS injection out and rejects gibberish tokens.
  return t && /^[A-Za-z0-9 '\-]{1,64}$/.test(t) ? t : undefined;
};

/**
 * Merge admin-configured Site Settings values with the built-in defaults,
 * defensively sanitising every field so a partially-configured
 * `site_settings` row can never break an outbound email.
 */
export function resolveBrand(overrides?: BrandOverrides | null): ResolvedBrand {
  return {
    name: nonEmpty(overrides?.name) ?? brand.name,
    tagline: nonEmpty(overrides?.tagline) ?? brand.tagline,
    supportEmail: nonEmpty(overrides?.supportEmail) ?? brand.supportEmail,
    logoUrl: safeUrl(overrides?.logoUrl),
    primary: safeHex(overrides?.primaryColor, colors.gold),
    accent: safeHex(overrides?.accentColor, colors.goldSoft),
    headingFont: safeFont(overrides?.headingFont),
    bodyFont: safeFont(overrides?.bodyFont),
  };
}

/**
 * Standard email header used by every template. Renders the configured Site
 * Settings logo (when available) above the brand name + tagline so recipients
 * see the same identity regardless of which notification they received.
 */
export const BrandHeader: React.FC<{ b: ResolvedBrand }> = ({ b }) => (
  <Section style={styles.header}>
    {b.logoUrl ? (
      <Img
        src={b.logoUrl}
        alt={b.name}
        height="36"
        style={{ display: "block", marginBottom: "8px" }}
      />
    ) : null}
    <Text style={{ ...styles.brandName, color: b.primary }}>{b.name}</Text>
    <Text style={styles.tagline}>{b.tagline}</Text>
  </Section>
);
