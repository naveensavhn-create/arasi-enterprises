// @vitest-environment jsdom
/**
 * Unit tests: CustomerDashboardBody surfaces a friendly error UI (with a
 * "Try again" retry CTA) when the underlying React Query request fails,
 * and shows an inline retryable error for the installments query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const OWNER_ID = "22222222-2222-2222-2222-222222222222";

vi.mock("@/lib/auth", () => ({
  useSession: () => ({
    session: {
      user: { id: OWNER_ID, email: "err@example.com", user_metadata: { full_name: "Ada" } },
    },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: React.PropsWithChildren<{ to?: string } & Record<string, unknown>>) => (
    <a href={typeof to === "string" ? to : "#"} {...(rest as Record<string, string>)}>{children}</a>
  ),
}));
vi.mock("@/components/kyc/KycStatusCard", () => ({ KycStatusCard: () => <div data-testid="kyc-card" /> }));
vi.mock("@/components/dashboard/NextDrawCard", () => ({ NextDrawCard: () => <div data-testid="next-draw-card" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type MembershipRow = {
  id: string;
  user_id: string;
  membership_number: string;
  member_display_id: string | null;
  coupon_no: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  advance_paid: number;
  total_amount: number;
  paid_amount: number;
  membership_plans: { name: string; monthly_installment: number; duration_months: number } | null;
};

// Mutable knobs the tests flip between calls.
let membershipsError: string | null = null;
let membershipsFixture: MembershipRow[] = [];
let membershipsCalls = 0;

let installmentsError: string | null = null;
let installmentsFixture: Array<Record<string, unknown>> = [];
let installmentsCalls = 0;

vi.mock("@/integrations/supabase/client", () => {
  const makeMemberships = () => {
    const b: any = {
      select: () => b,
      order: () => {
        membershipsCalls++;
        return membershipsError
          ? Promise.resolve({ data: null, error: { message: membershipsError } })
          : Promise.resolve({ data: membershipsFixture, error: null });
      },
      eq: () => ({
        ...b,
        order: () => {
          membershipsCalls++;
          return membershipsError
            ? Promise.resolve({ data: null, error: { message: membershipsError } })
            : Promise.resolve({ data: membershipsFixture, error: null });
        },
      }),
    };
    return b;
  };
  const makeInstallments = () => {
    const b: any = {
      select: () => b,
      order: () => {
        installmentsCalls++;
        return installmentsError
          ? Promise.resolve({ data: null, error: { message: installmentsError } })
          : Promise.resolve({ data: installmentsFixture, error: null });
      },
      eq: () => ({
        ...b,
        order: () => {
          installmentsCalls++;
          return installmentsError
            ? Promise.resolve({ data: null, error: { message: installmentsError } })
            : Promise.resolve({ data: installmentsFixture, error: null });
        },
      }),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "memberships") return makeMemberships();
        if (table === "installments") return makeInstallments();
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
});

import { CustomerDashboardBody } from "@/components/customer/CustomerDashboardBody";

function renderDash() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <CustomerDashboardBody />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  membershipsError = null;
  membershipsFixture = [];
  membershipsCalls = 0;
  installmentsError = null;
  installmentsFixture = [];
  installmentsCalls = 0;
});
afterEach(() => cleanup());

const baseMembership = (): MembershipRow => ({
  id: "mem-err-1",
  user_id: OWNER_ID,
  membership_number: "ARE-2601-ERR001",
  member_display_id: "AR100999",
  coupon_no: "9999",
  status: "active",
  start_date: "2026-01-01",
  end_date: null,
  advance_paid: 5000,
  total_amount: 60000,
  paid_amount: 5000,
  membership_plans: { name: "Gold", monthly_installment: 5000, duration_months: 12 },
});

describe("CustomerDashboardBody — error UI", () => {
  it("renders the full-page error alert with retry CTA when the memberships query fails", async () => {
    membershipsError = "connection lost";
    renderDash();

    const alert = await screen.findByTestId("dashboard-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(screen.getByText(/couldn't load your dashboard/i)).toBeTruthy();
    // The underlying error message is surfaced to the user.
    expect(screen.getByText(/connection lost/i)).toBeTruthy();

    // Skeleton and other states must not be present at the same time.
    expect(screen.queryByRole("status", { name: /loading your dashboard/i })).toBeNull();
    expect(screen.queryByText(/don't have an active membership yet/i)).toBeNull();

    // Retry CTA is present and wired to refetch.
    const retry = screen.getByRole("button", { name: /try again/i });
    expect(retry).toBeTruthy();
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });

  it("re-runs the memberships query and recovers when Try again is clicked", async () => {
    membershipsError = "temporary failure";
    renderDash();

    await screen.findByTestId("dashboard-error");
    const initialCalls = membershipsCalls;
    expect(initialCalls).toBeGreaterThan(0);

    // Simulate the backend recovering before the retry.
    membershipsError = null;
    membershipsFixture = [];

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Refetch fires and the error UI unmounts once data resolves.
    await waitFor(() => expect(membershipsCalls).toBeGreaterThan(initialCalls));
    await waitFor(() => expect(screen.queryByTestId("dashboard-error")).toBeNull());

    // The empty-state welcome renders once the query resolves with zero rows.
    expect(await screen.findByRole("heading", { level: 2, name: /welcome,\s*ada/i })).toBeTruthy();
  });

  it("renders an inline retryable error card when the installments query fails", async () => {
    membershipsFixture = [baseMembership()];
    installmentsError = "installments unreachable";
    renderDash();

    const alert = await screen.findByTestId("installments-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.getByText(/couldn't load installments/i)).toBeTruthy();
    expect(screen.getByText(/installments unreachable/i)).toBeTruthy();

    // Membership hero is still rendered — only the installments card degraded.
    expect(screen.getByRole("heading", { level: 1, name: /ada/i })).toBeTruthy();
    // Neither the loading nor the empty installments card is shown at the same time.
    expect(screen.queryByText(/loading your installment schedule/i)).toBeNull();
    expect(screen.queryByText(/no installments generated yet/i)).toBeNull();

    // Retry CTA re-runs the installments query.
    const before = installmentsCalls;
    installmentsError = null;
    installmentsFixture = [];
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(installmentsCalls).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId("installments-error")).toBeNull());
  });
});
