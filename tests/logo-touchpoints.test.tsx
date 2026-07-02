// @vitest-environment jsdom
/**
 * Logo-touchpoints coverage tests.
 *
 * The company logo appears in five distinct surfaces of the app:
 *   1. Web UI screens (marketing index, auth, reset-password, sidebar)
 *      — all render <Logo /> from src/components/brand/Logo.tsx.
 *   2. Favicon              — /favicon.png wired into __root.tsx head links.
 *   3. Receipts / invoices  — <ReceiptView> renders <Logo src={settings.logo_url}>
 *      so a Site-Settings override wins over the bundled default.
 *   4. Email templates      — every template renders <BrandHeader />, which in
 *      turn emits an <Img src={brand.logoUrl}> when the resolved brand exposes
 *      a valid URL.
 *   5. Bundled asset        — src/assets/arasi-logo.png.asset.json must be
 *      present and resolvable at import time so the build never ships with a
 *      missing/broken logo asset.
 *
 * These tests guarantee that every touchpoint continues to reference the
 * shared Logo source (either the bundled asset pointer or the shared
 * BrandHeader component) and that all imports resolve — the file itself
 * failing to compile is the primary "missing asset" signal we care about.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => cleanup());

import { Logo, ARASI_LOGO_URL } from "@/components/brand/Logo";
import logoAsset from "@/assets/arasi-logo.png.asset.json";
import {
  BrandHeader,
  resolveBrand,
  brand as brandDefaults,
} from "@/lib/email-templates/_shared";
import RewardUnlocked from "@/lib/email-templates/reward-unlocked";
import MembershipActivated from "@/lib/email-templates/membership-activated";
import KycDecision from "@/lib/email-templates/kyc-decision";
import AdminRolePromoted from "@/lib/email-templates/admin-role-promoted";
import AdminRoleRevoked from "@/lib/email-templates/admin-role-revoked";
import RewardClaimStatus from "@/lib/email-templates/reward-claim-status";
import PaymentReminder from "@/lib/email-templates/payment-reminder";

const REPO_ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string) =>
  readFileSync(path.join(REPO_ROOT, rel), "utf8");

// ────────────────────────────────────────────────────────────────
// 1. Bundled asset pointer — the "new Logo source" everything else
//    ultimately hangs off of.
// ────────────────────────────────────────────────────────────────
describe("bundled logo asset pointer", () => {
  it("is a valid Lovable Assets pointer resolving through the CDN", () => {
    expect(logoAsset).toMatchObject({
      version: 1,
      original_filename: "arasi-logo.png",
      content_type: "image/png",
    });
    expect(typeof logoAsset.asset_id).toBe("string");
    expect(logoAsset.asset_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(logoAsset.url).toMatch(
      /^\/__l5e\/assets-v1\/[0-9a-f-]+\/arasi-logo\.png$/,
    );
    expect(logoAsset.size).toBeGreaterThan(0);
  });

  it("does not leave a stale binary of the logo next to the pointer file", () => {
    // If the raw PNG is still committed the pointer becomes decorative
    // and the CDN copy can drift out of sync silently.
    const rawBinary = path.join(REPO_ROOT, "src/assets/arasi-logo.png");
    expect(existsSync(rawBinary)).toBe(false);
  });

  it("re-exports the pointer URL as ARASI_LOGO_URL", () => {
    expect(ARASI_LOGO_URL).toBe(logoAsset.url);
  });
});

// ────────────────────────────────────────────────────────────────
// 2. Shared <Logo> component — the single React source of truth
//    used by every in-app screen.
// ────────────────────────────────────────────────────────────────
describe("<Logo /> component", () => {
  it("defaults to the bundled asset pointer URL", () => {
    const { getByAltText } = render(<Logo />);
    const img = getByAltText("ARASI Enterprises") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(logoAsset.url);
  });

  it("honours an explicit src override (used by receipts / invoices)", () => {
    const override = "https://cdn.example.com/tenant-logo.png";
    const { getByAltText } = render(<Logo src={override} />);
    const img = getByAltText("ARASI Enterprises") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(override);
  });

  it("falls back to the bundled asset when the override is empty or whitespace", () => {
    const { getByAltText, rerender } = render(<Logo src="" />);
    expect(
      (getByAltText("ARASI Enterprises") as HTMLImageElement).getAttribute(
        "src",
      ),
    ).toBe(logoAsset.url);
    rerender(<Logo src="   " />);
    expect(
      (getByAltText("ARASI Enterprises") as HTMLImageElement).getAttribute(
        "src",
      ),
    ).toBe(logoAsset.url);
    rerender(<Logo src={null} />);
    expect(
      (getByAltText("ARASI Enterprises") as HTMLImageElement).getAttribute(
        "src",
      ),
    ).toBe(logoAsset.url);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. Web UI touchpoints — every non-email surface must import the
//    shared <Logo> component, not embed the asset URL directly.
// ────────────────────────────────────────────────────────────────
describe("Web UI touchpoints reference the shared <Logo>", () => {
  const surfaces = [
    "src/routes/index.tsx",
    "src/routes/auth.tsx",
    "src/routes/reset-password.tsx",
    "src/components/layout/AppSidebar.tsx",
    "src/components/receipts/ReceiptView.tsx",
  ];

  it.each(surfaces)("%s imports and renders <Logo>", (rel) => {
    const src = readSrc(rel);
    expect(src).toMatch(/from ["']@\/components\/brand\/Logo["']/);
    expect(src).toMatch(/<Logo(\s|\/|>)/);
  });

  it("no UI file inlines the raw asset URL — everyone goes through <Logo>", () => {
    for (const rel of surfaces) {
      const src = readSrc(rel);
      // References to the CDN URL are only OK inside the Logo component itself.
      expect(src).not.toContain(logoAsset.url);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Favicon — must exist in public/ and be wired into __root.tsx.
// ────────────────────────────────────────────────────────────────
describe("favicon", () => {
  it("public/favicon.png exists and is a real file", () => {
    const p = path.join(REPO_ROOT, "public/favicon.png");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(0);
  });

  it("__root.tsx registers /favicon.png as the icon link", () => {
    const src = readSrc("src/routes/__root.tsx");
    expect(src).toMatch(
      /rel:\s*["']icon["'][^}]*href:\s*["']\/favicon\.png["']/,
    );
    // The Lovable template default (favicon.ico) must not be re-introduced.
    expect(src).not.toMatch(/href:\s*["']\/favicon\.ico["']/);
  });
});

// ────────────────────────────────────────────────────────────────
// 5. Receipt / invoice touchpoint — feeds Site Settings logo through
//    the shared <Logo src=...> so tenants see their configured brand.
// ────────────────────────────────────────────────────────────────
describe("ReceiptView invoice header", () => {
  it("passes settings.logo_url straight into <Logo src=…>", () => {
    const src = readSrc("src/components/receipts/ReceiptView.tsx");
    expect(src).toMatch(/<Logo\s+src=\{settings\.logo_url\}/);
  });
});

// ────────────────────────────────────────────────────────────────
// 6. Email templates — every template must render <BrandHeader />
//    (never a hand-rolled <img>) and BrandHeader must emit an
//    <img src={brand.logoUrl}> whenever a valid URL was configured.
// ────────────────────────────────────────────────────────────────
describe("Email templates all funnel through <BrandHeader />", () => {
  const templates = [
    "src/lib/email-templates/reward-unlocked.tsx",
    "src/lib/email-templates/reward-claim-status.tsx",
    "src/lib/email-templates/membership-activated.tsx",
    "src/lib/email-templates/kyc-decision.tsx",
    "src/lib/email-templates/admin-role-promoted.tsx",
    "src/lib/email-templates/admin-role-revoked.tsx",
    "src/lib/email-templates/payment-reminder.tsx",
  ];

  it.each(templates)("%s renders <BrandHeader />", (rel) => {
    const src = readSrc(rel);
    expect(src).toMatch(/BrandHeader/);
    // No template should inline its own <Img> for the logo — that would
    // bypass Site Settings.
    expect(src).not.toMatch(/<Img[^>]*arasi-logo/);
    // Every template should accept a brand override prop so senders can
    // pass Site Settings values through.
    expect(src).toMatch(/brand\?:\s*BrandOverrides|brand:\s*BrandOverrides/);
  });
});

describe("<BrandHeader /> logo rendering", () => {
  it("emits <img src={logoUrl}> when a valid HTTPS URL is configured", () => {
    const b = resolveBrand({ logoUrl: "https://cdn.example.com/logo.png" });
    const html = renderToStaticMarkup(<BrandHeader b={b} />);
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain(`alt="${brandDefaults.name}"`);
  });

  it("omits the <img> tag entirely when no logo URL is configured", () => {
    const b = resolveBrand({ logoUrl: null });
    const html = renderToStaticMarkup(<BrandHeader b={b} />);
    expect(html).not.toContain("<img");
  });

  it("rejects non-http(s) logo URLs defensively (no javascript: injection)", () => {
    const b = resolveBrand({ logoUrl: "javascript:alert(1)" });
    expect(b.logoUrl).toBeNull();
    const html = renderToStaticMarkup(<BrandHeader b={b} />);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });
});

// ────────────────────────────────────────────────────────────────
// 7. End-to-end template render — each template must render without
//    throwing (imports resolve, JSX is valid) AND surface the
//    configured logo when brand overrides supply one.
// ────────────────────────────────────────────────────────────────
describe("Email templates render end-to-end with a branded logo", () => {
  const brand = {
    name: "ARASI Enterprises",
    logoUrl: "https://cdn.example.com/tenant-logo.png",
  };

  it("reward-unlocked", () => {
    const html = renderToStaticMarkup(
      <RewardUnlocked
        tierName="Gold Circle"
        rewardNumber="RWD-000123"
        unlockedAt={new Date().toISOString()}
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });

  it("reward-claim-status", () => {
    const html = renderToStaticMarkup(
      <RewardClaimStatus
        tierName="Gold Circle"
        rewardNumber="RWD-000123"
        fromStatus="eligible"
        toStatus="dispatched"
        changedAt={new Date().toISOString()}
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });

  it("membership-activated", () => {
    const html = renderToStaticMarkup(
      <MembershipActivated
        membershipNumber="ARE-000123"
        planName="Silver Plan"
        advancePaid={5000}
        monthlyInstallment={1000}
        durationMonths={12}
        totalAmount={17000}
        startDate={new Date().toISOString()}
        endDate={new Date().toISOString()}
        activatedAt={new Date().toISOString()}
        nextDueDate={new Date().toISOString()}
        nextDueAmount={1000}
        currency="INR"
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });

  it("kyc-decision", () => {
    const html = renderToStaticMarkup(
      <KycDecision
        decision="approved"
        reviewedAt={new Date().toISOString()}
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });

  it("admin-role-promoted", () => {
    const html = renderToStaticMarkup(
      <AdminRolePromoted
        actorName="Rahul"
        actorEmail="rahul@example.com"
        previousRole="customer"
        newRole="admin"
        changedAt={new Date().toISOString()}
        reason="Managing collections"
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });

  it("admin-role-revoked", () => {
    const html = renderToStaticMarkup(
      <AdminRoleRevoked
        actorName="Rahul"
        actorEmail="rahul@example.com"
        previousRole="admin"
        newRole="customer"
        changedAt={new Date().toISOString()}
        reason="Scoping down access"
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });

  it("payment-reminder", () => {
    const html = renderToStaticMarkup(
      <PaymentReminder
        recipientName="Priya"
        membershipNumber="ARE-000123"
        installmentNumber={3}
        amountDue={1000}
        dueDate={new Date().toISOString()}
        currency="INR"
        brand={brand}
      />,
    );
    expect(html).toContain(brand.logoUrl);
  });
});
