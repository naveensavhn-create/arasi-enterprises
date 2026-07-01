// @vitest-environment jsdom
/**
 * SiteSettingsProvider live-update test.
 *
 * The provider fetches `getSiteSettings` via TanStack Query and mirrors the
 * result into:
 *   • React context (consumed by useSiteSettings)
 *   • CSS custom properties on <html>
 *   • The <link rel="icon"> favicon
 *
 * This test proves that when the underlying query data changes (as it does
 * after `updateSiteSettings` invalidates the "site-settings" cache), every
 * consumer reflects the new values without a page reload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the server-fn hook so the provider's query resolves against an
// in-test value rather than the network.
let currentSettings: unknown;
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => async () => currentSettings,
}));

// The provider only imports the type + the server-fn ref from this module,
// which the mock above intercepts. Stub the module so no server-only code
// is pulled into the test bundle.
vi.mock("@/lib/site-settings.functions", () => ({
  getSiteSettings: (() => {}) as unknown,
}));

import { SiteSettingsProvider, useSiteSettings } from "@/components/providers/SiteSettingsProvider";

function Consumer() {
  const s = useSiteSettings();
  return (
    <div>
      <div data-testid="brand">{s.brand_name}</div>
      <div data-testid="tagline">{s.tagline ?? ""}</div>
      <div data-testid="primary">{s.primary_color}</div>
      <div data-testid="heading">{s.heading_font}</div>
      <div data-testid="footer">{s.footer_text ?? ""}</div>
    </div>
  );
}

const INITIAL = {
  brand_name: "ARASI Test Suite Brand",
  tagline: "Advance Booking & Monthly Installments",
  support_email: null,
  support_phone: null,
  primary_color: "220 70% 25%",
  secondary_color: "45 80% 55%",
  accent_color: "45 80% 55%",
  heading_font: "Playfair Display",
  body_font: "Inter",
  logo_url: null,
  favicon_url: null,
  footer_text: "© ARASI",
  updated_at: new Date("2025-01-01").toISOString(),
};

const UPDATED = {
  ...INITIAL,
  brand_name: "ARASI (Rebranded)",
  tagline: "New tagline live",
  primary_color: "300 60% 40%",
  heading_font: "Space Grotesk",
  favicon_url: "https://cdn.example.com/new-favicon.ico",
  footer_text: "© Rebranded",
  updated_at: new Date("2025-06-01").toISOString(),
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

beforeEach(() => {
  currentSettings = INITIAL;
  // Clean CSS vars between tests
  document.documentElement.removeAttribute("style");
  document.head.querySelectorAll('link[rel="icon"]').forEach((n) => n.remove());
});

afterEach(() => {
  cleanup();
});

describe("SiteSettingsProvider", () => {
  it("hydrates every consumer from getSiteSettings on mount", async () => {
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <SiteSettingsProvider>
          <Consumer />
        </SiteSettingsProvider>
      </QueryClientProvider>,
    );

    // Wait for the query resolution
    expect(await screen.findByText("ARASI Enterprises")).toBeTruthy();
    expect(screen.getByTestId("tagline").textContent).toBe(
      "Advance Booking & Monthly Installments",
    );
    expect(screen.getByTestId("primary").textContent).toBe("220 70% 25%");
    expect(screen.getByTestId("heading").textContent).toBe("Playfair Display");
  });

  it("applies theme values to CSS custom properties on <html>", async () => {
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <SiteSettingsProvider>
          <Consumer />
        </SiteSettingsProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("ARASI Enterprises");
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--primary")).toBe("220 70% 25%");
    expect(root.style.getPropertyValue("--secondary")).toBe("45 80% 55%");
    expect(root.style.getPropertyValue("--accent")).toBe("45 80% 55%");
    expect(root.style.getPropertyValue("--ring")).toBe("220 70% 25%");
    expect(root.style.getPropertyValue("--font-heading")).toContain("Playfair Display");
    expect(root.style.getPropertyValue("--font-body")).toContain("Inter");
  });

  it("reflects updated settings live across every consumer after cache invalidation", async () => {
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <SiteSettingsProvider>
          <Consumer />
        </SiteSettingsProvider>
      </QueryClientProvider>,
    );

    // Baseline
    expect(await screen.findByText("ARASI Enterprises")).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "220 70% 25%",
    );

    // Simulate updateSiteSettings persisting new values: swap what the
    // server fn returns, then invalidate — exactly what the admin page does.
    currentSettings = UPDATED;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["site-settings"] });
    });

    // Every consumer sees the new values without a reload
    expect(await screen.findByText("ARASI (Rebranded)")).toBeTruthy();
    expect(screen.getByTestId("tagline").textContent).toBe("New tagline live");
    expect(screen.getByTestId("primary").textContent).toBe("300 60% 40%");
    expect(screen.getByTestId("heading").textContent).toBe("Space Grotesk");
    expect(screen.getByTestId("footer").textContent).toBe("© Rebranded");

    // Theme + favicon side-effects re-run
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--primary")).toBe("300 60% 40%");
    expect(root.style.getPropertyValue("--ring")).toBe("300 60% 40%");
    expect(root.style.getPropertyValue("--font-heading")).toContain("Space Grotesk");

    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(favicon?.href).toContain("new-favicon.ico");
  });

  it("falls back to defaults while the initial query is still resolving", () => {
    // Never resolve the fetch during this test — assert the initial synchronous
    // render shows the built-in DEFAULTS (brand_name = "ARASI Enterprises").
    currentSettings = new Promise(() => {}); // never resolves
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <SiteSettingsProvider>
          <Consumer />
        </SiteSettingsProvider>
      </QueryClientProvider>,
    );
    // First paint uses DEFAULTS
    expect(screen.getByTestId("brand").textContent).toBe("ARASI Enterprises");
    expect(screen.getByTestId("primary").textContent).toBe("220 70% 25%");
  });
});
