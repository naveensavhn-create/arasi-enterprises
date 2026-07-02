// @vitest-environment jsdom
/**
 * Unit tests for the admin <UserProfileDrawer />.
 *
 * Verifies:
 *   - Renders the complete profile detail (IDs, contact info, address,
 *     referral chain, KYC section) returned from adminGetUserProfile.
 *   - The edit form is prefilled from the server profile, saves corrected
 *     data through adminUpdateProfile with the full payload, and shows a
 *     success toast.
 *   - Client-side validation blocks the save mutation on:
 *       - missing / too-short reason
 *       - malformed Aadhaar number
 *     and surfaces a clear error toast in each case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";


// ---- Mocks ----------------------------------------------------------------

const successToast = vi.fn();
const errorToast = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => successToast(...a),
    error: (...a: unknown[]) => errorToast(...a),
  },
}));

// The component reads these via useServerFn(...) — we stub the module so the
// import resolves, then swap in per-call spies through useServerFn below.
vi.mock("@/lib/user-profile.functions", () => ({
  adminGetUserProfile: { __id: "adminGetUserProfile" },
  adminUpdateProfile: { __id: "adminUpdateProfile" },
}));

const getSpy = vi.fn();
const updateSpy = vi.fn(async () => ({ ok: true }));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: { __id: string }) => {
    if (fn.__id === "adminGetUserProfile") return getSpy;
    if (fn.__id === "adminUpdateProfile") return updateSpy;
    throw new Error(`Unexpected server fn: ${JSON.stringify(fn)}`);
  },
}));

import { UserProfileDrawer } from "@/components/admin/UserProfileDrawer";

// ---- Fixture --------------------------------------------------------------

const USER_ID = "11111111-1111-1111-1111-111111111111";

const FULL_PROFILE = {
  id: USER_ID,
  email: "customer@example.com",
  full_name: "Ravi Kumar",
  phone: "+91 98765 43210",
  address_line1: "12 MG Road",
  address_line2: "Apt 4B",
  city: "Bengaluru",
  state: "Karnataka",
  postal_code: "560001",
  country: "India",
  aadhaar_number: "123412341234",
  aadhaar_address: "12 MG Road, Bengaluru",
  aadhaar_front_url: "https://cdn.example.com/aadhaar/front.jpg",
  aadhaar_back_url: "https://cdn.example.com/aadhaar/back.jpg",
  kyc_status: "approved" as const,
  kyc_submitted_at: "2026-01-02T00:00:00Z",
  kyc_reviewed_at: "2026-01-03T00:00:00Z",
  kyc_review_notes: "Looks good",
  referred_by_promoter_id: "22222222-2222-2222-2222-222222222222",
  referred_by_name: "Anita Sharma",
  referred_by_email: "anita@example.com",
  referred_by_display_id: "PROMO-42",
  role: "customer" as const,
  customer_display_id: 1042,
  promoter_display_id: null,
  promoter_referral_code: null,
  membership_number: "ARASI-2026-000123",
  membership_status: "active",
  member_display_id: "M-000123",
  coupon_no: "COUPON-9",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
};

// ---- Test harness ---------------------------------------------------------

function renderDrawer(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UserProfileDrawer userId={USER_ID} onClose={onClose} />
    </QueryClientProvider>,
  );
}

// jsdom's navigator.clipboard is a getter — override once.
const writeText = vi.fn(async () => undefined);
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  writable: true,
  value: { writeText },
});

beforeEach(() => {
  successToast.mockClear();
  errorToast.mockClear();
  updateSpy.mockClear();
  getSpy.mockReset();
  getSpy.mockResolvedValue(FULL_PROFILE);
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// 1. Rendering complete details
// ---------------------------------------------------------------------------

describe("UserProfileDrawer — complete profile view", () => {
  it("renders IDs, contact, address, referral chain, KYC and role badge", async () => {
    renderDrawer();

    // Wait for the loaded state (form field appears once profile resolves).
    await screen.findByLabelText(/full name/i);

    // Role badge
    expect(screen.getByText(/^customer$/i)).toBeTruthy();


    // ID chips (only present when the field is non-null)
    expect(screen.getByText("Customer ID")).toBeTruthy();
    expect(screen.getByText("1042")).toBeTruthy();
    expect(screen.getByText("Member ID")).toBeTruthy();
    expect(screen.getByText("M-000123")).toBeTruthy();
    expect(screen.getByText("Coupon no.")).toBeTruthy();
    expect(screen.getByText("COUPON-9")).toBeTruthy();
    expect(screen.getByText("Membership no.")).toBeTruthy();
    expect(screen.getByText("ARASI-2026-000123")).toBeTruthy();

    // Promoter-only chips are hidden for a customer
    expect(screen.queryByText("Promoter ID")).toBeNull();
    expect(screen.queryByText("Referral code")).toBeNull();

    // Referred-by strip
    expect(screen.getByText(/referred by/i)).toBeTruthy();
    expect(screen.getByText("Anita Sharma")).toBeTruthy();
    expect(screen.getByText(/PROMO-42/)).toBeTruthy();

    // Edit form is prefilled from the server profile
    const fullName = screen.getByLabelText(/full name/i) as HTMLInputElement;
    const email = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    const phone = screen.getByLabelText(/^phone$/i) as HTMLInputElement;
    const city = screen.getByLabelText(/^city$/i) as HTMLInputElement;
    const postal = screen.getByLabelText(/postal code/i) as HTMLInputElement;
    expect(fullName.value).toBe("Ravi Kumar");
    expect(email.value).toBe("customer@example.com");
    expect(phone.value).toBe("+91 98765 43210");
    expect(city.value).toBe("Bengaluru");
    expect(postal.value).toBe("560001");

    // KYC tab — switch and assert Aadhaar surface
    fireEvent.click(screen.getByRole("tab", { name: /aadhaar \/ kyc/i }));

    // Wait for the aadhaar input to appear (proves the new panel mounted).
    const aadhaarNo = (await screen.findByLabelText(
      /aadhaar number/i,
    )) as HTMLInputElement;
    const aadhaarAddr = screen.getByLabelText(
      /aadhaar address/i,
    ) as HTMLTextAreaElement;
    expect(aadhaarNo.value).toBe("123412341234");
    expect(aadhaarAddr.value).toBe("12 MG Road, Bengaluru");

    // KYC status line (matcher spans multiple elements — use a fn)
    expect(
      screen.getByText((_, el) =>
        !!el && /kyc status:/i.test(el.textContent ?? ""),
      ),
    ).toBeTruthy();
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);

    // Front / back image links
    const linkHrefs = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(linkHrefs).toContain(FULL_PROFILE.aadhaar_front_url);
    expect(linkHrefs).toContain(FULL_PROFILE.aadhaar_back_url);

  });

  it("passes the userId to the getter server fn", async () => {
    renderDrawer();
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(getSpy).toHaveBeenCalledWith({ data: { userId: USER_ID } });
  });
});

// ---------------------------------------------------------------------------
// 2. Save flow with corrected data
// ---------------------------------------------------------------------------

describe("UserProfileDrawer — edit form save", () => {
  it("saves corrected fields with reason and shows a success toast", async () => {
    renderDrawer();

    const city = (await screen.findByLabelText(/^city$/i)) as HTMLInputElement;
    const phone = screen.getByLabelText(/^phone$/i) as HTMLInputElement;
    fireEvent.change(city, { target: { value: "Mysuru" } });
    fireEvent.change(phone, { target: { value: "+91 90000 00001" } });

    const reason = screen.getByLabelText(
      /reason for change/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(reason, {
      target: { value: "Customer confirmed corrected city & phone." },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const [call] = updateSpy.mock.calls;
    expect(call[0]).toEqual({
      data: expect.objectContaining({
        userId: USER_ID,
        full_name: "Ravi Kumar",
        email: "customer@example.com",
        phone: "+91 90000 00001",
        city: "Mysuru",
        state: "Karnataka",
        postal_code: "560001",
        country: "India",
        aadhaar_number: "123412341234",
        aadhaar_address: "12 MG Road, Bengaluru",
        reason: "Customer confirmed corrected city & phone.",
      }),
    });
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith("Profile updated"),
    );
  });

  it("surfaces the server error message when the update fails", async () => {
    updateSpy.mockRejectedValueOnce(new Error("Email already in use"));
    renderDrawer();

    await screen.findByLabelText(/^city$/i);
    fireEvent.change(
      screen.getByLabelText(/reason for change/i),
      { target: { value: "Correcting stale contact info." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith("Email already in use"),
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Client-side validation
// ---------------------------------------------------------------------------

describe("UserProfileDrawer — validation blocks the save mutation", () => {
  it("rejects a missing or too-short reason", async () => {
    renderDrawer();
    await screen.findByLabelText(/^city$/i);

    // Empty reason
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        "Enter a short reason (min 5 chars) for the audit log.",
      ),
    );
    expect(updateSpy).not.toHaveBeenCalled();

    errorToast.mockClear();

    // Too short (whitespace + < 5 chars)
    fireEvent.change(screen.getByLabelText(/reason for change/i), {
      target: { value: "  ok " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        "Enter a short reason (min 5 chars) for the audit log.",
      ),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed Aadhaar number (non-12-digits)", async () => {
    renderDrawer();
    await screen.findByLabelText(/full name/i);

    // Switch to Aadhaar tab and wait for its inputs to mount
    fireEvent.click(screen.getByRole("tab", { name: /aadhaar \/ kyc/i }));
    const aadhaarInput = await screen.findByLabelText(/aadhaar number/i);

    // Break the Aadhaar number then submit via the tab's Save button
    fireEvent.change(aadhaarInput, { target: { value: "12345" } });
    // The Aadhaar tab has its own reason textarea (labelled "Reason for change")
    const reasons = screen.getAllByLabelText(/reason for change/i);
    fireEvent.change(reasons[reasons.length - 1], {
      target: { value: "Fixing Aadhaar typo." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save aadhaar/i }));


    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith("Aadhaar must be 12 digits."),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
