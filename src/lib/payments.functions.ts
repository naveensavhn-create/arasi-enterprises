import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AdminPaymentRow } from "@/lib/payments/validate-row";


export async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/**
 * Payments-status filter helpers now live in `@/lib/payments/status-filter`
 * so browser components, cron routes, tests, and this server-fn module all
 * import the exact same cast format. Re-exported here for backwards-compat
 * with existing imports of `applyPaymentStatusEq` from this module.
 */
export {
  applyPaymentStatusEq,
  applyPaymentStatusIn,
  PAYMENT_STATUS_TEXT_COLUMN,
  PAYMENT_STATUSES,
  isPaymentStatus,
  coercePaymentStatus,
  coercePaymentStatuses,
} from "@/lib/payments/status-filter";
export type { PaymentStatus } from "@/lib/payments/status-filter";
import {
  applyPaymentStatusEq,
  coercePaymentStatusOrLog,
  type PaymentStatus,
} from "@/lib/payments/status-filter";



const SORT_COLUMNS = [
  "created_at",
  "paid_at",
  "amount",
  "status",
  "provider_order_id",
  "provider_payment_id",
  "customer_name",
] as const;
export type PaymentSortColumn = typeof SORT_COLUMNS[number];

const DATE_FIELDS = ["created", "webhook_processed"] as const;
export type PaymentDateField = typeof DATE_FIELDS[number];

// Untrusted `status` inputs (URL params, JSON bodies, form fields) are
// funneled through `coercePaymentStatus` so ONLY valid `payment_status`
// enum members reach `applyPaymentStatusEq`. Anything else — "", "all",
// wrong casing, unknown values — collapses to `undefined` (no-op filter).
// This is the single source of truth for the field's runtime contract;
// downstream helpers can assume the value is `PaymentStatus | undefined`.
const paymentStatusFilterSchema = z
  .unknown()
  .transform((v): PaymentStatus | undefined =>
    coercePaymentStatusOrLog(v, { source: "payments.functions:filter" }) ?? undefined,
  );


const baseFilterSchema = z.object({
  sortBy: z.enum(SORT_COLUMNS).default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: paymentStatusFilterSchema,
  from: z.string().optional(),
  to: z.string().optional(),
  dateField: z.enum(DATE_FIELDS).default("created"),
  q: z.string().optional(),
  orderId: z.string().optional(),
  paymentId: z.string().optional(),
  customer: z.string().optional(),
});

const pageSchema = baseFilterSchema.extend({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(5).max(200).default(25),
});

const exportSchema = baseFilterSchema.extend({
  limit: z.number().int().min(1).max(10_000).default(5000),
});

const CSV_HARD_CAP = 10_000;
const exportCsvSchema = baseFilterSchema.extend({
  scope: z.enum(["page", "filtered"]).default("filtered"),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(5).max(200).default(25),
});

/**
 * The row shape, Zod schema, and validation helpers live in the shared
 * client-safe module `@/lib/payments/validate-row` so both the ledger and
 * the detail drawer can import them without pulling in server code. We
 * re-export from here to preserve the existing import surface.
 */
export {
  adminPaymentRowSchema,
  validateAdminPaymentRow,
  validateAdminPaymentRowShape,
  ADMIN_PAYMENT_ROW_FIELD_LABELS,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
  type ValidateAdminPaymentRowResult,
} from "@/lib/payments/validate-row";




export type AdminPaymentsResult = {
  rows: AdminPaymentRow[];
  total: number;
  paidCount: number;
  paidSum: number;
  page: number;
  pageSize: number;
};

type Filters = z.infer<typeof baseFilterSchema>;

async function resolveSearchIds(sb: any, q: string | undefined) {
  if (!q) return { customerIds: undefined as string[] | undefined, membershipIds: undefined as string[] | undefined };
  const like = `%${q}%`;
  const [profRes, memRes] = await Promise.all([
    sb.from("profiles").select("id").or(`full_name.ilike.${like},email.ilike.${like}`).limit(500),
    sb.from("memberships").select("id").ilike("membership_number", like).limit(500),
  ]);
  if (profRes.error) throw new Error(profRes.error.message);
  if (memRes.error) throw new Error(memRes.error.message);
  return {
    customerIds: (profRes.data ?? []).map((r: any) => r.id) as string[],
    membershipIds: (memRes.data ?? []).map((r: any) => r.id) as string[],
  };
}

async function resolveCustomerIdsExact(sb: any, customer: string | undefined) {
  if (!customer) return undefined;
  const like = `%${customer}%`;
  const { data, error } = await sb
    .from("profiles")
    .select("id")
    .or(`full_name.ilike.${like},email.ilike.${like}`)
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.id) as string[];
}

