// @vitest-environment jsdom
/**
 * Unit tests: CustomerDashboardBody renders the correct state for each
 * query condition —
 *   1. `membershipsQ.isLoading` → full-page DashboardSkeleton
 *   2. resolved with zero rows → 3-step onboarding empty state
 *   3. membership present, `installmentsQ.isLoading` → "Loading your
 *      installment schedule…" card
 *   4. membership present, installments resolved with zero rows →
 *      "No installments generated yet" empty card
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/lib/auth", () => ({
  useSession: () => ({
    session: {
      user: { id: OWNER_ID, email: "m@example.com", user_metadata: { full_name: "Ada" } },
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: React.PropsWithChildren<{ to?: string } & Record<string, unknown>>) => (
    <a href={typeof to === "string" ? to : "#"} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/kyc/KycStatusCard", () => ({
  KycStatusCard: () => <div data-testid="kyc-card" />,
}));
vi.mock("@/components/dashboard/NextDrawCard", () => ({
  NextDrawCard: () => <div data-testid="next-draw-card" />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// --- Supabase mock knobs -------------------------------------------------
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

type InstallmentRow = {
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
  membership_id: string;
};

let membershipsFixture: MembershipRow[] = [];
let installmentsFixture: InstallmentRow[] = [];
let holdMemberships = false;
let holdInstallments = false;

vi.mock("@/integrations/supabase/client", () => {
  const makeMemberships = () => {
    const b: any = {
      select: () => b,
      order: () =>
        holdMemberships
          ? new Promise(() => {})
          : Promise.resolve({ data: membershipsFixture, error: null }),
      eq: (col: string, val: unknown) => {
        const rows = membershipsFixture.filter((r) => (r as any)[col] === val);
        return {
          ...b,
          order: () =>
            holdMemberships
              ? new Promise(() => {})
              : Promise.resolve({ data: rows, error: null }),
        };
      },
    };
    return b;
  };
  const makeInstallments = () => {
    const b: any = {
      select: () => b,
      order: () =>
        holdInstallments
          ? new Promise(() => {})
          : Promise.resolve({ data: installmentsFixture, error: null }),
      eq: (col: string, val: unknown) => {
        const rows = installmentsFixture.filter((r) => (r as any)[col] === val);
        return {
          ...b,
          order: () =>
            holdInstallments
              ? new Promise(() => {})
              : Promise.resolve({ data: rows, error: null }),
        };
      },
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

const baseMembership = (o: Partial<MembershipRow> = {}): MembershipRow => ({
  id: "mem-1",
  user_id: OWNER_ID,
  membership_number: "ARE-2601-XYZ999",
  member_display_id: "AR100200",
  coupon_no: "1234",
  status: "active",
  start_date: "2026-01-01",
  end_date: null,
  advance_paid: 5000,
  total_amount: 60000,
  paid_amount: 5000,
  membership_plans: { name: "Gold", monthly_installment: 5000, duration_months: 12 },
  ...o,
});

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
  membershipsFixture = [];
  installmentsFixture = [];
  holdMemberships = false;
  holdInstallments = false;
});
afterEach(() => cleanup());

describe("CustomerDashboardBody — state matrix", () => {
  it("renders the DashboardSkeleton while the memberships query is loading", () => {
    holdMemberships = true;
    renderDash();

    // Skeleton is exposed as a polite live region.
    const status = screen.getByRole("status", { name: /loading your dashboard/i });
    expect(status).toBeTruthy();
    // Neither empty-state copy nor installments copy is present.
    expect(screen.queryByText(/don't have an active membership yet/i)).toBeNull();
    expect(screen.queryByText(/loading your installment schedule/i)).toBeNull();
    expect(screen.queryByText(/no installments generated yet/i)).toBeNull();
    // Skeleton uses shadcn Skeleton divs — a handful should be present.
    expect(status.querySelectorAll("[data-slot='skeleton'], .animate-pulse").length)
      .toBeGreaterThan(0);
  });

  it("renders the 3-step empty state when memberships resolves with zero rows", async () => {
    membershipsFixture = []; // signed-in, no memberships
    renderDash();

    // Welcome heading + guiding copy
    expect(
      await screen.findByRole("heading", { level: 2, name: /welcome,\s*ada/i }),
    ).toBeTruthy();
    expect(screen.getByText(/don't have an active membership yet/i)).toBeTruthy();

    // Exactly 3 onboarding steps rendered as <li> children of an <ol>.
    const ol = document.querySelector("ol");
    expect(ol).toBeTruthy();
    const items = ol!.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/browse membership plans/i);
    expect(items[1].textContent).toMatch(/pay the one-time advance/i);
    expect(items[2].textContent).toMatch(/track monthly installments/i);

    // Both CTAs surfaced.
    expect(screen.getByRole("link", { name: /browse plans/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /learn how it works/i })).toBeTruthy();

    // Skeleton and installment cards should NOT be rendered in this state.
    expect(screen.queryByRole("status", { name: /loading your dashboard/i })).toBeNull();
    expect(screen.queryByText(/loading your installment schedule/i)).toBeNull();
    expect(screen.queryByText(/no installments generated yet/i)).toBeNull();
  });

  it("renders the installments loading card when the membership is loaded but installments query is pending", async () => {
    membershipsFixture = [baseMembership()];
    holdInstallments = true;
    renderDash();

    // Hero indicates the membership rendered.
    expect(await screen.findByRole("heading", { level: 1, name: /ada/i })).toBeTruthy();
    // Loading card copy is present.
    expect(screen.getByText(/loading your installment schedule/i)).toBeTruthy();

    // Empty installments card must not be shown at the same time.
    expect(screen.queryByText(/no installments generated yet/i)).toBeNull();
    // Counts summary should be absent while loading.
    expect(screen.queryByText(/total installments/i)).toBeNull();
  });

  it("renders the installments empty card when the schedule query resolves with zero rows", async () => {
    membershipsFixture = [baseMembership({ status: "pending" })];
    installmentsFixture = []; // schedule not generated yet
    renderDash();

    // Wait for the empty card to appear.
    expect(await screen.findByText(/no installments generated yet/i)).toBeTruthy();
    // Pending-membership variant of the empty copy.
    expect(
      screen.getByText(/schedule will appear here as soon as your advance payment is confirmed/i),
    ).toBeTruthy();
    // CTA that points at the membership detail page.
    const cta = screen.getByRole("link", { name: /view membership/i });
    expect(cta.getAttribute("href")).toBe("/customer/membership");

    // Loading card copy must be gone once the query resolves.
    await waitFor(() => {
      expect(screen.queryByText(/loading your installment schedule/i)).toBeNull();
    });
  });
});
