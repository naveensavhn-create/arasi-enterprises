// @vitest-environment jsdom
/**
 * End-to-end user flow: an admin opens the Payment Detail drawer for each
 * payment row that is missing a required field. For every required field
 * declared in `ADMIN_PAYMENT_ROW_REQUIRED_FIELDS`, the test:
 *
 *   1. Renders a mini "payments list" harness (one button per invalid row).
 *   2. Simulates the admin clicking "View details" for that row.
 *   3. Waits for the drawer to open (Sheet portal).
 *   4. Asserts the remediation UI state is correct:
 *        - destructive Alert is present with the "Incomplete payment record"
 *          heading and correct ARIA wiring,
 *        - exactly the bullet for that field is rendered with the exact
 *          label + hint copy from the source-of-truth map,
 *        - the missing-field warning toast fires exactly once per open,
 *          keyed by row id,
 *        - closing the drawer via the Close button hides the Alert.
 *   5. Then opens the *next* invalid row and repeats — verifying the
 *      toast keying (one toast per row.id) and that no state leaks between
 *      openings.
 *
 * This gives us user-flow coverage on top of the component-level tests in
 * `payment-detail-drawer-hints.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// --- Module mocks (must be registered before importing the component) ---

const toastCalls: Array<{ level: string; message: string; id?: string }> = [];

vi.mock("sonner", () => {
  const push =
    (level: string) =>
    (message: string, opts?: { id?: string }) => {
      toastCalls.push({ level, message, id: opts?.id });
    };
  const toast = Object.assign(push("info"), {
    success: push("success"),
    error: push("error"),
    warning: push("warning"),
    info: push("info"),
  });
  return { toast };
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
    json: null,
    bytes: 0,
    oversized: false,
    empty: true,
    maxBytes: 0,
  }),
}));

vi.mock("@/lib/payments.functions", () => ({
  getWebhookEventPayload: async () => ({
    json: null,
    bytes: 0,
    oversized: false,
    empty: true,
    maxBytes: 0,
  }),
}));

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

// Import AFTER mocks
import { PaymentDetailDrawer } from "@/components/admin/PaymentDetailDrawer";
import {
  ADMIN_PAYMENT_ROW_FIELD_HINTS,
  ADMIN_PAYMENT_ROW_FIELD_LABELS,
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

const baseRow: AdminPaymentRow = {
  id: "pay_row_e2e",
  amount: 1500,
  currency: "INR",
  status: "paid",
  method: "upi",
  provider: "razorpay",
  provider_order_id: "order_e2e",
  provider_payment_id: "pay_e2e",
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

function makeInvalidRowFor(
  key: AdminPaymentRowRequiredField,
  id: string,
): AdminPaymentRow {
  const row = { ...baseRow, id };
  switch (key) {
    case "amount":
      return { ...row, amount: -1 };
    case "currency":
      return { ...row, currency: "" };
    case "status":
      return { ...row, status: "" };
    case "paymentId":
      return { ...row, status: "paid", provider_payment_id: null };
    case "customerName":
      return { ...row, profile: null };
  }
}

const REQUIRED_KEYS = Object.keys(
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
) as AdminPaymentRowRequiredField[];

/**
 * A minimal harness that mirrors how the real admin payments page opens
 * the drawer: a list of rows, each with a "View details" button that
 * flips local state. This is the E2E surface under test.
 */
function PaymentsHarness({ rows }: { rows: AdminPaymentRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = rows.find((r) => r.id === openId) ?? null;
  return (
    <>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              aria-label={`View details for ${r.id}`}
              onClick={() => setOpenId(r.id)}
            >
              View details {r.id}
            </button>
          </li>
        ))}
      </ul>
      <PaymentDetailDrawer
        row={current}
        open={openId !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
      />
    </>
  );
}

function renderHarness(rows: AdminPaymentRow[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PaymentsHarness rows={rows} />
    </QueryClientProvider>,
  );
}