function normalizeFilters(f: Filters) {
  const q = f.q?.trim() || undefined;
  // Zod already narrowed `f.status` to PaymentStatus | undefined; the "all"
  // chip is a UI-only concept that never survives validation.
  const status = f.status;
  const fromISO = f.from ? new Date(f.from).toISOString() : undefined;
  const toISO = f.to ? new Date(new Date(f.to).getTime() + 86_400_000).toISOString() : undefined;
  const orderId = f.orderId?.trim() || undefined;
  const paymentId = f.paymentId?.trim() || undefined;
  const customer = f.customer?.trim() || undefined;
  return {
    q, status, fromISO, toISO, orderId, paymentId, customer,
    sortBy: f.sortBy, sortDir: f.sortDir,
    dateField: f.dateField ?? "created",
  };
}

/**
 * When the admin filters by "webhook processed" date, we resolve the set of
 * payment IDs whose linked razorpay_webhook_events fall in [from, to] and
 * then filter payments by that set. Returns `null` when no date range is
 * active in this mode (caller applies the regular created_at bounds instead).
 */
async function resolveWebhookProcessedPaymentIds(
  sb: any,
  n: ReturnType<typeof normalizeFilters>,
): Promise<string[] | null> {
  if (n.dateField !== "webhook_processed") return null;
  if (!n.fromISO && !n.toISO) return null;
  let evq = sb
    .from("razorpay_webhook_events")
    .select("order_id, payment_id")
    .not("processed_at", "is", null);
  if (n.fromISO) evq = evq.gte("processed_at", n.fromISO);
  if (n.toISO) evq = evq.lt("processed_at", n.toISO);
  const { data: evs, error } = await evq.limit(50_000);
  if (error) throw new Error(error.message);
  const orderIds = Array.from(new Set((evs ?? []).map((e: any) => e.order_id).filter(Boolean))) as string[];
  const providerPaymentIds = Array.from(new Set((evs ?? []).map((e: any) => e.payment_id).filter(Boolean))) as string[];
  if (!orderIds.length && !providerPaymentIds.length) return [];
  const orParts: string[] = [];
  if (orderIds.length) orParts.push(`provider_order_id.in.(${orderIds.map((o) => `"${o}"`).join(",")})`);
  if (providerPaymentIds.length) orParts.push(`provider_payment_id.in.(${providerPaymentIds.map((p) => `"${p}"`).join(",")})`);
  const { data: pays, error: pErr } = await sb
    .from("payments")
    .select("id")
    .or(orParts.join(","))
    .limit(50_000);
  if (pErr) throw new Error(pErr.message);
  return (pays ?? []).map((p: any) => p.id as string);
}


