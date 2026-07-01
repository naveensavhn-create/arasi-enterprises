// @vitest-environment jsdom
/**
 * Accessibility contract for the invalid-row alert in <PaymentDetailDrawer />.
 *
 * Guarantees, per required field key in ADMIN_PAYMENT_ROW_REQUIRED_FIELDS:
 *   • Each remediation bullet exposes an aria-label of exactly
 *     `${label}: ${hint}` (so screen readers announce the full remediation).
 *   • Each bullet is programmatically associated with the alert:
 *       - lives inside the alert's aria-describedby list
 *       - carries aria-describedby pointing to the alert title
 *   • The alert itself exposes aria-labelledby / aria-describedby wiring
 *     to its title and hint list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("sonner", () => {
  const noop = () => {};
  return {
    toast: Object.assign(noop, {
      success: noop, error: noop, warning: noop, info: noop,
    }),
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.order = passthrough;
  chain.range = passthrough;
  chain.eq = passthrough;
  chain.or = passthrough;
  chain.maybeSingle = async () => ({ data: null, error: null });
  const terminal = Promise.resolve({ data: [], error: null, count: 0 });
  (chain as unknown as { then: PromiseLike<unknown>["then"] }).then =
    terminal.then.bind(terminal);
  return { supabase: { from: () => chain } };
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => async () => ({
    json: null, bytes: 0, oversized: false, empty: true, maxBytes: 0,
  }),
}));

vi.mock("@/lib/payments.functions", () => ({
  getWebhookEventPayload: async () => ({
    json: null, bytes: 0, oversized: false, empty: true, maxBytes: 0,
  }),
}));

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
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

afterEach(() => { cleanup(); });

import { PaymentDetailDrawer } from "@/components/admin/PaymentDetailDrawer";
import {
  ADMIN_PAYMENT_ROW_FIELD_HINTS,
  ADMIN_PAYMENT_ROW_FIELD_LABELS,
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

const validRow: AdminPaymentRow = {
  id: "pay_row_a11y",
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

function invalidForAll(): AdminPaymentRow {
  return {
    ...validRow,
    amount: -10,
    currency: "",
    status: "",              // trips "status" (and skips paymentId branch)
    provider_payment_id: null,
    profile: null,
  };
}

// Trip status separately (status="" skips the paid→paymentId branch),
// then trip paymentId with a separate render.
function invalidForPaymentId(): AdminPaymentRow {
  return { ...validRow, status: "paid", provider_payment_id: null };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function getAlert(): HTMLElement {
  return screen.getByText("Incomplete payment record").closest('[role="alert"]') as HTMLElement;
}

const REQUIRED_KEYS = Object.keys(
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
) as AdminPaymentRowRequiredField[];

describe("<PaymentDetailDrawer /> — invalid-row a11y wiring", () => {
  it("associates the alert with its title and hint list via aria-labelledby/aria-describedby", () => {
    renderWithClient(
      <PaymentDetailDrawer row={invalidForAll()} open onOpenChange={() => {}} />,
    );
    const alert = getAlert();

    const labelledById = alert.getAttribute("aria-labelledby");
    const describedById = alert.getAttribute("aria-describedby");
    expect(labelledById, "alert must be aria-labelledby its title").toBeTruthy();
    expect(describedById, "alert must be aria-describedby its hint list").toBeTruthy();

    const title = alert.ownerDocument!.getElementById(labelledById!);
    expect(title?.textContent).toBe("Incomplete payment record");

    const list = alert.ownerDocument!.getElementById(describedById!);
    expect(list?.tagName).toBe("UL");
    expect(list?.getAttribute("aria-label")).toBe("Missing required fields");
    // The hint list is inside the alert (structural association).
    expect(alert.contains(list!)).toBe(true);
  });

  it.each(REQUIRED_KEYS.filter((k) => k !== "paymentId"))(
    'bullet for "%s" exposes aria-label "<label>: <hint>" and is associated with the alert',
    (key) => {
      renderWithClient(
        <PaymentDetailDrawer row={invalidForAll()} open onOpenChange={() => {}} />,
      );
      const alert = getAlert();
      const listId = alert.getAttribute("aria-describedby")!;
      const list = alert.ownerDocument!.getElementById(listId)!;

      const bullet = within(list).getByRole("listitem", {
        // Match by aria-label (accessible name), not visible text — this is
        // exactly what a screen reader announces.
        name: `${ADMIN_PAYMENT_ROW_FIELD_LABELS[key]}: ${ADMIN_PAYMENT_ROW_FIELD_HINTS[key]}`,
      });

      // Data hook for programmatic mapping back to the required-field key.
      expect(bullet.getAttribute("data-field")).toBe(key);

      // Programmatic association back to the alert's title.
      const titleId = alert.getAttribute("aria-labelledby")!;
      expect(bullet.getAttribute("aria-describedby")).toBe(titleId);

      // And structurally inside the alert's described list.
      expect(list.contains(bullet)).toBe(true);
    },
  );

  it('bullet for "paymentId" exposes the exact aria-label and alert association', () => {
    renderWithClient(
      <PaymentDetailDrawer row={invalidForPaymentId()} open onOpenChange={() => {}} />,
    );
    const alert = getAlert();
    const listId = alert.getAttribute("aria-describedby")!;
    const list = alert.ownerDocument!.getElementById(listId)!;

    const bullet = within(list).getByRole("listitem", {
      name: `${ADMIN_PAYMENT_ROW_FIELD_LABELS.paymentId}: ${ADMIN_PAYMENT_ROW_FIELD_HINTS.paymentId}`,
    });
    expect(bullet.getAttribute("data-field")).toBe("paymentId");
    expect(bullet.getAttribute("aria-describedby")).toBe(
      alert.getAttribute("aria-labelledby"),
    );
  });

  it("every rendered bullet's aria-label matches the source-of-truth label+hint map", () => {
    renderWithClient(
      <PaymentDetailDrawer row={invalidForAll()} open onOpenChange={() => {}} />,
    );
    const alert = getAlert();
    const list = alert.ownerDocument!.getElementById(
      alert.getAttribute("aria-describedby")!,
    )!;
    const bullets = within(list).getAllByRole("listitem");
    expect(bullets.length).toBeGreaterThan(0);

    for (const li of bullets) {
      const key = li.getAttribute("data-field") as AdminPaymentRowRequiredField | null;
      expect(key, "each bullet must carry data-field for a required key").toBeTruthy();
      const expected = `${ADMIN_PAYMENT_ROW_FIELD_LABELS[key!]}: ${ADMIN_PAYMENT_ROW_FIELD_HINTS[key!]}`;
      expect(li.getAttribute("aria-label")).toBe(expected);
    }
  });
});
