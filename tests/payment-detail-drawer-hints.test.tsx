// @vitest-environment jsdom
/**
 * Verifies the invalid-row alert renders the *exact* remediation hint for
 * every required field derived from `ADMIN_PAYMENT_ROW_REQUIRED_FIELDS`.
 *
 * Two axes are covered per required key:
 *   1. Display-rule triggers on a typed `AdminPaymentRow` (drawer path).
 *   2. Schema-parse failures on an `unknown` payload where the Zod issue's
 *      `path[0]` matches the required field's `schemaPath` — asserting the
 *      schema-path → UI-key translation surfaces the same hint copy.
 *
 * These tests intentionally read `ADMIN_PAYMENT_ROW_REQUIRED_FIELDS` at
 * runtime so they stay in lockstep with the source map: adding a new
 * required field forces a matching display-rule trigger below or the loop
 * will fail (unknown field).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// --- Module mocks (must be registered before importing the component) ---

vi.mock("sonner", () => {
  const noop = () => {};
  return {
    toast: Object.assign(noop, {
      success: noop,
      error: noop,
      warning: noop,
      info: noop,
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
  adminPaymentRowSchema,
  validateAdminPaymentRow,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

const validRow: AdminPaymentRow = {
  id: "pay_row_hint",
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

/**
 * Builds an `AdminPaymentRow` that trips exactly one display rule so the
 * drawer surfaces a single missing-field bullet for `key`. Every required
 * key MUST have a case here; the exhaustive switch means adding a new key
 * to `ADMIN_PAYMENT_ROW_REQUIRED_FIELDS` fails typecheck until wired.
 */
function makeInvalidRowFor(key: AdminPaymentRowRequiredField): AdminPaymentRow {
  switch (key) {
    case "amount":
      return { ...validRow, amount: -1 };
    case "currency":
      return { ...validRow, currency: "" };
    case "status":
      // Blank status skips the paid→paymentId branch, isolating "status".
      return { ...validRow, status: "" };
    case "paymentId":
      return { ...validRow, status: "paid", provider_payment_id: null };
    case "customerName":
      return { ...validRow, profile: null };
  }
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function findBulletForLabel(alert: HTMLElement, label: string): HTMLElement {
  const bullets = within(alert).getAllByRole("listitem");
  const match = bullets.find((li) =>
    (li.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
  );
  if (!match) {
    throw new Error(
      `no bullet found for label "${label}". bullets=${bullets
        .map((b) => b.textContent)
        .join(" | ")}`,
    );
  }
  return match;
}

const REQUIRED_KEYS = Object.keys(
  ADMIN_PAYMENT_ROW_REQUIRED_FIELDS,
) as AdminPaymentRowRequiredField[];

describe("<PaymentDetailDrawer /> — exact remediation hint per required field", () => {
  for (const key of REQUIRED_KEYS) {
    const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];

    it(`shows the exact hint for "${key}" (schemaPath="${meta.schemaPath}")`, () => {
      const invalid = makeInvalidRowFor(key);
      renderWithClient(
        <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
      );

      const alert = screen
        .getByText("Incomplete payment record")
        .closest('[role="alert"]') as HTMLElement;
      expect(alert, "invalid-row alert must render").toBeTruthy();

      const bullet = findBulletForLabel(alert, meta.label);
      const text = bullet.textContent ?? "";

      // Exact label + exact hint from the source map — no paraphrasing.
      expect(text).toContain(ADMIN_PAYMENT_ROW_FIELD_LABELS[key]);
      expect(text).toContain(ADMIN_PAYMENT_ROW_FIELD_HINTS[key]);
      // And exactly what the source map declares (guards against drift).
      expect(text).toContain(meta.label);
      expect(text).toContain(meta.hint);
    });
  }

  it("renders label + hint for every required field when all rules are violated at once", () => {
    // Trip every rule in a single row and assert each bullet still carries
    // its own exact hint copy (no truncation, no shared/generic fallback).
    const invalid: AdminPaymentRow = {
      ...validRow,
      amount: -10,
      currency: "",
      status: "paid",           // keeps paid → paymentId rule active
      provider_payment_id: null,
      profile: null,
    };
    renderWithClient(
      <PaymentDetailDrawer row={invalid} open onOpenChange={() => {}} />,
    );
    const alert = screen
      .getByText("Incomplete payment record")
      .closest('[role="alert"]') as HTMLElement;

    // Status is the only key not tripped here — its bullet must NOT appear.
    for (const key of REQUIRED_KEYS) {
      if (key === "status") continue;
      const bullet = findBulletForLabel(alert, ADMIN_PAYMENT_ROW_FIELD_LABELS[key]);
      expect(bullet.textContent).toContain(ADMIN_PAYMENT_ROW_FIELD_HINTS[key]);
    }
    expect(
      within(alert)
        .getAllByRole("listitem")
        .some((li) => (li.textContent ?? "").includes(
          ADMIN_PAYMENT_ROW_FIELD_LABELS.status,
        )),
      "status bullet should not appear when status field is populated",
    ).toBe(false);
  });
});

describe("Zod schemaPath → required-field UI key mapping", () => {
  /**
   * For each required field, break the underlying schema key so the parse
   * fails at that path. `validateAdminPaymentRow` must translate the Zod
   * issue path back into the UI key, and the hint on that UI key must
   * match `ADMIN_PAYMENT_ROW_FIELD_HINTS`.
   */
  it("every schemaPath in the required-fields map exists on the schema", () => {
    const shape = adminPaymentRowSchema.shape;
    for (const key of REQUIRED_KEYS) {
      expect(shape).toHaveProperty(
        ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key].schemaPath,
      );
    }
  });

  it("a schema parse failure on each schemaPath surfaces the exact hint text", () => {
    // Distinct wrong-type payloads keyed by schemaPath. Only the schemaPaths
    // referenced by ADMIN_PAYMENT_ROW_REQUIRED_FIELDS need entries; iterating
    // the map keeps the two in lockstep.
    const breakers: Record<string, unknown> = {
      amount: "not-a-number",
      currency: 42,
      status: null,
      provider_payment_id: 123, // wrong type; also covers "paid without id"
      profile: "not-an-object",
    };

    for (const key of REQUIRED_KEYS) {
      const meta = ADMIN_PAYMENT_ROW_REQUIRED_FIELDS[key];
      const payload: Record<string, unknown> = {
        ...validRow,
        [meta.schemaPath]: breakers[meta.schemaPath],
      };
      const result = validateAdminPaymentRow(payload);
      expect(result.ok, `expected schema parse to fail for ${key}`).toBe(false);
      if (result.ok) continue;

      expect(
        result.missing,
        `schemaPath "${meta.schemaPath}" must translate to UI key "${key}"`,
      ).toContain(key);

      // The hint that would render in the drawer for this key is the exact
      // string on the source map — verified via the derived hint lookup.
      expect(ADMIN_PAYMENT_ROW_FIELD_HINTS[key]).toBe(meta.hint);
    }
  });
});