async function fetchPaymentRows(
  sb: any,
  n: ReturnType<typeof normalizeFilters>,
  customerIds: string[] | undefined,
  membershipIds: string[] | undefined,
  customerIdsExact: string[] | undefined,
  webhookPaymentIds: string[] | null,
  fromIdx: number,
  toIdx: number,
): Promise<AdminPaymentRow[]> {
  let query = sb
    .from("payments")
    .select(
      `id, amount, currency, status, method, provider,
       provider_order_id, provider_payment_id, error_code, error_description,
       paid_at, created_at, customer_id, membership_id, installment_id,
       memberships:membership_id ( membership_number ),
       installments:installment_id ( sequence, due_date )`,
    );

  // Sorting: customer_name can't be pushed down (profiles isn't embeddable —
  // payments.customer_id FKs auth.users, not public.profiles), so for that
  // option we order by created_at at the DB level and re-sort the fetched
  // page by resolved profile name below. Everything else is a direct column.
  if (n.sortBy === "customer_name") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.order(n.sortBy, { ascending: n.sortDir === "asc", nullsFirst: false });
    if (n.sortBy !== "created_at") {
      query = query.order("created_at", { ascending: false });
    }
  }

  query = applyPaymentStatusEq(query, n.status);
  // Date range: applies to payments.created_at unless the admin picked
  // "webhook processed", in which case the caller resolved a list of
  // payment IDs whose webhook events landed in the range.
  if (n.dateField === "webhook_processed" && webhookPaymentIds !== null) {
    if (webhookPaymentIds.length === 0) {
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.in("id", webhookPaymentIds);
    }
  } else {
    if (n.fromISO) query = query.gte("created_at", n.fromISO);
    if (n.toISO) query = query.lt("created_at", n.toISO);
  }
  if (n.orderId) query = query.ilike("provider_order_id", `%${n.orderId}%`);
  if (n.paymentId) query = query.ilike("provider_payment_id", `%${n.paymentId}%`);
  if (n.customer) {
    if (!customerIdsExact || customerIdsExact.length === 0) {
      // No matching customer — return empty result set.
      query = query.eq("customer_id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.in("customer_id", customerIdsExact);
    }
  }
  if (n.q) {
    const like = `%${n.q}%`;
    const parts = [
      `provider_order_id.ilike.${like}`,
      `provider_payment_id.ilike.${like}`,
    ];
    if (customerIds && customerIds.length) parts.push(`customer_id.in.(${customerIds.join(",")})`);
    if (membershipIds && membershipIds.length) parts.push(`membership_id.in.(${membershipIds.join(",")})`);
    query = query.or(parts.join(","));
  }


  const { data: rows, error } = await query.range(fromIdx, toIdx);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[listAdminPayments] payments select failed", {
      message: error.message,
      details: (error as any).details,
      hint: (error as any).hint,
      code: (error as any).code,
      filters: n,
    });
    // Encode PostgREST fields inside the message so the client can render
    // hint/code safely in a toast + error boundary (RPC only preserves .message).
    const { serializePostgrestErrorMessage } = await import("./payments/postgrest-error");
    throw new Error(serializePostgrestErrorMessage(error, "Payments query failed"));
  }

  // Latest reconciliation per payment (batched)
  const paymentIds = (rows ?? []).map((r: any) => r.id).filter(Boolean);
  const reconMap = new Map<string, AdminPaymentRow["reconciliation"]>();
  if (paymentIds.length) {
    const { data: recs, error: rErr } = await sb
      .from("payment_reconciliations")
      .select("payment_id, mismatch, provider_status, stored_status, resolved_at, created_at")
      .in("payment_id", paymentIds)
      .order("created_at", { ascending: false });
    if (rErr) throw new Error(rErr.message);
    for (const rec of recs ?? []) {
      if (reconMap.has(rec.payment_id)) continue; // keep latest only
      reconMap.set(rec.payment_id, {
        last_checked_at: rec.created_at,
        mismatch: !!rec.mismatch,
        resolved_at: rec.resolved_at,
        provider_status: rec.provider_status,
        stored_status: rec.stored_status,
      });
    }
  }

  // Batched profile lookup (payments.customer_id → auth.users; profiles.id
  // shares the same UUID, so we join manually).
  const uniqueCustomerIds = Array.from(
    new Set((rows ?? []).map((r: any) => r.customer_id).filter(Boolean)),
  ) as string[];
  const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (uniqueCustomerIds.length) {
    const { data: profs, error: pErr } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", uniqueCustomerIds);
    if (pErr) throw new Error(pErr.message);
    for (const p of profs ?? []) {
      profileMap.set(p.id, { full_name: p.full_name ?? null, email: p.email ?? null });
    }
  }

  const mapped = (rows ?? []).map((r: any) => {
    return {
      ...r,
      profile: profileMap.get(r.customer_id) ?? null,
      reconciliation: reconMap.get(r.id) ?? null,
    };
  });

  if (n.sortBy === "customer_name") {
    const dir = n.sortDir === "asc" ? 1 : -1;
    mapped.sort((a: any, b: any) => {
      const an = (a.profile?.full_name ?? "").toLowerCase();
      const bn = (b.profile?.full_name ?? "").toLowerCase();
      if (an === bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return an < bn ? -1 * dir : 1 * dir;
    });
  }

  return mapped;
}


