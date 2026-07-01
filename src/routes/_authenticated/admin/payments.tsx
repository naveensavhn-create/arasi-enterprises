import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Search, Download, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, Radio, Webhook } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PaymentDetailDrawer } from "@/components/admin/PaymentDetailDrawer";
import { ReconcileDialog } from "@/components/admin/ReconcileDialog";
import { listAdminPayments, exportAdminPayments, getLastWebhookEvent } from "@/lib/payments.functions";
import {
  validateAdminPaymentRowShape,
  ADMIN_PAYMENT_ROW_FIELD_LABELS,
  type AdminPaymentRow,
} from "@/lib/payments/validate-row";
import { supabase } from "@/integrations/supabase/client";
import { useUiPrefs, setUiPrefs, PAYMENTS_POLLING_OPTIONS } from "@/lib/ui-prefs";
import { toast } from "sonner";



const STATUSES = ["all", "paid", "created", "attempted", "failed", "refunded"] as const;
const SORT_COLUMNS = [
  "created_at",
  "paid_at",
  "amount",
  "status",
  "provider_order_id",
  "provider_payment_id",
  "customer_name",
] as const;
type SortCol = typeof SORT_COLUMNS[number];

const searchSchema = z.object({
  page: fallback(z.number().int().min(0), 0).default(0),
  pageSize: fallback(z.number().int().min(5).max(200), 25).default(25),
  sortBy: fallback(z.enum(SORT_COLUMNS), "created_at").default("created_at"),
  sortDir: fallback(z.enum(["asc", "desc"]), "desc").default("desc"),
  status: fallback(z.string(), "all").default("all"),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  dateField: fallback(z.enum(["created", "webhook_processed"]), "created").default("created"),
  q: fallback(z.string(), "").default(""),
  orderId: fallback(z.string(), "").default(""),
  paymentId: fallback(z.string(), "").default(""),
  customer: fallback(z.string(), "").default(""),
});


export const Route = createFileRoute("/_authenticated/admin/payments")({
  head: () => ({ meta: [{ title: "Payments — Admin" }] }),
  validateSearch: zodValidator(searchSchema),
  component: AdminPaymentsPage,
});

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type ExportRow = Awaited<ReturnType<typeof exportAdminPayments>>[number];

