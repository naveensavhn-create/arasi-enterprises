// @vitest-environment jsdom
/**
 * Accessibility tests for CustomerDashboardBody's loading and empty
 * states. Verifies:
 *   - Loading skeleton exposes a polite live region and an sr-only label.
 *   - Empty state uses semantic headings, an ordered list of steps, and
 *     decorative icons are hidden from assistive tech.
 *   - Every CTA is a real link with an accessible name, reachable by
 *     keyboard Tab, focusable, and activatable via Enter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";

let sessionUserId: string | null = OWNER_ID;
vi.mock("@/lib/auth", () => ({
  useSession: () => ({
    session: sessionUserId
      ? {
          user: {
            id: sessionUserId,
            email: "member@example.com",
            user_metadata: { full_name: "Ada Lovelace" },
          },
        }
      : null,
  }),
}));

// Record Link targets so we can assert CTA destinations without a router.
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

// --- Supabase mock knobs ---------------------------------------------------
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

let membershipsFixture: MembershipRow[] = [];
let holdMembershipsForever = false;

vi.mock("@/integrations/supabase/client", () => {
  const makeMemberships = () => {
    const b: any = {
      select: () => b,
      order: () =>
        holdMembershipsForever
          ? new Promise(() => {}) // never resolves -> loading state
          : Promise.resolve({ data: membershipsFixture, error: null }),
      eq: (col: string, val: unknown) => {
        const rows = membershipsFixture.filter((r) => (r as any)[col] === val);
        return {
          ...b,
          order: () =>
            holdMembershipsForever
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
      order: () => Promise.resolve({ data: [], error: null }),
      eq: () => ({ ...b, order: () => Promise.resolve({ data: [], error: null }) }),
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

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function renderDash() {
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <CustomerDashboardBody />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionUserId = OWNER_ID;
  membershipsFixture = [];
  holdMembershipsForever = false;
});
afterEach(() => cleanup());

describe("CustomerDashboardBody — loading state a11y", () => {
  it("exposes a polite status live region with an accessible loading label", () => {
    holdMembershipsForever = true;
    renderDash();

    const status = screen.getByRole("status", { name: /loading your dashboard/i });
    expect(status).toBeTruthy();
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-label")).toMatch(/loading your dashboard/i);
    // A visually hidden text node backs up the aria-label for readers that
    // announce visible text rather than the label attribute.
    const srOnly = status.querySelector(".sr-only");
    expect(srOnly?.textContent ?? "").toMatch(/loading your dashboard/i);
  });

  it("does not render any interactive controls or headings while loading", () => {
    holdMembershipsForever = true;
    renderDash();

    // No CTAs should be present in the skeleton — screen readers shouldn't
    // land on a stale button while the dashboard is still hydrating.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});

describe("CustomerDashboardBody — empty state a11y", () => {
  it("uses a single h2 welcome heading with the member's name", async () => {
    membershipsFixture = []; // signed-in but no memberships => empty state
    renderDash();

    const heading = await screen.findByRole("heading", {
      level: 2,
      name: /welcome,\s*ada lovelace/i,
    });
    expect(heading).toBeTruthy();
    // Exactly one h2 in the empty state — no skipped levels below it.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("renders the onboarding steps as a semantic ordered list", async () => {
    renderDash();
    // Wait for the empty state to appear.
    await screen.findByRole("heading", { level: 2, name: /welcome/i });

    const lists = document.querySelectorAll("ol");
    expect(lists.length).toBeGreaterThanOrEqual(1);
    const steps = lists[0].querySelectorAll("li");
    expect(steps.length).toBe(3);
    expect(steps[0].textContent).toMatch(/browse membership plans/i);
  });

  it("hides decorative icons and step numerals from assistive tech", async () => {
    renderDash();
    await screen.findByRole("heading", { level: 2, name: /welcome/i });

    const hidden = document.querySelectorAll('[aria-hidden="true"]');
    // Sparkles hero icon + gradient bar + ArrowRight + 3 numbered bullets = >= 5.
    expect(hidden.length).toBeGreaterThanOrEqual(5);
  });

  it("exposes both CTAs as real links with accessible names and correct destinations", async () => {
    renderDash();
    await screen.findByRole("heading", { level: 2, name: /welcome/i });

    const browse = screen.getByRole("link", { name: /browse plans/i });
    const learn = screen.getByRole("link", { name: /learn how it works/i });

    expect(browse.tagName).toBe("A");
    expect(learn.tagName).toBe("A");
    expect(browse.getAttribute("href")).toBe("/customer/enroll");
    expect(learn.getAttribute("href")).toBe("/customer/membership");

    // Accessible name must not be blank (guards against icon-only regressions).
    expect((browse.textContent ?? "").trim().length).toBeGreaterThan(0);
    expect((learn.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps the CTAs reachable via keyboard Tab in DOM order", async () => {
    renderDash();
    await screen.findByRole("heading", { level: 2, name: /welcome/i });

    const browse = screen.getByRole("link", { name: /browse plans/i });
    const learn = screen.getByRole("link", { name: /learn how it works/i });

    // No positive tabIndex overrides — links participate in natural order.
    expect(browse.getAttribute("tabindex")).not.toMatch(/^[1-9]/);
    expect(learn.getAttribute("tabindex")).not.toMatch(/^[1-9]/);

    const user = userEvent.setup();
    // Tab through until we reach the first CTA, capped so a bug can't hang.
    let hops = 0;
    while (document.activeElement !== browse && hops < 10) {
      await user.tab();
      hops++;
    }
    expect(document.activeElement).toBe(browse);

    await user.tab();
    expect(document.activeElement).toBe(learn);
  });

  it("activates the primary CTA via Enter (screen-reader style)", async () => {
    renderDash();
    await screen.findByRole("heading", { level: 2, name: /welcome/i });

    const browse = screen.getByRole("link", { name: /browse plans/i }) as HTMLAnchorElement;
    let clicked = false;
    browse.addEventListener("click", (e) => {
      e.preventDefault();
      clicked = true;
    });

    browse.focus();
    expect(document.activeElement).toBe(browse);

    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(clicked).toBe(true));
  });
});