export const listAdminPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pageSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminPaymentsResult> => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const n = normalizeFilters(data);
    const { customerIds, membershipIds } = await resolveSearchIds(sb, n.q);
    const customerIdsExact = await resolveCustomerIdsExact(sb, n.customer);
    const webhookPaymentIds = await resolveWebhookProcessedPaymentIds(sb, n);

    const fromIdx = data.page * data.pageSize;
    const toIdx = fromIdx + data.pageSize - 1;

    // In webhook-processed mode the date filter lives outside the payments
    // table, so the created_at-based RPC totals would be wrong — compute
    // totals over the resolved payment-id set directly.
    const totalsPromise =
      n.dateField === "webhook_processed" && webhookPaymentIds !== null
        ? (async () => {
            if (webhookPaymentIds.length === 0) {
              return { total_count: 0, paid_count: 0, paid_sum: 0 };
            }
            let tq = sb.from("payments").select("amount, status", { count: "exact" });
            tq = tq.in("id", webhookPaymentIds);
            tq = applyPaymentStatusEq(tq, n.status);
            if (n.orderId) tq = tq.ilike("provider_order_id", `%${n.orderId}%`);
            if (n.paymentId) tq = tq.ilike("provider_payment_id", `%${n.paymentId}%`);
            if (customerIdsExact && customerIdsExact.length) tq = tq.in("customer_id", customerIdsExact);
            const { data: agg, error, count } = await tq.limit(50_000);
            if (error) throw new Error(error.message);
            let paidCount = 0;
            let paidSum = 0;
            for (const r of agg ?? []) {
              if (String((r as any).status) === "paid") {
                paidCount += 1;
                paidSum += Number((r as any).amount) || 0;
              }
            }
            return { total_count: count ?? 0, paid_count: paidCount, paid_sum: paidSum };
          })()
        : sb
            .rpc("admin_payments_totals", {
              _status: n.status ?? null,
              _from: n.fromISO ?? null,
              _to: n.toISO ?? null,
              _customer_ids: customerIds ?? null,
              _membership_ids: membershipIds ?? null,
              _q: n.q ?? null,
              _order_id: n.orderId ?? null,
              _payment_id: n.paymentId ?? null,
              _customer_ids_exact: customerIdsExact ?? null,
            })
            .then((r: any) => {
              if (r.error) throw new Error(r.error.message);
              const t = Array.isArray(r.data) ? r.data[0] : r.data;
              return {
                total_count: Number(t?.total_count ?? 0),
                paid_count: Number(t?.paid_count ?? 0),
                paid_sum: Number(t?.paid_sum ?? 0),
              };
            });

    const [rows, totals] = await Promise.all([
      fetchPaymentRows(sb, n, customerIds, membershipIds, customerIdsExact, webhookPaymentIds, fromIdx, toIdx),
      totalsPromise,
    ]);

    return {
      rows,
      total: Number(totals.total_count ?? 0),
      paidCount: Number(totals.paid_count ?? 0),
      paidSum: Number(totals.paid_sum ?? 0),
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export type StatusHistoryTimestamps = {
  order_created_at: string | null;
  authorized_at: string | null;
  captured_at: string | null;
  failed_at: string | null;
  refunded_at: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
  event_count: number;
};

export type AdminPaymentExportRow = AdminPaymentRow & {
  status_history: StatusHistoryTimestamps;
};

function emptyHistory(): StatusHistoryTimestamps {
  return {
    order_created_at: null,
    authorized_at: null,
    captured_at: null,
    failed_at: null,
    refunded_at: null,
    first_event_at: null,
    last_event_at: null,
    event_count: 0,
  };
}

export async function buildExportRows(
  sb: any,
  filters: z.infer<typeof baseFilterSchema>,
  offset: number,
  limit: number,
): Promise<AdminPaymentExportRow[]> {
  const n = normalizeFilters(filters);
  const { customerIds, membershipIds } = await resolveSearchIds(sb, n.q);
  const customerIdsExact = await resolveCustomerIdsExact(sb, n.customer);
  const webhookPaymentIds = await resolveWebhookProcessedPaymentIds(sb, n);
  const rows = await fetchPaymentRows(
    sb, n, customerIds, membershipIds, customerIdsExact, webhookPaymentIds,
    offset, offset + limit - 1,
  );

  const orderIds = Array.from(new Set(rows.map((r) => r.provider_order_id).filter(Boolean))) as string[];
  const paymentIds = Array.from(new Set(rows.map((r) => r.provider_payment_id).filter(Boolean))) as string[];

  const historyByOrder = new Map<string, StatusHistoryTimestamps>();
  const historyByPayment = new Map<string, StatusHistoryTimestamps>();

  if (orderIds.length || paymentIds.length) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const CHUNK = 200;
    const orderChunks: string[][] = [];
    for (let i = 0; i < orderIds.length; i += CHUNK) orderChunks.push(orderIds.slice(i, i + CHUNK));
    const paymentChunks: string[][] = [];
    for (let i = 0; i < paymentIds.length; i += CHUNK) paymentChunks.push(paymentIds.slice(i, i + CHUNK));

    const runs: Array<PromiseLike<any>> = [];
    for (const oc of orderChunks) {
      runs.push(
        supabaseAdmin
          .from("razorpay_webhook_events")
          .select("event_type, received_at, order_id, payment_id")
          .in("order_id", oc),
      );
    }
    for (const pc of paymentChunks) {
      runs.push(
        supabaseAdmin
          .from("razorpay_webhook_events")
          .select("event_type, received_at, order_id, payment_id")
          .in("payment_id", pc),
      );
    }
    const results = await Promise.all(runs);
    for (const res of results) {
      if (res.error) throw new Error(res.error.message);
      for (const ev of res.data ?? []) {
        const et = (ev.event_type ?? "").toLowerCase();
        const ts = ev.received_at as string;
        const targets: StatusHistoryTimestamps[] = [];
        if (ev.order_id) {
          let h = historyByOrder.get(ev.order_id);
          if (!h) { h = emptyHistory(); historyByOrder.set(ev.order_id, h); }
          targets.push(h);
        }
        if (ev.payment_id) {
          let h = historyByPayment.get(ev.payment_id);
          if (!h) { h = emptyHistory(); historyByPayment.set(ev.payment_id, h); }
          targets.push(h);
        }
        for (const h of targets) {
          h.event_count += 1;
          if (!h.first_event_at || ts < h.first_event_at) h.first_event_at = ts;
          if (!h.last_event_at || ts > h.last_event_at) h.last_event_at = ts;
          if (et.includes("order.paid") && (!h.order_created_at || ts < h.order_created_at)) h.order_created_at = ts;
          if (et.includes("payment.authorized") && (!h.authorized_at || ts < h.authorized_at)) h.authorized_at = ts;
          if (et.includes("payment.captured") && (!h.captured_at || ts < h.captured_at)) h.captured_at = ts;
          if (et.includes("payment.failed") && (!h.failed_at || ts < h.failed_at)) h.failed_at = ts;
          if (et.includes("refund") && (!h.refunded_at || ts < h.refunded_at)) h.refunded_at = ts;
        }
      }
    }
  }

  return rows.map((r) => {
    const h =
      (r.provider_payment_id && historyByPayment.get(r.provider_payment_id)) ||
      (r.provider_order_id && historyByOrder.get(r.provider_order_id)) ||
      emptyHistory();
    return { ...r, status_history: h };
  });
}

