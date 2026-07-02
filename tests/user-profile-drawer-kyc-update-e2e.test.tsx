// @vitest-environment jsdom
/**
 * End-to-end flow for updating Aadhaar KYC through <UserProfileDrawer />.
 *
 * Scenario:
 *   1. Admin opens the drawer for a customer with existing (old) Aadhaar
 *      image URLs on file.
 *   2. Admin edits Aadhaar number + address on the KYC tab and saves with an
 *      audit reason.
 *   3. Backend accepts the change; a subsequent refetch returns UPDATED
 *      image URLs (e.g. images were re-uploaded during the same session).
 *   4. The drawer re-renders and the Front / Back image links now point at
 *      the new URLs, still open in a new tab, and are safe to click
 *      (target=_blank + rel=noreferrer, valid https href).
 *
 * We drive this with the same mocking approach as
 * `user-profile-drawer-kyc.test.tsx` but flip `mockProfile` after the
 * mutation resolves and force a refetch via query invalidation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AdminProfileDetail } from "@/lib/user-profile.functions";

// ---- Mocks ---------------------------------------------------------------

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => {
  const noop = () => {};
  return {
    toast: Object.assign(noop, {
      success: (...a: unknown[]) => toastSuccess(...a),
      error: (...a: unknown[]) => toastError(...a),
      warning: noop,
      info: noop,
    }),
  };
});

const mockUpdate = vi.fn(async () => ({ ok: true as const }));
let mockProfile: AdminProfileDetail | null = null;

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: (fn: unknown) => (args?: { data?: unknown }) => {
      if (fn && (fn as { __kind?: string }).__kind === "update") {
        return mockUpdate(args);
      }
      return Promise.resolve(mockProfile);
    },
  };
});

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
  toastSuccess.mockClear();
  toastError.mockClear();
  mockProfile = null;
});

// ---- Helpers -------------------------------------------------------------

function baseProfile(overrides: Partial<AdminProfileDetail> = {}): AdminProfileDetail {
  return {
    id: "00000000-0000-4000-8000-0000000000e2",
    email: "kyc-user@example.com",
    full_name: "KYC Test User",
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

function assertOpensInNewTabSafely(a: HTMLAnchorElement, expectedHref: string) {
  expect(a.getAttribute("href")).toBe(expectedHref);
  expect(a.getAttribute("target")).toBe("_blank");
  expect(a.getAttribute("rel") ?? "").toMatch(/noreferrer/);

  // href must be a syntactically valid https URL (guards against relative /
  // javascript: / data: schemes slipping through).
  const url = new URL(a.href);
  expect(url.protocol).toBe("https:");
  expect(url.host).not.toBe("");

  // A click on a target=_blank anchor must not be preventDefault'd by any
  // handler in the tree; if it were, opening the image would silently fail.
  const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(evt);
  expect(evt.defaultPrevented).toBe(false);
}

// ---- Test ----------------------------------------------------------------

describe("UserProfileDrawer — end-to-end Aadhaar KYC update", () => {
  it("saves Aadhaar fields, then renders the updated image links opening in a new tab", async () => {
    const userId = "00000000-0000-4000-8000-0000000000e2";
    const OLD_FRONT = "https://cdn.example.com/kyc/old-front.jpg";
    const OLD_BACK = "https://cdn.example.com/kyc/old-back.jpg";
    const NEW_FRONT = "https://cdn.example.com/kyc/new-front.jpg";
    const NEW_BACK = "https://cdn.example.com/kyc/new-back.jpg";

    // Step 1: initial profile with OLD image URLs.
    mockProfile = baseProfile({
      aadhaar_front_url: OLD_FRONT,
      aadhaar_back_url: OLD_BACK,
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    const { UserProfileDrawer } = await import("@/components/admin/UserProfileDrawer");
    render(
      <QueryClientProvider client={qc}>
        <UserProfileDrawer userId={userId} onClose={() => {}} />
      </QueryClientProvider>,
    );

    // Step 2: switch to KYC tab.
    const user = userEvent.setup();
    const kycTab = await screen.findByRole("tab", { name: /aadhaar \/ kyc/i });
    await user.click(kycTab);

    // Old links visible first.
    const oldFront = await screen.findByRole("link", { name: /front image/i });
    assertOpensInNewTabSafely(oldFront as HTMLAnchorElement, OLD_FRONT);

    // Step 3: fill Aadhaar number + address + reason and save.
    const numberInput = screen.getByLabelText(/aadhaar number/i);
    const addressInput = screen.getByLabelText(/aadhaar address/i);
    const reasonInput = screen.getByPlaceholderText(/why edit aadhaar/i);

    await user.clear(numberInput);
    await user.type(numberInput, "123412341234");
    await user.clear(addressInput);
    await user.type(addressInput, "12 MG Road, Bengaluru 560001");
    await user.type(reasonInput, "Refreshing Aadhaar details for KYC review");

    const saveBtn = screen.getByRole("button", { name: /save aadhaar/i });
    await user.click(saveBtn);

    // Update endpoint received the payload we expect.
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [payload] = mockUpdate.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(payload.data.userId).toBe(userId);
    expect(payload.data.aadhaar_number).toBe("123412341234");
    expect(payload.data.aadhaar_address).toBe("12 MG Road, Bengaluru 560001");
    expect(String(payload.data.reason)).toMatch(/refreshing aadhaar/i);
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();

    // Step 4: simulate re-uploaded images landing server-side, then refetch.
    mockProfile = baseProfile({
      aadhaar_number: "123412341234",
      aadhaar_address: "12 MG Road, Bengaluru 560001",
      aadhaar_front_url: NEW_FRONT,
      aadhaar_back_url: NEW_BACK,
      kyc_status: "submitted",
      kyc_submitted_at: new Date().toISOString(),
    });
    await qc.invalidateQueries({ queryKey: ["admin", "user-profile", userId] });

    // Step 5: links now reflect the UPDATED URLs and open safely in a new tab.
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /front image/i }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(NEW_FRONT);
    });

    const newFront = screen.getByRole("link", { name: /front image/i }) as HTMLAnchorElement;
    const newBack = screen.getByRole("link", { name: /back image/i }) as HTMLAnchorElement;
    assertOpensInNewTabSafely(newFront, NEW_FRONT);
    assertOpensInNewTabSafely(newBack, NEW_BACK);

    // Old URLs must no longer be referenced anywhere on screen.
    expect(document.body.innerHTML).not.toContain(OLD_FRONT);
    expect(document.body.innerHTML).not.toContain(OLD_BACK);
  });
});
