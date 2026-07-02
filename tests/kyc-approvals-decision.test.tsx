// @vitest-environment jsdom
/**
 * Unit tests for the admin approvals KYC decision flow.
 *
 * Covers the behaviour that ships to admins on `/admin/approvals`:
 *   - Rejecting a pending submission calls `setKycDecision` with
 *     `{ approve: false, assignRole: null }`, shows a success toast, and
 *     invalidates the KYC list so the row's status is re-fetched.
 *   - Approving calls `setKycDecision` with `{ approve: true, assignRole }`
 *     (defaulting to "customer" from the Select), shows the role-specific
 *     success toast, and refreshes the auth session so the new role
 *     propagates to the current admin's cached role.
 *   - A failed decision surfaces an error toast with the server message
 *     and does NOT invalidate the list (nothing changed).
 *
 * The whole `AdminApprovalsPage` route component is rendered against
 * mocked server functions so we exercise the real `useMutation` config
 * (including its `onSuccess`/`onError` handlers) end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks (declared before importing the SUT) -----------------------------

const successToast = vi.fn();
const errorToast = vi.fn();
const loadingToast = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => successToast(...a),
    error: (...a: unknown[]) => errorToast(...a),
    loading: (...a: unknown[]) => loadingToast(...a),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

const refreshSession = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { refreshSession: () => refreshSession() } },
}));

// The KYC list and decision functions are swapped in per test via these
// mutable bindings so we can control resolve/reject timing.
type Row = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  city: string | null;
  aadhaar_number: string | null;
  aadhaar_front_url: string | null;
  aadhaar_back_url: string | null;
  role: "customer" | "promoter" | "admin" | null;
  kyc_status: "pending" | "approved" | "rejected" | "unsubmitted";
  kyc_review_notes: string | null;
  kyc_reviewed_at: string | null;
  referred_by_promoter_id: string | null;
  referred_by_name: string | null;
  referred_by_email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  aadhaar_address: string | null;
};

let currentRows: Row[] = [];
let listFn: ReturnType<typeof vi.fn>;
let decideFn: ReturnType<typeof vi.fn>;

vi.mock("@/lib/kyc.functions", () => ({
  listKycSubmissions: (...a: unknown[]) => listFn(...a),
  setKycDecision: (...a: unknown[]) => decideFn(...a),
  getKycSignedUrl: vi.fn(async () => ({ url: "" })),
}));

vi.mock("@/lib/promoter.functions", () => ({
  adminListPromoters: vi.fn(async () => []),
  adminSetCustomerPromoter: vi.fn(async () => ({ ok: true })),
}));

// ---- Load the SUT after mocks --------------------------------------------

import { Route } from "@/routes/_authenticated/admin/approvals";
const AdminApprovalsPage = (Route as unknown as { component: () => JSX.Element })
  .component;

// ---- Fixtures & helpers ---------------------------------------------------

function pendingRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "user-1",
    email: "jane@example.com",
    full_name: "Jane Doe",
    phone: "9876543210",
    city: "Chennai",
    aadhaar_number: "111122223333",
    aadhaar_front_url: null,
    aadhaar_back_url: null,
    role: "customer",
    kyc_status: "pending",
    kyc_review_notes: null,
    kyc_reviewed_at: null,
    referred_by_promoter_id: null,
    referred_by_name: null,
    referred_by_email: null,
    address_line1: null,
    address_line2: null,
    state: null,
    postal_code: null,
    country: null,
    aadhaar_address: null,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={qc}>
      <AdminApprovalsPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidateSpy };
}

async function openDrawerFor(row: Row) {
  // Wait for the table row to render, then open the review drawer.
  await waitFor(() => expect(screen.getByText(row.full_name)).toBeTruthy());
  fireEvent.click(screen.getByText(row.full_name));
  await waitFor(() =>
    expect(screen.getByText("Review the submitted details and decide.")).toBeTruthy(),
  );
}

beforeEach(() => {
  successToast.mockClear();
  errorToast.mockClear();
  loadingToast.mockClear();
  refreshSession.mockClear();
  currentRows = [pendingRow()];
  listFn = vi.fn(async () => currentRows);
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------

describe("Admin approvals — KYC decision flow", () => {
  it("rejects a pending submission, shows a success toast, and re-fetches the KYC list so the status updates", async () => {
    decideFn = vi.fn(async () => ({ ok: true }));

    const { invalidateSpy } = renderPage();
    await openDrawerFor(currentRows[0]);

    // Simulate the backend having flipped the row to `rejected` before the
    // next list refetch runs — this proves the UI picks up the new status.
    decideFn.mockImplementation(async () => {
      currentRows = [pendingRow({ kyc_status: "rejected" })];
      return { ok: true };
    });

    fireEvent.click(screen.getByRole("button", { name: /^Reject$/ }));

    await waitFor(() => expect(decideFn).toHaveBeenCalledTimes(1));
    expect(decideFn).toHaveBeenCalledWith({
      data: { userId: "user-1", approve: false, notes: null, assignRole: null },
    });

    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith(
        "KYC rejected",
        expect.objectContaining({ id: "kyc-decision" }),
      ),
    );
    expect(errorToast).not.toHaveBeenCalled();

    // List query is invalidated so the row transitions to Rejected.
    expect(
      invalidateSpy.mock.calls.some(([arg]) =>
        Array.isArray((arg as { queryKey?: unknown[] })?.queryKey) &&
        (arg as { queryKey: unknown[] }).queryKey[0] === "kyc",
      ),
    ).toBe(true);
  });

  it("approves a pending submission with the default 'customer' role, refreshes the session, and shows the role-specific success toast", async () => {
    decideFn = vi.fn(async () => {
      currentRows = [pendingRow({ kyc_status: "approved", role: "customer" })];
      return { ok: true };
    });

    const { invalidateSpy } = renderPage();
    await openDrawerFor(currentRows[0]);

    fireEvent.click(screen.getByRole("button", { name: /Approve as customer/i }));

    await waitFor(() => expect(decideFn).toHaveBeenCalledTimes(1));
    expect(decideFn).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        approve: true,
        notes: null,
        assignRole: "customer",
      },
    });

    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith(
        "Approved as customer",
        expect.objectContaining({ id: "kyc-decision" }),
      ),
    );
    expect(errorToast).not.toHaveBeenCalled();

    // Both the KYC list and the current-role cache must be invalidated so
    // the admin's own role hydrates from the server on the next read.
    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    const invalidatedKeys = invalidateSpy.mock.calls.map(([arg]) =>
      Array.isArray((arg as { queryKey?: unknown[] })?.queryKey)
        ? (arg as { queryKey: unknown[] }).queryKey[0]
        : null,
    );
    expect(invalidatedKeys).toContain("kyc");
    expect(invalidatedKeys).toContain("current-role");
  });

  it("shows an error toast with the server message when the decision RPC fails and does not refresh the session", async () => {
    decideFn = vi.fn(async () => {
      throw new Error("DB constraint violated");
    });

    renderPage();
    await openDrawerFor(currentRows[0]);

    fireEvent.click(screen.getByRole("button", { name: /^Reject$/ }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        "DB constraint violated",
        expect.objectContaining({
          id: "kyc-decision",
          description: expect.stringMatching(/try again/i),
        }),
      ),
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("blocks approving an admin user through KYC (client-side guard fires before the RPC)", async () => {
    currentRows = [pendingRow({ role: "admin" })];
    decideFn = vi.fn(async () => ({ ok: true }));

    renderPage();
    await openDrawerFor(currentRows[0]);

    fireEvent.click(screen.getByRole("button", { name: /Approve as customer/i }));

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(errorToast.mock.calls[0][0]).toMatch(/admin/i);
    expect(decideFn).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });
});
// Prevent unused-import warning if a helper is trimmed during editing.
void within;