export const exportAdminPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => exportSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminPaymentExportRow[]> => {
    await assertAdmin(context);
    return buildExportRows(context.supabase, data, 0, data.limit);
  });

/* ---------- Server-side CSV generation (tamper-proof) ---------- */

/**
 * Escape a value for CSV. Handles:
 * - null/undefined → empty
 * - numbers → plain decimal, no quoting unless not finite (then empty)
 * - booleans → "true"/"false"
 * - Date → ISO string
 * - strings → double-quote when they contain ", , CR, LF, or a leading
 *   formula character (=,+,-,@,\t,\r) that Excel/Sheets would evaluate.
 *   Formula-prefixed strings are additionally prefixed with a single quote
 *   inside the quoted field to neutralize CSV injection.
 * - control chars (except tab/CR/LF) are stripped to keep files parseable.
 */
function csvEscape(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  let s = typeof v === "string" ? v : String(v);
  // strip C0/C1 control chars except \t \r \n
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const needsInjectionGuard = /^[=+\-@\t\r]/.test(s);
  const needsQuoting = needsInjectionGuard || /[",\r\n]/.test(s);
  if (needsInjectionGuard) s = "'" + s;
  if (needsQuoting) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvNum = (n: unknown): string =>
  typeof n === "number" && Number.isFinite(n) ? String(n) : "";
const csvInt = (n: unknown): string =>
  typeof n === "number" && Number.isFinite(n) ? String(Math.trunc(n)) : "0";

const CSV_HEADERS = [
  "Created", "Paid At", "Razorpay Order ID", "Razorpay Payment ID",
  "Status", "Method", "Provider", "Amount", "Currency",
  "Customer Name", "Customer Email",
  "Membership #", "Installment #", "Installment Due Date",
  "Order Paid At", "Authorized At", "Captured At", "Failed At", "Refunded At",
  "First Event At", "Last Event At", "Webhook Event Count",
  "Error Code", "Error Description",
] as const;

export function rowsToCsv(rows: AdminPaymentExportRow[]): string {
  const lines: string[] = [CSV_HEADERS.map(csvEscape).join(",")];
  for (const r of rows) {
    const h = r.status_history;
    // Installment # is numeric when known; advance payments have no sequence
    // so we emit the literal token "advance" (as a string) — never mix into
    // an integer column silently.
    const installmentSeq =
      r.installments?.sequence != null
        ? csvInt(r.installments.sequence)
        : r.installment_id
          ? ""
          : csvEscape("advance");
    lines.push([
      csvEscape(r.created_at),
      csvEscape(r.paid_at),
      csvEscape(r.provider_order_id),
      csvEscape(r.provider_payment_id),
      csvEscape(r.status),
      csvEscape(r.method),
      csvEscape(r.provider),
      csvNum(r.amount),
      csvEscape(r.currency),
      csvEscape(r.profile?.full_name),
      csvEscape(r.profile?.email),
      csvEscape(r.memberships?.membership_number),
      installmentSeq,
      csvEscape(r.installments?.due_date),
      csvEscape(h.order_created_at),
      csvEscape(h.authorized_at),
      csvEscape(h.captured_at),
      csvEscape(h.failed_at),
      csvEscape(h.refunded_at),
      csvEscape(h.first_event_at),
      csvEscape(h.last_event_at),
      csvInt(h.event_count),
      csvEscape(r.error_code),
      csvEscape(r.error_description),
    ].join(","));
  }
  // CRLF is safer for Excel; also include UTF-8 BOM for consistent decoding.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export type ExportPaymentsCsvResult = {
  csv: string;
  filename: string;
  rowCount: number;
  capped: boolean;
  scope: "page" | "filtered";
};

export const exportAdminPaymentsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => exportCsvSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<ExportPaymentsCsvResult> => {
    await assertAdmin(context);
    const offset = data.scope === "page" ? data.page * data.pageSize : 0;
    const limit = data.scope === "page" ? data.pageSize : CSV_HARD_CAP;
    const rows = await buildExportRows(context.supabase, data, offset, limit);
    const csv = rowsToCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = data.scope === "page" ? `-page-${data.page + 1}` : "-filtered";
    return {
      csv,
      filename: `payments-${stamp}${suffix}.csv`,
      rowCount: rows.length,
      capped: data.scope === "filtered" && rows.length >= CSV_HARD_CAP,
      scope: data.scope,
    };
  });

/* ---------- Per-installment webhook timeline ---------- */

export type InstallmentWebhookEvent = {
  id: string;
  event_id: string;
  event_type: string | null;
  status: string;
  received_at: string;
  processed_at: string;
  order_id: string | null;
  payment_id: string | null;
  payment_provider_id: string | null;
  payment_status: string | null;
  amount: number | null;
  currency: string | null;
  error_code: string | null;
  error_description: string | null;
  resulting_installment_status: string | null;
  raw: Record<string, any> | null;
};

export type InstallmentWebhookTimeline = {
  installment: {
    id: string;
    sequence: number;
    due_date: string;
    amount: number;
    status: string;
    paid_at: string | null;
    membership_number: string | null;
  };
  events: InstallmentWebhookEvent[];
};

export const getInstallmentWebhookTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ installmentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<InstallmentWebhookTimeline> => {
    const sb: any = context.supabase;

    // Authorization: admin OR the installment's membership belongs to the caller.
    const { data: isAdmin } = await sb.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    const { data: inst, error: iErr } = await sb
      .from("installments")
      .select(
        "id, sequence, due_date, amount, status, paid_at, membership_id, memberships!inner(membership_number, user_id)",
      )
      .eq("id", data.installmentId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inst) throw new Error("Installment not found");

    const membership = Array.isArray(inst.memberships) ? inst.memberships[0] : inst.memberships;
    if (!isAdmin && membership?.user_id !== context.userId) {
      throw new Error("Forbidden");
    }

    // Load privileged clients only after authorization succeeds.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: pays, error: pErr } = await supabaseAdmin
      .from("payments")
      .select("id, provider_order_id, provider_payment_id, status, amount, currency, error_code, error_description")
      .eq("installment_id", data.installmentId);
    if (pErr) throw new Error(pErr.message);

    const paymentIds = (pays ?? []).map((p) => p.id);
    const orderIds = (pays ?? []).map((p) => p.provider_order_id).filter(Boolean) as string[];

    let events: any[] = [];
    if (paymentIds.length || orderIds.length) {
      const filters: string[] = [];
      if (paymentIds.length) filters.push(`payment_id.in.(${paymentIds.join(",")})`);
      if (orderIds.length) filters.push(`order_id.in.(${orderIds.map((o) => `"${o}"`).join(",")})`);
      const { data: evs, error: eErr } = await supabaseAdmin
        .from("razorpay_webhook_events")
        .select("id, event_id, event_type, status, received_at, processed_at, order_id, payment_id, raw")
        .or(filters.join(","))
        .order("received_at", { ascending: true })
        .limit(200);
      if (eErr) throw new Error(eErr.message);
      events = evs ?? [];
    }

    const payById = new Map((pays ?? []).map((p) => [p.id, p]));

    const enriched: InstallmentWebhookEvent[] = events.map((e) => {
      const pay = e.payment_id ? payById.get(e.payment_id) : null;
      const et = (e.event_type ?? "").toLowerCase();
      let resulting: string | null = null;
      if (et.includes("payment.captured") || et.includes("order.paid")) resulting = "paid";
      else if (et.includes("payment.failed")) resulting = "payment failed";
      else if (et.includes("refund")) resulting = "refunded";
      else if (et.includes("payment.authorized")) resulting = "authorized";
      return {
        id: e.id,
        event_id: e.event_id,
        event_type: e.event_type,
        status: e.status,
        received_at: e.received_at,
        processed_at: e.processed_at,
        order_id: e.order_id,
        payment_id: e.payment_id,
        payment_provider_id: pay?.provider_payment_id ?? null,
        payment_status: pay?.status ?? null,
        amount: pay?.amount ?? null,
        currency: pay?.currency ?? null,
        error_code: pay?.error_code ?? null,
        error_description: pay?.error_description ?? null,
        resulting_installment_status: resulting,
        raw: e.raw,
      };
    });

    return {
      installment: {
        id: inst.id,
        sequence: inst.sequence,
        due_date: inst.due_date,
        amount: Number(inst.amount),
        status: inst.status,
        paid_at: inst.paid_at,
        membership_number: membership?.membership_number ?? null,
      },
      events: enriched,
    };
  });