function downloadCSV(rows: ExportRow[]) {
  const headers = [
    "Created", "Paid At", "Razorpay Order ID", "Razorpay Payment ID",
    "Status", "Method", "Provider", "Amount", "Currency",
    "Customer Name", "Customer Email",
    "Membership #", "Installment #", "Installment Due Date",
    "Order Paid At", "Authorized At", "Captured At", "Failed At", "Refunded At",
    "First Event At", "Last Event At", "Webhook Event Count",
    "Error",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const h = r.status_history;
    lines.push([
      r.created_at, r.paid_at ?? "",
      r.provider_order_id ?? "", r.provider_payment_id ?? "",
      r.status, r.method ?? "", r.provider,
      r.amount, r.currency,
      r.profile?.full_name ?? "",
      r.profile?.email ?? "",
      r.memberships?.membership_number ?? "",
      r.installments?.sequence ?? (r.installment_id ? "" : "advance"),
      r.installments?.due_date ?? "",
      h.order_created_at ?? "",
      h.authorized_at ?? "",
      h.captured_at ?? "",
      h.failed_at ?? "",
      h.refunded_at ?? "",
      h.first_event_at ?? "",
      h.last_event_at ?? "",
      h.event_count,
      r.error_code ? `${r.error_code}: ${r.error_description ?? ""}` : "",
    ].map(csvEscape).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AdminPaymentsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selected, setSelected] = useState<AdminPaymentRow | null>(null);
  const [qDraft, setQDraft] = useState(search.q);
  const [orderDraft, setOrderDraft] = useState(search.orderId);
  const [paymentDraft, setPaymentDraft] = useState(search.paymentId);
  const [customerDraft, setCustomerDraft] = useState(search.customer);
  const [exporting, setExporting] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const lastLiveAt = useRef<number>(0);
  const { paymentsPollingMs } = useUiPrefs();

  const queryClient = useQueryClient();
  const listFn = useServerFn(listAdminPayments);
  const exportFn = useServerFn(exportAdminPayments);
  const lastWebhookFn = useServerFn(getLastWebhookEvent);

  const { data: lastWebhook } = useQuery({
    queryKey: ["admin-payments-last-webhook"],
    queryFn: () => lastWebhookFn(),
    refetchInterval: liveConnected
      ? (paymentsPollingMs === 0 ? false : Math.max(paymentsPollingMs, 120_000))
      : (paymentsPollingMs === 0 ? 60_000 : paymentsPollingMs),
    refetchOnWindowFocus: true,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "admin-payments",
      search.page, search.pageSize, search.sortBy, search.sortDir,
      search.status, search.from, search.to, search.dateField, search.q,
      search.orderId, search.paymentId, search.customer,
    ],
    queryFn: () =>
      listFn({
        data: {
          page: search.page,
          pageSize: search.pageSize,
          sortBy: search.sortBy,
          sortDir: search.sortDir,
          status: search.status || undefined,
          from: search.from || undefined,
          to: search.to || undefined,
          dateField: search.dateField,
          q: search.q || undefined,
          orderId: search.orderId || undefined,
          paymentId: search.paymentId || undefined,
          customer: search.customer || undefined,
        },
      }),
    placeholderData: keepPreviousData,
    // Polling fallback interval is admin-configurable. Realtime pauses polling
    // to a longer interval; when disconnected we honor the admin's setting
    // (0 disables background polling entirely).
    refetchInterval: liveConnected
      ? (paymentsPollingMs === 0 ? false : Math.max(paymentsPollingMs, 120_000))
      : (paymentsPollingMs === 0 ? false : paymentsPollingMs),
    refetchOnWindowFocus: true,
  });


  // Realtime: invalidate ledger + drawer queries when webhooks land.
  useEffect(() => {
    // Debounce toasts so bursts of related events (payment + webhook + installment)
    // surface as a single notification.
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = { payments: 0, webhooks: 0, other: 0 };
    const scheduleToast = (kind: "payments" | "webhooks" | "other") => {
      pending[kind] += 1;
      if (toastTimer) return;
      toastTimer = setTimeout(() => {
        const { payments: p, webhooks: w, other: o } = pending;
        const total = p + w + o;
        if (total > 0) {
          const parts: string[] = [];
          if (p) parts.push(`${p} payment${p > 1 ? "s" : ""}`);
          if (w) parts.push(`${w} webhook${w > 1 ? "s" : ""}`);
          if (o) parts.push(`${o} related update${o > 1 ? "s" : ""}`);
          toast.success("Ledger updated", {
            description: parts.join(" · "),
            duration: 2500,
          });
        }
        pending.payments = 0; pending.webhooks = 0; pending.other = 0;
        toastTimer = null;
      }, 800);
    };
    const invalidate = (kind: "payments" | "webhooks" | "other") => () => {
      lastLiveAt.current = Date.now();
      queryClient.invalidateQueries({ queryKey: ["admin-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payment-webhook-events"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installment"] });
      queryClient.invalidateQueries({ queryKey: ["payment-membership"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payments-last-webhook"] });
      scheduleToast(kind);
    };
    const channel = supabase
      .channel("admin-payments-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, invalidate("payments"))
      .on("postgres_changes", { event: "*", schema: "public", table: "razorpay_webhook_events" }, invalidate("webhooks"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "installments" }, invalidate("other"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "memberships" }, invalidate("other"))
      .subscribe((status) => {
        setLiveConnected(status === "SUBSCRIBED");
      });
    return () => {
      if (toastTimer) clearTimeout(toastTimer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);


  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / search.pageSize));

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) => {
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });
  };

  const toggleSort = (col: SortCol) => {
    if (search.sortBy === col) {
      setSearch({ sortDir: search.sortDir === "asc" ? "desc" : "asc", page: 0 });
    } else {
      setSearch({ sortBy: col, sortDir: "desc", page: 0 });
    }
  };

  const sortIcon = (col: SortCol) => {
    if (search.sortBy !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return search.sortDir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const all = await exportFn({
        data: {
          sortBy: search.sortBy,
          sortDir: search.sortDir,
          status: search.status || undefined,
          from: search.from || undefined,
          to: search.to || undefined,
          dateField: search.dateField,
          q: search.q || undefined,
          orderId: search.orderId || undefined,
          paymentId: search.paymentId || undefined,
          customer: search.customer || undefined,
          limit: 10_000,
        },
      });

      downloadCSV(all);
      if (all.length >= 10_000) {
        toast.warning("Export capped at 10,000 rows. Narrow filters to export the rest.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments Ledger</h1>
          <p className="text-sm text-muted-foreground">
            All Razorpay transactions across the platform.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 text-[10px] uppercase tracking-wider"
            title={
              liveConnected
                ? "Realtime updates connected"
                : paymentsPollingMs === 0
                  ? "Realtime disconnected — background polling is off"
                  : `Realtime disconnected — polling every ${Math.round(paymentsPollingMs / 1000)}s`
            }
          >
            <Radio className={`h-3 w-3 ${liveConnected ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
            {liveConnected ? "Live" : paymentsPollingMs === 0 ? "Manual" : "Polling"}
          </Badge>
          {lastWebhook ? (
            <Badge
              variant="outline"
              className="gap-1.5 text-[10px] font-mono normal-case"
              title={`Event ID: ${lastWebhook.event_id}\nType: ${lastWebhook.event_type}\nReceived: ${new Date(lastWebhook.received_at).toLocaleString()}${lastWebhook.processed_at ? `\nProcessed: ${new Date(lastWebhook.processed_at).toLocaleString()}` : "\nNot yet processed"}`}
            >
              <Webhook className="h-3 w-3 text-muted-foreground" />
              <span className="hidden md:inline text-muted-foreground">Last webhook</span>
              <span>{formatRelative(lastWebhook.processed_at ?? lastWebhook.received_at)}</span>
              <span className="hidden lg:inline text-muted-foreground truncate max-w-[140px]">
                · {lastWebhook.event_id.slice(-14)}
              </span>
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 text-[10px] normal-case text-muted-foreground">
              <Webhook className="h-3 w-3" />
              No webhooks yet
            </Badge>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Poll every</span>
            <select
              value={paymentsPollingMs}
              onChange={(e) => setUiPrefs({ paymentsPollingMs: Number(e.target.value) as typeof paymentsPollingMs })}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Payments polling fallback interval"
              title="Fallback refresh interval when realtime is unavailable"
            >
              {PAYMENTS_POLLING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["admin-payments"] }),
                queryClient.invalidateQueries({ queryKey: ["payment-webhook-events"] }),
                queryClient.invalidateQueries({ queryKey: ["payment-installment"] }),
                queryClient.invalidateQueries({ queryKey: ["payment-membership"] }),
                queryClient.invalidateQueries({ queryKey: ["admin-payments-last-webhook"] }),
              ]);
              toast.success("Ledger refreshed");
            }}
            title="Force refresh ledger and drawer data"
            aria-label="Refresh ledger"
          >
            {isFetching
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setReconcileOpen(true)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reconcile
          </Button>

          <Button variant="outline" size="sm" disabled={!total || exporting} onClick={onExport}>
            {exporting
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
        </div>
      </div>




      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected (filtered)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-gradient-gold">
            ₹{(data?.paidSum ?? 0).toLocaleString("en-IN")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Successful</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{data?.paidCount ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total matching</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{total}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Transactions
            {isFetching && !isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSearch({ status: s, page: 0 })}
                  className={`rounded-md border px-2.5 py-1 text-xs capitalize ${
                    search.status === s ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <select
              value={search.dateField}
              onChange={(e) =>
                setSearch({ dateField: e.target.value as "created" | "webhook_processed", page: 0 })
              }
              className="h-8 rounded-md border bg-background px-2 text-xs"
              title="Which date the range applies to"
              aria-label="Date field"
            >
              <option value="created">Payment created</option>
              <option value="webhook_processed">Webhook processed</option>
            </select>
            <Input
              type="date"
              value={search.from}
              onChange={(e) => setSearch({ from: e.target.value, page: 0 })}
              className="h-8 w-40 text-xs"
              aria-label={search.dateField === "webhook_processed" ? "Webhook processed from" : "Created from"}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={search.to}
              onChange={(e) => setSearch({ to: e.target.value, page: 0 })}
              className="h-8 w-40 text-xs"
              aria-label={search.dateField === "webhook_processed" ? "Webhook processed to" : "Created to"}
            />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch({ q: qDraft.trim(), page: 0 });
              }}
              className="relative"
            >
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                onBlur={() => { if (qDraft.trim() !== search.q) setSearch({ q: qDraft.trim(), page: 0 }); }}
                placeholder="Order/payment id, customer, email, member #"
                className="h-8 w-72 pl-7 text-xs"
              />
            </form>
            <select
              value={search.pageSize}
              onChange={(e) => setSearch({ pageSize: Number(e.target.value), page: 0 })}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              {[10, 25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch({ orderId: orderDraft.trim(), page: 0 });
              }}
            >
              <Input
                value={orderDraft}
                onChange={(e) => setOrderDraft(e.target.value)}
                onBlur={() => { if (orderDraft.trim() !== search.orderId) setSearch({ orderId: orderDraft.trim(), page: 0 }); }}
                placeholder="Order ID (order_...)"
                className="h-8 w-52 font-mono text-xs"
              />
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch({ paymentId: paymentDraft.trim(), page: 0 });
              }}
            >
              <Input
                value={paymentDraft}
                onChange={(e) => setPaymentDraft(e.target.value)}
                onBlur={() => { if (paymentDraft.trim() !== search.paymentId) setSearch({ paymentId: paymentDraft.trim(), page: 0 }); }}
                placeholder="Payment ID (pay_...)"
                className="h-8 w-52 font-mono text-xs"
              />
            </form>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch({ customer: customerDraft.trim(), page: 0 });
              }}
            >
              <Input
                value={customerDraft}
                onChange={(e) => setCustomerDraft(e.target.value)}
                onBlur={() => { if (customerDraft.trim() !== search.customer) setSearch({ customer: customerDraft.trim(), page: 0 }); }}
                placeholder="Customer name or email"
                className="h-8 w-64 text-xs"
              />
            </form>
            {(search.orderId || search.paymentId || search.customer || search.q ||
              search.from || search.to || search.status !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setQDraft(""); setOrderDraft(""); setPaymentDraft(""); setCustomerDraft("");
                  setSearch({
                    q: "", orderId: "", paymentId: "", customer: "",
                    status: "all", from: "", to: "", dateField: "created", page: 0,
                  });
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions match filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">
                      <button className="hover:text-foreground" onClick={() => toggleSort("created_at")}>
                        Date{sortIcon("created_at")}
                      </button>
                    </th>
                    <th className="py-2 pr-4 font-medium">
                      <button className="hover:text-foreground" onClick={() => toggleSort("customer_name")}>
                        Customer{sortIcon("customer_name")}
                      </button>
                    </th>
                    <th className="py-2 pr-4 font-medium">Membership</th>
                    <th className="py-2 pr-4 font-medium">Inst.</th>
                    <th className="py-2 pr-4 font-medium">
                      <button className="hover:text-foreground" onClick={() => toggleSort("provider_order_id")}>
                        Order{sortIcon("provider_order_id")}
                      </button>
                      {" / "}
                      <button className="hover:text-foreground" onClick={() => toggleSort("provider_payment_id")}>
                        Payment{sortIcon("provider_payment_id")}
                      </button>
                    </th>
                    <th className="py-2 pr-4 font-medium">Method</th>
                    <th className="py-2 pr-4 font-medium">
                      <button className="hover:text-foreground" onClick={() => toggleSort("amount")}>
                        Amount{sortIcon("amount")}
                      </button>
                    </th>
                    <th className="py-2 pr-4 font-medium">
                      <button className="hover:text-foreground" onClick={() => toggleSort("status")}>
                        Status{sortIcon("status")}
                      </button>
                    </th>
                    <th className="py-2 pr-4 font-medium">Reconciliation</th>
                  </tr>

                </thead>
                <tbody>
                  {rows.map((r) => {
                    const p = r.profile;
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-b align-top last:border-0 hover:bg-accent/50"
                        onClick={() => setSelected(r)}
                      >
                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                          {new Date(r.paid_at ?? r.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email ?? ""}</div>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {r.memberships?.membership_number ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {r.installments
                            ? `#${r.installments.sequence}`
                            : <span className="text-muted-foreground">advance</span>}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[11px]">
                          <div>{r.provider_order_id ?? "—"}</div>
                          <div className="text-muted-foreground">{r.provider_payment_id ?? ""}</div>
                        </td>
                        <td className="py-2 pr-4 capitalize">{r.method ?? "—"}</td>
                        <td className="py-2 pr-4 font-medium whitespace-nowrap">
                          {r.currency} {Number(r.amount).toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={
                              r.status === "paid"
                                ? "default"
                                : r.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="capitalize"
                          >
                            {r.status}
                          </Badge>
                          {r.error_code && (
                            <div className="mt-1 text-[10px] text-destructive">
                              {r.error_code}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {r.reconciliation ? (
                            <div className="flex flex-col gap-1">
                              <Badge
                                variant={
                                  r.reconciliation.resolved_at
                                    ? "outline"
                                    : r.reconciliation.mismatch
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="w-fit text-[10px]"
                              >
                                {r.reconciliation.resolved_at
                                  ? "Resolved"
                                  : r.reconciliation.mismatch
                                    ? "Mismatch"
                                    : "Matched"}
                              </Badge>
                              {r.reconciliation.mismatch && !r.reconciliation.resolved_at && (
                                <span className="text-[10px] text-muted-foreground">
                                  stored: {r.reconciliation.stored_status ?? "—"} · provider:{" "}
                                  {r.reconciliation.provider_status ?? "—"}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {new Date(r.reconciliation.last_checked_at).toLocaleString()}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Never</span>
                          )}
                        </td>
                      </tr>

                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div>
                Showing {search.page * search.pageSize + 1}
                –{Math.min(total, search.page * search.pageSize + rows.length)} of {total}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={search.page === 0}
                  onClick={() => setSearch({ page: 0 })}>« First</Button>
                <Button variant="outline" size="sm" disabled={search.page === 0}
                  onClick={() => setSearch({ page: search.page - 1 })}>‹ Prev</Button>
                <span>Page {search.page + 1} of {pageCount}</span>
                <Button variant="outline" size="sm" disabled={search.page + 1 >= pageCount}
                  onClick={() => setSearch({ page: search.page + 1 })}>Next ›</Button>
                <Button variant="outline" size="sm" disabled={search.page + 1 >= pageCount}
                  onClick={() => setSearch({ page: pageCount - 1 })}>Last »</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PaymentDetailDrawer
        row={selected as any}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />

      <ReconcileDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        filters={{
          status: search.status || undefined,
          from: search.from || undefined,
          to: search.to || undefined,
          q: search.q || undefined,
        }}
      />
    </div>

  );
}
