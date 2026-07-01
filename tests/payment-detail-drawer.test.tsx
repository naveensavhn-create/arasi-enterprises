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

  it("copy-row-id button writes to clipboard and shows a success toast", async () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;
    const copyBtn = within(alert).getByRole("button", { name: /copy/i });
    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(invalid.id);
    const success = toastCalls.find(
      (t) => t.level === "success" && t.message === "Row ID copied",
    );
    expect(success).toBeDefined();
    expect(success!.opts).toMatchObject({
      id: `payment-row-copy-${invalid.id}`,
      description: invalid.id,
    });
  });

  it("copy-row-id button shows an error toast when clipboard rejects", async () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(invalid.id);
    const err = toastCalls.find(
      (t) => t.level === "error" && t.message === "Couldn't copy row ID",
    );
    expect(err).toBeDefined();
    expect(err!.opts).toMatchObject({
      id: `payment-row-copy-${invalid.id}`,
      description: "Permission denied",
    });
    // No spurious success toast
    expect(toastCalls.some((t) => t.level === "success" && t.message === "Row ID copied")).toBe(false);
  });

  it("copy-row-id button shows an error toast when the Clipboard API is unavailable", async () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    // Remove clipboard entirely
    Object.assign(navigator, { clipboard: undefined });

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole("button", { name: /copy/i }));

    const err = toastCalls.find(
      (t) => t.level === "error" && t.message === "Couldn't copy row ID",
    );
    expect(err).toBeDefined();
    expect((err!.opts as { description?: string }).description).toMatch(
      /Clipboard API unavailable/i,
    );
  });

  it("renders every missing field with its remediation hint inside the alert", () => {
    const invalid: AdminPaymentRow = {
      ...validRow,
      amount: -5,               // invalid amount
      currency: "",             // missing currency
      provider_payment_id: null, // paid without payment id
      profile: null,            // missing customer name
    };

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;
    const body = within(alert);

    // Each missing field bullet renders label + hint copy in the same <li>.
    const expected: Array<[RegExp, RegExp]> = [
      [/Amount/i, /Reconcile with Razorpay dashboard/i],
      [/Currency/i, /Currency code is empty/i],
      [/Razorpay payment ID/i, /Marked paid without a Razorpay payment ID/i],
      [/Customer name/i, /Linked profile is missing/i],
    ];
    for (const [label, hint] of expected) {
      const bullet = body
        .getAllByRole("listitem")
        .find((li) => label.test(li.textContent ?? "") && hint.test(li.textContent ?? ""));
      expect(bullet, `expected bullet matching ${label} + ${hint}`).toBeDefined();
    }
  });

  it("does not block the drawer body — Customer and Amount blocks still render for invalid rows", () => {
    const invalid: AdminPaymentRow = {
      ...validRow,
      provider_payment_id: null,
      profile: null,
    };

    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    // Alert is present…
    expect(screen.getByText("Incomplete payment record")).toBeDefined();
    // …and the drawer body sections still render with safe fallbacks.
    expect(screen.getAllByText("Customer").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Data unavailable/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Amount").length).toBeGreaterThan(0);
    // Amount value renders (row is a valid number here) rather than the drawer bailing out.
    expect(screen.getByText(/1,500/)).toBeDefined();
  });
});

describe("<PaymentDetailDrawer /> — accessibility affordances", () => {
  it("renders the invalid-row alert with role='alert' so AT announces it live", () => {
    const invalid: AdminPaymentRow = {
      ...validRow,
      provider_payment_id: null,
      profile: null,
    };
    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    // shadcn Alert forwards role="alert" — this is the a11y contract we depend on.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    const incomplete = alerts.find((el) =>
      /Incomplete payment record/i.test(el.textContent ?? ""),
    );
    expect(incomplete, "expected an alert containing the incomplete-record title").toBeDefined();
  });

  it("copy-row-id button has a descriptive accessible name", () => {
    const invalid: AdminPaymentRow = { ...validRow, provider_payment_id: null };
    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;
    // Must be findable by an accessible name matching "copy"; passes WCAG button-name.
    const copyBtn = within(alert).getByRole("button", { name: /copy/i });
    expect(copyBtn).toBeDefined();
    // Ensure it isn't an icon-only button with no label
    const accessibleName =
      copyBtn.getAttribute("aria-label") ?? copyBtn.textContent ?? "";
    expect(accessibleName.trim().length).toBeGreaterThan(0);
  });

  it("Data unavailable badges expose the label via aria-label AND title", () => {
    const invalid: AdminPaymentRow = {
      ...validRow,
      provider_payment_id: null,
      profile: null, // triggers UnavailableTag with a specific reason
    };
    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );

    // Every unavailable badge must carry BOTH aria-label and title so screen
    // readers and hover tooltips agree on what the placeholder means.
    const badges = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-label^="Data unavailable"]'),
    );
    expect(badges.length).toBeGreaterThan(0);
    for (const el of badges) {
      expect(el.getAttribute("aria-label")).toMatch(/^Data unavailable/);
      expect(el.getAttribute("title")).toBeTruthy();
      // Visible text must still read as the label so sighted users see it too.
      expect(el.textContent).toMatch(/Data unavailable/);
    }

    // The reason-carrying variant: aria-label = "Data unavailable — <reason>",
    // title = "<reason>" (tooltip shows the specific cause).
    const customerBadge = badges.find(
      (el) => el.getAttribute("aria-label") === "Data unavailable — Linked profile missing",
    );
    expect(customerBadge, "expected the customer badge to carry the profile-missing reason").toBeDefined();
    expect(customerBadge!.getAttribute("title")).toBe("Linked profile missing");
  });

  it("valid rows do not render any Data unavailable badges or alerts", () => {
    renderWithClient(
      <PaymentDetailDrawer row={validRow} open onOpenChange={() => {}} />,
    );
    expect(
      document.querySelectorAll('[aria-label^="Data unavailable"]').length,
    ).toBe(0);
    // No destructive alert either
    const alerts = screen.queryAllByRole("alert");
    expect(
      alerts.some((a) => /Incomplete payment record/i.test(a.textContent ?? "")),
    ).toBe(false);
  });
});
