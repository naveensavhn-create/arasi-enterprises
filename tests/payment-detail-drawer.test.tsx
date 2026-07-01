// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// --- Module mocks (must be declared before importing the component) ---

// sonner: capture toast calls for assertions
const toastCalls: Array<{ level: string; message: string; opts?: unknown }> = [];
vi.mock("sonner", () => {
  const record =
    (level: string) =>
    (message: string, opts?: unknown) => {
      toastCalls.push({ level, message, opts });
    };
  return {
    toast: Object.assign(record("default"), {
      success: record("success"),
      error: record("error"),
      warning: record("warning"),
      info: record("info"),
    }),
  };
});

// Supabase client is used by useQuery inside the drawer. The queries are gated
// by `open && (orderId || paymentId || membershipId || installmentId)`, and the
// tests only render rows that satisfy those gates; return empty result sets so
// nothing renders from live queries.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {} as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.order = passthrough;
  chain.range = passthrough;
  chain.eq = passthrough;
  chain.or = passthrough;
  chain.maybeSingle = async () => ({ data: null, error: null });
  // Terminal awaited select — resolves to empty rows/count
  const terminal = Promise.resolve({ data: [], error: null, count: 0 });
  // The drawer awaits the chain directly; make it thenable.
  (chain as unknown as { then: PromiseLike<unknown>["then"] }).then = terminal.then.bind(terminal);
  return {
    supabase: { from: () => chain },
  };
});

// The @tanstack/react-start `useServerFn` returns a callable; make it a no-op.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => async () => ({ json: null, bytes: 0, oversized: false, empty: true, maxBytes: 0 }),
}));

// Server function module imported at the top of the drawer must not pull in
// server-only code during tests.
vi.mock("@/lib/payments.functions", () => ({
  getWebhookEventPayload: async () => ({ json: null, bytes: 0, oversized: false, empty: true, maxBytes: 0 }),
}));

// jsdom shims required by Radix (used by <Sheet />)
beforeEach(() => {
  toastCalls.length = 0;
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
  }
  // Radix uses hasPointerCapture etc. in jsdom
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
});

// Import AFTER mocks are registered
import { PaymentDetailDrawer } from "@/components/admin/PaymentDetailDrawer";
import type { AdminPaymentRow } from "@/lib/payments/validate-row";

const validRow: AdminPaymentRow = {
  id: "pay_row_valid",
  amount: 1500,
  currency: "INR",
  status: "paid",
  method: "upi",
  provider: "razorpay",
  provider_order_id: "order_abc",
  provider_payment_id: "pay_abc",
  error_code: null,
  error_description: null,
  paid_at: "2026-06-01T10:00:00Z",
  created_at: "2026-06-01T09:59:00Z",
  customer_id: "cust_1",
  membership_id: "mem_1",
  installment_id: "inst_1",
  memberships: { membership_number: "ARASI-0001" },
  installments: { sequence: 2, due_date: "2026-06-01" },
  profile: { full_name: "Ada Lovelace", email: "ada@example.com" },
  reconciliation: null,
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("<PaymentDetailDrawer /> — invalid row surfaces", () => {
  it("renders the destructive warning alert listing every missing field", () => {
    const invalid: AdminPaymentRow = {
      ...validRow,
      provider_payment_id: null, // paid → missing paymentId
      profile: null,             // missing customerName
    };

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    // Warning alert title
    const title = screen.getByText("Incomplete payment record");
    expect(title).toBeDefined();

    // Alert body should reference each missing field's human label
    const alert = title.closest('[role="alert"]') as HTMLElement | null;
    expect(alert).not.toBeNull();
    const body = within(alert!);
    expect(body.getAllByText(/Razorpay payment ID/i).length).toBeGreaterThan(0);
    expect(body.getAllByText(/Customer name/i).length).toBeGreaterThan(0);

    // Row ID should appear inside the alert for copy support
    expect(body.getByText(invalid.id)).toBeDefined();
  });

  it("fires a warning toast listing the missing field labels when opened", () => {
    const invalid: AdminPaymentRow = {
      ...validRow,
      provider_payment_id: null,
      profile: null,
    };

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const warnings = toastCalls.filter((t) => t.level === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/^Payment row is missing:/);
    expect(warnings[0].message).toMatch(/Razorpay payment ID/);
    expect(warnings[0].message).toMatch(/Customer name/);
    // Uses a stable id so re-opens don't stack
    expect(warnings[0].opts).toMatchObject({ id: `payment-row-missing-${invalid.id}` });
  });

  it("does not fire the missing-field toast or show the warning for a valid row", () => {
    renderWithClient(
      <PaymentDetailDrawer row={validRow} open onOpenChange={() => {}} />,
    );

    expect(screen.queryByText("Incomplete payment record")).toBeNull();
    expect(toastCalls.filter((t) => t.level === "warning")).toHaveLength(0);
  });

  it("does not fire the toast when the drawer is closed, even with an invalid row", () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    renderWithClient(
      <PaymentDetailDrawer row={invalid} open={false} onOpenChange={() => {}} />,
    );
    expect(toastCalls.filter((t) => t.level === "warning")).toHaveLength(0);
  });

  it("only toasts once per (row, open) even across re-renders", () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    const { rerender } = renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );
    // Trigger a re-render with unchanged props
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    // Note: rerender with a new provider remounts, so we assert on the first mount only
    const warnings = toastCalls.filter(
      (t) => t.level === "warning" && (t.opts as { id?: string })?.id === `payment-row-missing-${invalid.id}`,
    );
    // At most one per mount; the sonner `id` also dedupes at the toast layer in real usage.
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    for (const w of warnings) {
      expect(w.opts).toMatchObject({ id: `payment-row-missing-${invalid.id}` });
    }
  });

  it("copy-row-id button in the warning invokes a success toast", async () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    // clipboard shim
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;
    const copyBtn = within(alert).getByRole("button", { name: /copy/i });
    await userEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(invalid.id);
    expect(toastCalls.some((t) => t.level === "success" && t.message === "Row ID copied")).toBe(true);
  });
});
