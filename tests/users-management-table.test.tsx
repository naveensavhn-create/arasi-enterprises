// @vitest-environment jsdom
/**
 * Unit tests for the admin <UsersManagementTable />.
 *
 * Verifies:
 *   - Renders All / Customers / Promoters / Admins tabs with correct counts
 *     derived from the listAllUsers query result.
 *   - Table headers reflect the documented columns (ID, Name, Email, Role,
 *     Member ID, Registered, Status, Actions).
 *   - Filtering by tab reduces the visible rows to the selected role only.
 *   - Passing roleFilter="promoter" hides the tab switcher and scopes rows
 *     (and the counts / title) to that role.
 *   - Loading and error states render their expected messages instead of
 *     the table.
 *   - Empty query result shows "No users match." with zeroed tab counts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks ----------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/user-admin.functions", () => ({
  listAllUsers: { __id: "listAllUsers" },
  sendPasswordResetEmail: { __id: "sendPasswordResetEmail" },
  generateTemporaryPassword: { __id: "generateTemporaryPassword" },
  setUserBan: { __id: "setUserBan" },
  deleteUser: { __id: "deleteUser" },
}));
vi.mock("@/lib/kyc.functions", () => ({
  setKycDecision: { __id: "setKycDecision" },
}));
vi.mock("@/components/admin/UserProfileDrawer", () => ({
  UserProfileDrawer: () => null,
}));

const listSpy = vi.fn();
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: { __id: string }) => {
    if (fn.__id === "listAllUsers") return listSpy;
    // Other server fns are unused in these tests.
    return vi.fn();
  },
}));

import { UsersManagementTable } from "@/components/admin/UsersManagementTable";
import type { AdminUserRow } from "@/lib/user-admin.functions";

// ---- Fixture --------------------------------------------------------------

function row(overrides: Partial<AdminUserRow>): AdminUserRow {
  return {
    id: crypto.randomUUID(),
    email: "user@example.com",
    phone: null,
    full_name: "Test User",
    role: "customer",
    created_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: null,
    banned_until: null,
    membership_number: null,
    customer_display_id: null,
    promoter_display_id: null,
    promoter_referral_code: null,
    kyc_status: "pending",
    ...overrides,
  };
}

const FIXTURE: AdminUserRow[] = [
  row({ full_name: "Cust A", email: "a@ex.com", role: "customer", customer_display_id: 1001 }),
  row({ full_name: "Cust B", email: "b@ex.com", role: "customer", customer_display_id: 1002 }),
  row({ full_name: "Cust C", email: "c@ex.com", role: "customer", customer_display_id: 1003 }),
  row({ full_name: "Promo X", email: "x@ex.com", role: "promoter", promoter_display_id: "10001", promoter_referral_code: "REFX" }),
  row({ full_name: "Promo Y", email: "y@ex.com", role: "promoter", promoter_display_id: "10002", promoter_referral_code: "REFY" }),
  row({ full_name: "Admin Z", email: "z@ex.com", role: "admin", kyc_status: "approved" }),
];

// ---- Helpers --------------------------------------------------------------

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function getTabButton(label: RegExp) {
  return screen
    .getAllByRole("tab")
    .find((el) => label.test(el.textContent ?? ""))!;
}

// ---- Tests ----------------------------------------------------------------

beforeEach(() => {
  listSpy.mockReset();
});
afterEach(() => cleanup());

describe("UsersManagementTable", () => {
  it("renders all four tabs with correct counts from the query result", async () => {
    listSpy.mockResolvedValue(FIXTURE);
    renderWithClient(<UsersManagementTable />);

    await screen.findByText("Cust A");

    // Tab labels + parenthesised counts.
    expect(getTabButton(/^All /).textContent).toMatch(/All\s*\(6\)/);
    expect(getTabButton(/Customers/).textContent).toMatch(/Customers\s*\(3\)/);
    expect(getTabButton(/Promoters/).textContent).toMatch(/Promoters\s*\(2\)/);
    expect(getTabButton(/Admins/).textContent).toMatch(/Admins\s*\(1\)/);

    // Title reflects total scoped users.
    expect(screen.getByText("Users (6)")).toBeTruthy();
  });

  it("renders the documented column headers", async () => {
    listSpy.mockResolvedValue(FIXTURE);
    renderWithClient(<UsersManagementTable />);
    await screen.findByText("Cust A");

    const headerRow = screen.getAllByRole("row")[0];
    const headers = within(headerRow)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());

    expect(headers).toEqual([
      "ID",
      "Name",
      "Email",
      "Role",
      "Member ID",
      "Registered",
      "Status",
      "Actions",
    ]);
  });

  it("filters visible rows when a role tab is selected", async () => {
    listSpy.mockResolvedValue(FIXTURE);
    renderWithClient(<UsersManagementTable />);
    await screen.findByText("Cust A");

    // Switch to Promoters.
    (getTabButton(/Promoters/) as HTMLElement).click();

    await waitFor(() => {
      expect(screen.queryByText("Cust A")).toBeNull();
    });
    expect(screen.getByText("Promo X")).toBeTruthy();
    expect(screen.getByText("Promo Y")).toBeTruthy();
    expect(screen.queryByText("Admin Z")).toBeNull();
  });

  it("hides the tab switcher and scopes rows when roleFilter is set", async () => {
    listSpy.mockResolvedValue(FIXTURE);
    renderWithClient(<UsersManagementTable roleFilter="promoter" />);
    await screen.findByText("Promo X");

    // No tabs rendered.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);

    // Only promoter rows shown.
    expect(screen.getByText("Promo X")).toBeTruthy();
    expect(screen.getByText("Promo Y")).toBeTruthy();
    expect(screen.queryByText("Cust A")).toBeNull();
    expect(screen.queryByText("Admin Z")).toBeNull();

    // Title reflects the scoped count.
    expect(screen.getByText("Users (2)")).toBeTruthy();
  });

  it("shows the loading state instead of the table while the query is pending", () => {
    // Never resolves within the test.
    listSpy.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<UsersManagementTable />);

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the error state when the query fails", async () => {
    listSpy.mockRejectedValue(new Error("boom"));
    renderWithClient(<UsersManagementTable />);

    await screen.findByText(/Failed to load users: boom/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the empty state and zero counts when the result is empty", async () => {
    listSpy.mockResolvedValue([]);
    renderWithClient(<UsersManagementTable />);

    await screen.findByText("No users match.");

    expect(getTabButton(/^All /).textContent).toMatch(/All\s*\(0\)/);
    expect(getTabButton(/Customers/).textContent).toMatch(/Customers\s*\(0\)/);
    expect(getTabButton(/Promoters/).textContent).toMatch(/Promoters\s*\(0\)/);
    expect(getTabButton(/Admins/).textContent).toMatch(/Admins\s*\(0\)/);
    expect(screen.getByText("Users (0)")).toBeTruthy();
  });
});