/* ---------- Payment reconciliation with Razorpay ---------- */

export type ReconciliationRow = {
  id: string;
  payment_id: string;
  stored_status: string;
  provider_status: string | null;
  provider_amount: number | null;
  provider_method: string | null;
  provider_error: string | null;
  mismatch: boolean;
  note: string | null;
  resolved_at: string | null;
  created_at: string;
  payment?: {
    provider_order_id: string | null;
    provider_payment_id: string | null;
    amount: number;
    currency: string;
    customer_id: string;
    membership_id: string;
  } | null;
};

export type ReconciliationResult = {
  checked: number;
  matched: number;
  mismatched: number;
  skipped: number;
  errors: number;
  rows: ReconciliationRow[];
};

function mapProviderStatus(providerStatus: string | null | undefined): string | null {
  if (!providerStatus) return null;
  const s = providerStatus.toLowerCase();
  if (s === "captured") return "paid";
  if (s === "refunded") return "refunded";
  if (s === "failed") return "failed";
  if (s === "authorized") return "attempted";
  if (s === "created") return "created";
  return s;
}

async function fetchRazorpayPayment(paymentId: string, keyId: string, keySecret: string) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Razorpay ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<{
    id: string;
    status: string;
    amount: number;
    currency: string;
    method: string | null;
    error_code: string | null;
    error_description: string | null;
    order_id: string;
  }>;
}

