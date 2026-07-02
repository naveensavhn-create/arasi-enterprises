import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DEFAULT_REMINDER_CRON_SCHEDULE,
  DEFAULT_REMINDER_CRON_TIMEZONE,
  getSiteSettings,
  type SiteSettings,
} from "@/lib/site-settings.functions";

const DEFAULTS: SiteSettings = {
  brand_name: "ARASI Enterprises",
  tagline: "Advance Booking & Monthly Installment Membership",
  support_email: null,
  support_phone: null,
  primary_color: "220 70% 25%",
  secondary_color: "45 80% 55%",
  accent_color: "45 80% 55%",
  heading_font: "Playfair Display",
  body_font: "Inter",
  logo_url: null,
  favicon_url: null,
  footer_text: "© ARASI Enterprises. All rights reserved.",
  reminder_cron_schedule: DEFAULT_REMINDER_CRON_SCHEDULE,
  reminder_cron_timezone: DEFAULT_REMINDER_CRON_TIMEZONE,
  updated_at: new Date(0).toISOString(),
};


const SiteSettingsContext = createContext<SiteSettings>(DEFAULTS);

export function useSiteSettings(): SiteSettings {
  return useContext(SiteSettingsContext);
}

function applyTheme(s: SiteSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--primary", s.primary_color);
  root.style.setProperty("--secondary", s.secondary_color);
  root.style.setProperty("--accent", s.accent_color);
  root.style.setProperty("--ring", s.primary_color);
  root.style.setProperty("--sidebar-primary", s.primary_color);
  root.style.setProperty("--sidebar-ring", s.primary_color);
  root.style.setProperty("--font-heading", `"${s.heading_font}", serif`);
  root.style.setProperty("--font-body", `"${s.body_font}", sans-serif`);
  document.body.style.fontFamily = `"${s.body_font}", sans-serif`;
}

function ensureFont(family: string) {
  if (typeof document === "undefined" || !family) return;
  const id = `google-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  )}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function ensureFavicon(url: string | null) {
  if (typeof document === "undefined" || !url) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const fn = useServerFn(getSiteSettings);
  const { data } = useQuery({
    queryKey: ["site-settings"],
    queryFn: () => fn(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const settings = useMemo(() => (data ?? DEFAULTS) as SiteSettings, [data]);

  useEffect(() => {
    ensureFont(settings.heading_font);
    ensureFont(settings.body_font);
    applyTheme(settings);
    ensureFavicon(settings.favicon_url);
  }, [settings]);

  return <SiteSettingsContext.Provider value={settings}>{children}</SiteSettingsContext.Provider>;
}
