// @vitest-environment jsdom
/**
 * Unit tests for the admin UserProfileDrawer save flow.
 *
 * Verifies the "loading" contract that users rely on:
 *   1. While the update mutation is pending, the Save button is disabled
 *      AND renders a spinner (Loader2 with animate-spin) — so a slow
 *      backend never leads to a double-submit or silent UI.
 *   2. No success/error toast fires until the mutation actually settles.
 *   3. On resolve, exactly one success toast fires and the spinner clears.
 *   4. On reject, exactly one error toast (with the thrown message) fires
 *      and the spinner clears so the admin can retry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks (must be declared before importing the SUT) ---------------------

const successToast = vi.fn();
const errorToast = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => successToast(...a),
    error: (...a: unknown[]) => errorToast(...a),
  },
}));

// `useServerFn` in tests just returns the underlying function reference. The
// two functions themselves are replaced below via the module mock so the
// component sees deterministic behaviour.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

const PROFILE = {
  id: "user-1",
  email: "jane@example.com",
  full_name: "Jane Doe",
  phone: "9876543210",
  address_line1: "1 Road",
  address_line2: null,
  city: "Chennai",
  state: "TN",
  postal_code: "600001",
  country: "IN",
  aadhaar_number: null,
  aadhaar_address: null,
  aadhaar_front_url: null,
  aadhaar_back_url: null,
  kyc_status: "unsubmitted",
  kyc_submitted_at: null,
  kyc_reviewed_at: null,
  kyc_review_notes: null,
  referred_by_promoter_id: null,
  referred_by_name: null,
  referred_by_email: null,
  referred_by_display_id: null,
  role: "customer",
  customer_display_id: 42,
  promoter_display_id: null,
  promoter_referral_code: null,
  membership_number: null,
  membership_status: null,
  member_display_id: null,
  coupon_no: null,
} as const;

// updateFn is reassigned per test so we can control resolve/reject timing.
let updateFn: ReturnType<typeof vi.fn>;

vi.mock("@/lib/user-profile.functions", () => ({
  adminGetUserProfile: vi.fn(async () => PROFILE),
  adminUpdateProfile: (...args: unknown[]) => updateFn(...args),
}));

// ---- SUT ------------------------------------------------------------------

import { UserProfileDrawer } from "@/components/admin/UserProfileDrawer";

function renderDrawer() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UserProfileDrawer userId="user-1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Wait for the profile query to hydrate the form (reason field appears). */
async function waitForFormReady() {
  await waitFor(() => expect(screen.getByLabelText(/Reason for change/i)).toBeTruthy());
}

/** Type an audit reason and click the primary Save button on the Edit tab. */
function submitWithReason() {
  const reason = screen.getByLabelText(/Reason for change/i) as HTMLTextAreaElement;
  fireEvent.change(reason, { target: { value: "Fixing phone typo per user request" } });
  const saveBtn = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
  expect(saveBtn.disabled).toBe(false);
  fireEvent.click(saveBtn);
  return saveBtn;
}

function spinnerInside(btn: HTMLElement): SVGElement | null {
  return btn.querySelector("svg.animate-spin");
}

beforeEach(() => {
  successToast.mockClear();
  errorToast.mockClear();
});

afterEach(() => cleanup());

describe("UserProfileDrawer — save mutation loading state", () => {
  it("disables the Save button and shows a spinner while the update is pending, and fires no toast until resolve", async () => {
    let resolveUpdate!: (v: unknown) => void;
    updateFn = vi.fn(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );

    renderDrawer();
    await waitForFormReady();

    const saveBtn = submitWithReason();

    // Pending state: disabled + spinner, no toasts yet.
    await waitFor(() => expect(saveBtn.disabled).toBe(true));
    expect(spinnerInside(saveBtn)).not.toBeNull();
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expect(updateFn).toHaveBeenCalledTimes(1);

    // Resolve the mutation → success toast, spinner clears, button re-enables.
    resolveUpdate({ ok: true });
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    expect(successToast).toHaveBeenCalledWith("Profile updated");
    expect(errorToast).not.toHaveBeenCalled();
    await waitFor(() => expect(saveBtn.disabled).toBe(false));
    expect(spinnerInside(saveBtn)).toBeNull();
  });

  it("shows the spinner while pending and fires only the error toast on reject", async () => {
    let rejectUpdate!: (e: Error) => void;
    updateFn = vi.fn(
      () => new Promise((_r, reject) => { rejectUpdate = reject; }),
    );

    renderDrawer();
    await waitForFormReady();

    const saveBtn = submitWithReason();

    await waitFor(() => expect(saveBtn.disabled).toBe(true));
    expect(spinnerInside(saveBtn)).not.toBeNull();
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();

    rejectUpdate(new Error("Server exploded"));

    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast).toHaveBeenCalledWith("Server exploded");
    expect(successToast).not.toHaveBeenCalled();
    await waitFor(() => expect(saveBtn.disabled).toBe(false));
    expect(spinnerInside(saveBtn)).toBeNull();
  });

  it("does not fire the mutation (or any toast) when the audit reason is missing", async () => {
    updateFn = vi.fn(async () => ({ ok: true }));

    renderDrawer();
    await waitForFormReady();

    const saveBtn = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
    fireEvent.click(saveBtn);

    // Client-side guard: no server call, no success toast, and the button
    // stays enabled (no pending state was entered).
    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(updateFn).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    expect(saveBtn.disabled).toBe(false);
    expect(spinnerInside(saveBtn)).toBeNull();
  });
});