async function fetchRazorpayOrderPayments(orderId: string, keyId: string, keySecret: string) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  const body = await res.json() as { items?: Array<{ id: string; status: string }> };
  return body.items ?? [];
}

export const reconcilePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      status: paymentStatusFilterSchema,
      from: z.string().optional(),
      to: z.string().optional(),
      q: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ReconciliationResult> => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const n = normalizeFilters({
      sortBy: "created_at",
      sortDir: "desc",
      status: data.status,
      from: data.from,
      to: data.to,
      q: data.q,
      dateField: "created",
    });
    const { customerIds, membershipIds } = await resolveSearchIds(sb, n.q);

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay is not configured");

    let query = sb
      .from("payments")
      .select("id, status, amount, provider_order_id, provider_payment_id, customer_id, membership_id, currency")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    query = applyPaymentStatusEq(query, n.status);
    if (n.fromISO) query = query.gte("created_at", n.fromISO);
    if (n.toISO) query = query.lt("created_at", n.toISO);
    if (n.q) {
      const like = `%${n.q}%`;
      const parts = [
        `provider_order_id.ilike.${like}`,
        `provider_payment_id.ilike.${like}`,
      ];
      if (customerIds?.length) parts.push(`customer_id.in.(${customerIds.join(",")})`);
      if (membershipIds?.length) parts.push(`membership_id.in.(${membershipIds.join(",")})`);
      query = query.or(parts.join(","));
    }

    const { data: payments, error } = await query;
    if (error) throw new Error(error.message);

    const toInsert: Array<Record<string, unknown>> = [];
    let matched = 0, mismatched = 0, skipped = 0, errors = 0;

    for (const p of (payments ?? []) as Array<any>) {
      let providerPaymentId = p.provider_payment_id as string | null;

      if (!providerPaymentId && p.provider_order_id) {
        try {
          const items = await fetchRazorpayOrderPayments(p.provider_order_id, keyId, keySecret);
          if (items && items.length > 0) {
            const captured = items.find((it) => it.status === "captured");
            providerPaymentId = (captured ?? items[0]).id;
          }
        } catch {
          /* fall through */
        }
      }

      if (!providerPaymentId) {
        skipped += 1;
        continue;
      }

      try {
        const remote = await fetchRazorpayPayment(providerPaymentId, keyId, keySecret);
        const mappedRemote = mapProviderStatus(remote.status);
        const isMismatch = mappedRemote !== null && mappedRemote !== p.status;
        if (isMismatch) mismatched += 1; else matched += 1;

        toInsert.push({
          payment_id: p.id,
          stored_status: p.status,
          provider_status: remote.status,
          provider_amount: remote.amount / 100,
          provider_method: remote.method,
          provider_error: remote.error_code
            ? `${remote.error_code}: ${remote.error_description ?? ""}`
            : null,
          mismatch: isMismatch,
          note: isMismatch
            ? `Stored=${p.status} · Razorpay=${remote.status} (→${mappedRemote})`
            : `In sync (${remote.status})`,
          checked_by: context.userId,
        });
      } catch (e) {
        errors += 1;
        toInsert.push({
          payment_id: p.id,
          stored_status: p.status,
          provider_status: null,
          mismatch: false,
          note: `Reconciliation error: ${e instanceof Error ? e.message : String(e)}`,
          checked_by: context.userId,
        });
      }
    }

    let insertedRows: ReconciliationRow[] = [];
    if (toInsert.length) {
      const { data: inserted, error: iErr } = await sb
        .from("payment_reconciliations")
        .insert(toInsert)
        .select("id, payment_id, stored_status, provider_status, provider_amount, provider_method, provider_error, mismatch, note, resolved_at, created_at");
      if (iErr) throw new Error(iErr.message);
      insertedRows = (inserted ?? []) as ReconciliationRow[];
    }

    return {
      checked: (payments ?? []).length,
      matched,
      mismatched,
      skipped,
      errors,
      rows: insertedRows,
    };
  });

