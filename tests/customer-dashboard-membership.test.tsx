// @vitest-environment jsdom
/**
 * Integration test: CustomerDashboardBody reads the correct ID No and
 * Coupon No for the signed-in customer, and never surfaces another
 * customer's membership row.
 *
 * The component queries `memberships` filtered by `user_id = auth.uid()`
 * and, as defense-in-depth, rejects any row whose `user_id` does not
 * match the session. This test drives both paths through mocked Supabase
 * responses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Session mock ------------------------------------------------------
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

let sessionUserId: string | null = OWNER_ID;
vi.mock("@/lib/auth", () => ({
  useSession: () => ({
    session: sessionUserId
      ? { user: { id: sessionUserId, email: "owner@example.com", user_metadata: { full_name: "Owner" } } }
      : null,
  }),
}));

// --- Router mock (Link is rendered inside empty states / buttons) -----
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as Record<string, string>)}>{children}</a>
  ),
}));

// --- KycStatusCard is unrelated to this test; stub it out -------------
vi.mock("@/components/kyc/KycStatusCard", () => ({
  KycStatusCard: () => <div data-testid="kyc-card" />,
}));

// --- Sonner (toast) mock ---------------------------------------------
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// --- Supabase client mock -------------------------------------------
// Track the last `.eq()` filter on `memberships` so assertions can
// confirm the query was actually scoped to the signed-in user id.
const lastEq: { table: string; col?: string; val?: unknown } = { table: "" };

type MembershipFixture = {
  id: string;
  membership_number: string;
  member_display_id: string | null;
  coupon_no: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  advance_paid: number;
  total_amount: number;
  paid_amount: number;
  user_id: string;
  membership_plans: { name: string; monthly_installment: number; duration_months: number } | null;
};

let membershipsFixture: MembershipFixture[] = [];
let installmentsFixture: Array<{
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
  membership_id: string;
}> = [];

function makeMembershipsBuilder() {
  const b: any = {
    select: () => b,
    order: () => Promise.resolve({ data: membershipsFixture, error: null }),
    eq: (col: string, val: unknown) => {
      lastEq.table = "memberships";
      lastEq.col = col;
      lastEq.val = val;
      // Emulate PostgREST + RLS: only rows matching the filter come back.
      const rows = membershipsFixture.filter((r) => (r as any)[col] === val);
      const chain: any = { ...b, order: () => Promise.resolve({ data: rows, error: null }) };
      return chain;
    },
  };
  return b;
}

function makeInstallmentsBuilder() {
  const b: any = {
    select: () => b,
    order: () => Promise.resolve({ data: installmentsFixture, error: null }),
    eq: (col: string, val: unknown) => {
      const rows = installmentsFixture.filter((r) => (r as any)[col] === val);
      const chain: any = { ...b, order: () => Promise.resolve({ data: rows, error: null }) };
      return chain;
    },
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "memberships") return makeMembershipsBuilder();
      if (table === "installments") return makeInstallmentsBuilder();
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import { CustomerDashboardBody } from "@/components/customer/CustomerDashboardBody";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function baseMembership(overrides: Partial<MembershipFixture> = {}): MembershipFixture {
  return {
    id: "mem-owner-1",
    membership_number: "ARE-2601-ABC123",
    member_display_id: "AR654321",
    coupon_no: "4242",
    status: "active",
    start_date: "2026-01-15",
    end_date: null,
    advance_paid: 5000,
    total_amount: 60000,
    paid_amount: 15000,
    user_id: OWNER_ID,
    membership_plans: { name: "Gold", monthly_installment: 5000, duration_months: 12 },
    ...overrides,
  };
}

beforeEach(() => {
  sessionUserId = OWNER_ID;
  lastEq.table = "";
  lastEq.col = undefined;
  lastEq.val = undefined;
  membershipsFixture = [];
  installmentsFixture = [];
});

afterEach(() => cleanup());

describe("CustomerDashboardBody — membership ID + Coupon binding", () => {
  it("renders the ID No and Coupon No from the signed-in customer's membership row", async () => {
    membershipsFixture = [baseMembership()];
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <CustomerDashboardBody />
      </QueryClientProvider>,
    );

    // Membership number is unique to this test's fixture.
    expect(await screen.findByText(/ARE-2601-ABC123/)).toBeTruthy();
    // The exact ID No and Coupon No values render verbatim.
    expect(screen.getByText("AR654321")).toBeTruthy();
    expect(screen.getByText("4242")).toBeTruthy();

    // Query was scoped to the signed-in user's id (not the other customer).
    expect(lastEq).toMatchObject({ table: "memberships", col: "user_id", val: OWNER_ID });
  });

  it("shows the empty/onboarding state (never any other customer's ID) when the current user has no memberships", async () => {
    // The fixture contains ONLY another customer's membership. Because the
    // mock respects the .eq('user_id', ...) filter, the component receives
    // an empty result — same as production RLS.
    membershipsFixture = [
      baseMembership({
        id: "mem-other-1",
        user_id: OTHER_ID,
        member_display_id: "AR999999",
        coupon_no: "9999",
        membership_number: "ARE-2601-OTHER1",
      }),
    ];

    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <CustomerDashboardBody />
      </QueryClientProvider>,
    );

    // Empty-state copy from CustomerDashboardBody
    expect(await screen.findByText(/don't have an active membership yet/i)).toBeTruthy();

    // The other customer's ID/coupon must never appear on screen.
    expect(screen.queryByText("AR999999")).toBeNull();
    expect(screen.queryByText("9999")).toBeNull();
    expect(screen.queryByText(/ARE-2601-OTHER1/)).toBeNull();

    expect(lastEq).toMatchObject({ col: "user_id", val: OWNER_ID });
  });

  it("throws when a returned row's user_id doesn't match the session (defense-in-depth guard)", async () => {
    // Simulate a broken RLS / hostile response where a foreign row leaks
    // through. The queryFn's explicit check must reject it before render,
    // so no foreign ID No or Coupon No ever reaches the DOM.
    const foreign = baseMembership({
      id: "mem-foreign",
      user_id: OTHER_ID,
      member_display_id: "AR888888",
      coupon_no: "8888",
      membership_number: "ARE-2601-LEAK",
    });
    // Bypass the mock's eq() filter by handing the builder rows that
    // already ignore the filter: overwrite the memberships builder just
    // for this test.
    membershipsFixture = [foreign];
    // Monkey-patch the from() to return an unfiltered builder for memberships.
    const { supabase } = await import("@/integrations/supabase/client");
    const originalFrom = supabase.from;
    (supabase as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "memberships") {
        const b: any = {
          select: () => b,
          eq: () => b, // ignore the filter -> row leaks through
          order: () => Promise.resolve({ data: membershipsFixture, error: null }),
        };
        return b;
      }
      return (originalFrom as (t: string) => unknown)(table);
    };

    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <CustomerDashboardBody />
      </QueryClientProvider>,
    );

    // Wait until React Query has settled the errored query.
    await waitFor(() => {
      const state = qc.getQueryState(["customer-dash-membership", OWNER_ID]);
      expect(state?.status).toBe("error");
    });
    expect(
      qc.getQueryState(["customer-dash-membership", OWNER_ID])?.error,
    ).toBeInstanceOf(Error);

    // The foreign ID / coupon must never be rendered.
    expect(screen.queryByText("AR888888")).toBeNull();
    expect(screen.queryByText("8888")).toBeNull();

    // Restore the mock for later tests.
    (supabase as unknown as { from: unknown }).from = originalFrom;
  });
});
