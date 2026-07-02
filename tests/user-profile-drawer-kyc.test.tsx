// @vitest-environment jsdom
/**
 * KYC tab of <UserProfileDrawer />:
 *   • Renders Aadhaar front/back image links with correct href, target=_blank,
 *     and rel=noreferrer.
 *   • Hides the link when the corresponding URL is missing.
 *
 * Schema-level checks for image field validation live at the bottom of this
 * file and drive `adminUpdateProfileSchema` directly (no React needed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { AdminProfileDetail } from "@/lib/user-profile.functions";
import { adminUpdateProfileSchema } from "@/lib/user-profile.functions";

// ---- Mocks ---------------------------------------------------------------

vi.mock("sonner", () => {
  const noop = () => {};
  return {
    toast: Object.assign(noop, {
      success: noop, error: noop, warning: noop, info: noop,
    }),
  };
});

// The drawer uses useServerFn(fn) to get a callable. We mock it so both
// getProfile and updateProfile resolve without a real backend.
const mockUpdate = vi.fn(async () => ({ ok: true as const }));
let mockProfile: AdminProfileDetail | null = null;
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => {
    // adminUpdateProfile — identify by having .middleware chain (any function)
    // We just return two distinct wrappers based on call order below via closure.
    return (args?: { data?: unknown }) => {
      if (fn && (fn as { __kind?: string }).__kind === "update") {
        return mockUpdate(args);
      }
      return Promise.resolve(mockProfile);
    };
  },
}));

vi.mock("@/lib/user-profile.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/user-profile.functions")>();
  return {
    ...actual,
    adminGetUserProfile: Object.assign(vi.fn(), { __kind: "get" }),
    adminUpdateProfile: Object.assign(vi.fn(), { __kind: "update" }),
  };
});

// ---- jsdom shims ---------------------------------------------------------

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
  if (!Element.prototype.hasPointerCapture) {
    // @ts-expect-error jsdom shim
    Element.prototype.hasPointerCapture = () => false;
    // @ts-expect-error jsdom shim
    Element.prototype.releasePointerCapture = () => {};
    // @ts-expect-error jsdom shim
    Element.prototype.setPointerCapture = () => {};
    // @ts-expect-error jsdom shim
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  mockUpdate.mockClear();
  mockProfile = null;
});

// ---- Test helpers --------------------------------------------------------

function withQuery(node: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function baseProfile(overrides: Partial<AdminProfileDetail> = {}): AdminProfileDetail {
  return {
    id: "00000000-0000-4000-8000-000000000abc",
    email: "user@example.com",
    full_name: "Test User",
    phone: "9876543210",
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    aadhaar_number: null,
    aadhaar_address: null,
    aadhaar_front_url: null,
    aadhaar_back_url: null,
    kyc_status: "pending",
    kyc_submitted_at: null,
    kyc_reviewed_at: null,
    kyc_review_notes: null,
    referred_by_promoter_id: null,
    referred_by_name: null,
    referred_by_display_id: null,
    referred_by_email: null,
    customer_display_id: null,
    promoter_display_id: null,
    promoter_referral_code: null,
    member_display_id: null,
    coupon_no: null,
    membership_number: null,
    role: "customer" as any,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as AdminProfileDetail;
}

async function mountKycTab(profile: AdminProfileDetail) {
  mockProfile = profile;
  const { UserProfileDrawer } = await import("@/components/admin/UserProfileDrawer");
  render(withQuery(<UserProfileDrawer userId={profile.id} onClose={() => {}} />));
  // Wait for the query to settle and the KYC tab trigger to appear.
  const trigger = await screen.findByRole("tab", { name: /aadhaar \/ kyc/i });
  fireEvent.click(trigger);
}

// ---- Render tests --------------------------------------------------------

describe("UserProfileDrawer — KYC tab renders Aadhaar image links", () => {
  it("renders both Front and Back image links with correct href, target, rel", async () => {
    await mountKycTab(
      baseProfile({
        aadhaar_front_url: "https://cdn.example.com/kyc/front.jpg",
        aadhaar_back_url: "https://cdn.example.com/kyc/back.jpg",
      }),
    );

    const front = await screen.findByRole("link", { name: /front image/i });
    const back = screen.getByRole("link", { name: /back image/i });

    expect(front).toHaveAttribute("href", "https://cdn.example.com/kyc/front.jpg");
    expect(front).toHaveAttribute("target", "_blank");
    expect(front.getAttribute("rel") ?? "").toMatch(/noreferrer/);

    expect(back).toHaveAttribute("href", "https://cdn.example.com/kyc/back.jpg");
    expect(back).toHaveAttribute("target", "_blank");
    expect(back.getAttribute("rel") ?? "").toMatch(/noreferrer/);
  });

  it("hides the Back image link when back URL is missing", async () => {
    await mountKycTab(
      baseProfile({
        aadhaar_front_url: "https://cdn.example.com/kyc/front.jpg",
        aadhaar_back_url: null,
      }),
    );

    await screen.findByRole("link", { name: /front image/i });
    expect(screen.queryByRole("link", { name: /back image/i })).toBeNull();
  });

  it("hides both image links when neither URL is present", async () => {
    await mountKycTab(baseProfile());
    // Ensure the KYC panel is present (status label visible)
    const panels = await screen.findAllByText(/KYC status/i);
    expect(panels.length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /front image/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /back image/i })).toBeNull();
  });
});

// ---- Schema validation tests --------------------------------------------

const base = {
  userId: "00000000-0000-4000-8000-000000000000",
  reason: "Attaching Aadhaar images",
  email: "user@example.com",
  phone: "9876543210",
};

function firstError(res: ReturnType<typeof adminUpdateProfileSchema.safeParse>, path: string) {
  if (res.success) return undefined;
  return res.error.issues.find((i) => i.path.join(".") === path)?.message;
}

describe("adminUpdateProfileSchema — Aadhaar image field validation", () => {
  it("rejects a malformed front image URL", () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...base,
      aadhaar_front_url: "not a url",
      aadhaar_back_url: "https://cdn.example.com/back.jpg",
    });
    expect(res.success).toBe(false);
    expect(firstError(res, "aadhaar_front_url")).toBeDefined();
  });

  it("rejects non-http(s) schemes for image URLs", () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...base,
      aadhaar_front_url: "ftp://example.com/front.jpg",
      aadhaar_back_url: "ftp://example.com/back.jpg",
    });
    expect(res.success).toBe(false);
    expect(firstError(res, "aadhaar_front_url")).toBe(
      "Image URL must start with http(s)://",
    );
  });

  it("requires the back image when only the front image is provided", () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...base,
      aadhaar_front_url: "https://cdn.example.com/front.jpg",
    });
    expect(res.success).toBe(false);
    expect(firstError(res, "aadhaar_back_url")).toBe(
      "Back image is required when front image is provided",
    );
  });

  it("requires the front image when only the back image is provided", () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...base,
      aadhaar_back_url: "https://cdn.example.com/back.jpg",
    });
    expect(res.success).toBe(false);
    expect(firstError(res, "aadhaar_front_url")).toBe(
      "Front image is required when back image is provided",
    );
  });

  it("requires BOTH images when saving an Aadhaar number", () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...base,
      aadhaar_number: "123412341234",
    });
    expect(res.success).toBe(false);
    expect(firstError(res, "aadhaar_front_url")).toBe(
      "Front Aadhaar image is required when saving an Aadhaar number",
    );
    expect(firstError(res, "aadhaar_back_url")).toBe(
      "Back Aadhaar image is required when saving an Aadhaar number",
    );
  });

  it("accepts a valid Aadhaar number with both https image URLs", () => {
    const res = adminUpdateProfileSchema.safeParse({
      ...base,
      aadhaar_number: "123412341234",
      aadhaar_front_url: "https://cdn.example.com/front.jpg",
      aadhaar_back_url: "https://cdn.example.com/back.jpg",
    });
    expect(res.success).toBe(true);
  });

  it("accepts a profile update without any Aadhaar fields", () => {
    const res = adminUpdateProfileSchema.safeParse(base);
    expect(res.success).toBe(true);
  });
});