async function getOpenAlert(): Promise<HTMLElement> {
  const heading = await screen.findByText("Incomplete payment record");
  const alert = heading.closest('[role="alert"]') as HTMLElement | null;
  if (!alert) throw new Error("invalid-row alert not rendered");
  return alert;
}

describe("PaymentDetailDrawer — end-to-end remediation flow per required field", () => {
  for (const key of REQUIRED_KEYS) {
    const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];

    it(`opens drawer for a row missing "${key}" and shows the remediation UI, then closes cleanly`, async () => {
      const user = userEvent.setup();
      const rowId = `row-missing-${key}`;
      const invalid = makeInvalidRowFor(key, rowId);
      renderHarness([invalid]);

      // 1. Click "View details" for the invalid row.
      await user.click(
        screen.getByRole("button", { name: `View details for ${rowId}` }),
      );

      // 2. Drawer opens; destructive Alert with ARIA wiring is present.
      const alert = await getOpenAlert();
      expect(alert.getAttribute("id")).toBe("payment-invalid-row-alert");
      expect(alert.getAttribute("aria-labelledby")).toBe(
        "payment-invalid-row-alert-title",
      );

      // 3. Bullet for THIS field renders with exact label + hint copy.
      const bullets = within(alert).getAllByRole("listitem");
      const bullet = bullets.find((li) =>
        (li.textContent ?? "").includes(meta.label),
      );
      expect(bullet, `missing bullet for ${key}`).toBeTruthy();
      expect(bullet!.textContent).toContain(
        ADMIN_PAYMENT_ROW_FIELD_LABELS[key],
      );
      expect(bullet!.textContent).toContain(
        ADMIN_PAYMENT_ROW_FIELD_HINTS[key],
      );

      // 4. Missing-field warning toast fired exactly once, keyed by row id.
      await waitFor(() => {
        const warnings = toastCalls.filter(
          (t) => t.level === "warning" && t.id === `payment-row-missing-${rowId}`,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain(
          ADMIN_PAYMENT_ROW_FIELD_LABELS[key],
        );
      });

      // 5. Close the drawer; the Alert must unmount.
      await user.click(screen.getByRole("button", { name: /close/i }));
      await waitForElementToBeRemoved(() =>
        screen.queryByText("Incomplete payment record"),
      );
    });
  }

  it("stepping through multiple invalid rows shows each row's own remediation and toasts once per row", async () => {
    const user = userEvent.setup();
    const rows = REQUIRED_KEYS.map((k) => makeInvalidRowFor(k, `seq-${k}`));
    renderHarness(rows);

    for (const key of REQUIRED_KEYS) {
      const rowId = `seq-${key}`;
      await user.click(
        screen.getByRole("button", { name: `View details for ${rowId}` }),
      );

      const alert = await getOpenAlert();
      const bullets = within(alert).getAllByRole("listitem");
      const bullet = bullets.find((li) =>
        (li.textContent ?? "").includes(
          ADMIN_PAYMENT_ROW_FIELD_LABELS[key],
        ),
      );
      expect(bullet, `bullet for ${key} on row ${rowId}`).toBeTruthy();
      expect(bullet!.textContent).toContain(
        ADMIN_PAYMENT_ROW_FIELD_HINTS[key],
      );

      await user.click(screen.getByRole("button", { name: /close/i }));
      await waitForElementToBeRemoved(() =>
        screen.queryByText("Incomplete payment record"),
      );
    }

    // Exactly one warning toast per row.id — no dedupe collisions, no spam.
    for (const key of REQUIRED_KEYS) {
      const rowId = `seq-${key}`;
      const warnings = toastCalls.filter(
        (t) => t.level === "warning" && t.id === `payment-row-missing-${rowId}`,
      );
      expect(warnings, `expected 1 warning for ${rowId}`).toHaveLength(1);
    }
  });
});