export const listOpenReconciliations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).default(100) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ReconciliationRow[]> => {
    await assertAdmin(context);
    const sb: any = context.supabase;
    const { data: rows, error } = await sb
      .from("payment_reconciliations")
      .select(
        `id, payment_id, stored_status, provider_status, provider_amount, provider_method,
         provider_error, mismatch, note, resolved_at, created_at,
         payment:payment_id ( provider_order_id, provider_payment_id, amount, currency, customer_id, membership_id )`,
      )
      .eq("mismatch", true)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ReconciliationRow[];
  });

export const resolveReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      applyProviderStatus: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb: any = context.supabase;

    if (data.applyProviderStatus) {
      const { data: rec, error: rErr } = await sb
        .from("payment_reconciliations")
        .select("id, payment_id, provider_status")
        .eq("id", data.id)
        .single();
      if (rErr) throw new Error(rErr.message);
      const mapped = mapProviderStatus(rec.provider_status);
      if (mapped) {
        const patch: Record<string, unknown> = { status: mapped };
        if (mapped === "paid") patch.paid_at = new Date().toISOString();
        const { error: upErr } = await sb
          .from("payments")
          .update(patch)
          .eq("id", rec.payment_id);
        if (upErr) throw new Error(upErr.message);
      }
    }

    const { error } = await sb
      .from("payment_reconciliations")
      .update({ resolved_at: new Date().toISOString(), resolved_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });



export const getLastWebhookEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("razorpay_webhook_events")
      .select("event_id, event_type, received_at, processed_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as
      | { event_id: string; event_type: string; received_at: string; processed_at: string | null }
      | null;
  });

/**
 * Full webhook-event JSON payload for admins. Two modes:
 *   - mode: "meta"     → returns byte size only (cheap probe for the UI).
 *   - mode: "download" → returns the full JSON as a string, capped at
 *                        WEBHOOK_PAYLOAD_MAX_BYTES. Oversized payloads throw
 *                        a typed error so the UI can offer guidance rather
 *                        than blindly buffering multi-MB JSON in the browser.
 *
 * The inline drawer preview keeps using its own 96 KB soft cap for display;
 * this endpoint is the authenticated path used for the "Download full JSON"
 * action and for oversized events where inline fetch is disabled.
 */
export const WEBHOOK_PAYLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard cap

export const getWebhookEventPayload = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventRowId: string; mode?: "meta" | "download" }) =>
    z
      .object({
        eventRowId: z.string().uuid(),
        mode: z.enum(["meta", "download"]).default("meta"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("razorpay_webhook_events")
      .select("id, event_id, event_type, raw")
      .eq("id", data.eventRowId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Webhook event not found");

    const text = row.raw == null ? "" : JSON.stringify(row.raw);
    const bytes = new TextEncoder().encode(text).length;

    if (data.mode === "meta") {
      return {
        eventRowId: row.id as string,
        eventId: row.event_id as string,
        eventType: row.event_type as string,
        bytes,
        maxBytes: WEBHOOK_PAYLOAD_MAX_BYTES,
        oversized: bytes > WEBHOOK_PAYLOAD_MAX_BYTES,
        empty: bytes === 0,
      };
    }

    if (bytes > WEBHOOK_PAYLOAD_MAX_BYTES) {
      // Typed sentinel: UI checks the message prefix to render a friendly error.
      throw new Error(
        `PAYLOAD_TOO_LARGE:${bytes}:${WEBHOOK_PAYLOAD_MAX_BYTES}`,
      );
    }

    // Pretty-print for the download only (2-space indent). Meta uses compact.
    const pretty = row.raw == null ? "" : JSON.stringify(row.raw, null, 2);
    return {
      eventRowId: row.id as string,
      eventId: row.event_id as string,
      eventType: row.event_type as string,
      bytes,
      maxBytes: WEBHOOK_PAYLOAD_MAX_BYTES,
      oversized: false,
      empty: bytes === 0,
      json: pretty,
    };
  });

/**
 * Admin-only server endpoint that validates an untrusted `AdminPaymentRow`
 * payload and returns a consistent remediation response. Shape source of
 * truth: `@/lib/payments/validate-row-response.ts`.
 */
export const validateAdminPaymentRowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { row: unknown }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { validateAdminPaymentRowResponse } = await import(
      "@/lib/payments/validate-row-response"
    );
    return validateAdminPaymentRowResponse(data.row);
  });
