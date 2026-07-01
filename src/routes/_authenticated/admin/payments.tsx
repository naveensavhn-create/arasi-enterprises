import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Search, Download, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, Webhook, AlertTriangle, FilterX, Inbox, Bell } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useEffect, useRef, useState } from "react";
import { PaymentDetailDrawer } from "@/components/admin/PaymentDetailDrawer";
import { ReconcileDialog } from "@/components/admin/ReconcileDialog";
import { PollingControls, useListRefetchInterval } from "@/components/admin/PollingControls";
import { listAdminPayments, exportAdminPaymentsCsv, getLastWebhookEvent } from "@/lib/payments.functions";
import { createExportJob, listMyExportJobs, getExportDownloadUrl, markExportJobNotified } from "@/lib/exports.functions";
import {
  validateAdminPaymentRowShape,
  ADMIN_PAYMENT_ROW_FIELD_LABELS,
  type AdminPaymentRow,
} from "@/lib/payments/validate-row";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";




const STATUSES = ["all", "paid", "created", "attempted", "failed", "refunded"] as const;
type StatusKey = typeof STATUSES[number];
const STATUS_META: Record<StatusKey, { label: string; dot: string; activeClass: string }> = {
  all:       { label: "All",        dot: "bg-muted-foreground",   activeClass: "bg-primary text-primary-foreground border-primary" },
  paid:      { label: "Succeeded",  dot: "bg-emerald-500",        activeClass: "bg-emerald-600 text-white border-emerald-600" },
  created:   { label: "Pending",    dot: "bg-amber-500",          activeClass: "bg-amber-600 text-white border-amber-600" },
  attempted: { label: "Attempted",  dot: "bg-sky-500",            activeClass: "bg-sky-600 text-white border-sky-600" },
  failed:    { label: "Failed",     dot: "bg-red-500",            activeClass: "bg-red-600 text-white border-red-600" },
  refunded:  { label: "Refunded",   dot: "bg-violet-500",         activeClass: "bg-violet-600 text-white border-violet-600" },
};
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
const SORT_LABELS: Record<SortCol, string> = {
  created_at: "Created",
  paid_at: "Paid at",
  amount: "Amount",
  status: "Status",
  provider_order_id: "Order ID",
  provider_payment_id: "Payment ID",
  customer_name: "Customer",
};


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

function saveCsvBlob(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
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
  const listRefetchInterval = useListRefetchInterval(liveConnected);

  const queryClient = useQueryClient();
  const listFn = useServerFn(listAdminPayments);
  const exportCsvFn = useServerFn(exportAdminPaymentsCsv);
  const lastWebhookFn = useServerFn(getLastWebhookEvent);
  const createExportJobFn = useServerFn(createExportJob);
  const listExportJobsFn = useServerFn(listMyExportJobs);
  const getExportDownloadUrlFn = useServerFn(getExportDownloadUrl);
  const markExportNotifiedFn = useServerFn(markExportJobNotified);

  const { data: lastWebhook } = useQuery({
    queryKey: ["admin-payments-last-webhook"],
    queryFn: () => lastWebhookFn(),
    // Even when the admin turns polling "Off", we still tick the last-webhook
    // badge on a slow interval when realtime is down — otherwise the "no
    // webhooks yet" state can lie for hours.
    refetchInterval: listRefetchInterval === false && !liveConnected ? 60_000 : listRefetchInterval,
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
    // Shared polling fallback: honors the cross-device admin preference.
    // Realtime caps the interval at 120s; "Off" disables background polling.
    refetchInterval: listRefetchInterval,
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

  const onExport = async (scope: "page" | "filtered") => {
    setExporting(true);
    try {
      // CSV is built server-side against the same authenticated filter set
      // used to render the ledger — the client can't tamper with the rows,
      // add unfiltered records, or bypass the 10k cap.
      const result = await exportCsvFn({
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
          scope,
          page: search.page,
          pageSize: search.pageSize,
        },
      });

      if (result.rowCount === 0) {
        toast.info("Nothing to export", {
          description: "No payments match the current filters.",
        });
        return;
      }
      saveCsvBlob(result.csv, result.filename);
      if (result.capped) {
        // Cap hit → surface as a warning (not silent success) so admins know
        // the file is truncated and can either narrow filters or switch to
        // the async "Export all" path.
        toast.warning(`Export truncated at ${result.rowCount.toLocaleString()} rows`, {
          description:
            "The 10,000-row inline limit was hit. Use 'Export all (async)' for the full result set.",
          duration: 8000,
        });
      } else {
        toast.success(
          scope === "page"
            ? `Exported ${result.rowCount.toLocaleString()} row(s) from page ${search.page + 1}.`
            : `Exported ${result.rowCount.toLocaleString()} row(s) matching current filters.`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      toast.error("Export failed", {
        description: msg,
        duration: 8000,
      });
    } finally {
      setExporting(false);
    }
  };

  // Async "Export all" path — enqueues a background job that isn't bound by
  // the 10k inline cap. The Exports bell polls for completion; users can
  // also navigate to /admin/exports to see the full history.
  const onExportAsync = async () => {
    setExporting(true);
    try {
      const { jobId } = await createExportJobFn({
        data: {
          filters: {
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
        },
      });
      toast.success("Export queued", {
        description: "We'll notify you here when the file is ready.",
        action: {
          label: "View exports",
          onClick: () => navigate({ to: "/admin/exports" }),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["admin-export-jobs-header"] });
      return jobId;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to queue export");
    } finally {
      setExporting(false);
    }
  };

  // Header bell: poll the caller's recent export jobs so we can toast when
  // a background export flips to succeeded and badge the ready count.
  const { data: myJobs } = useQuery({
    queryKey: ["admin-export-jobs-header"],
    queryFn: () => listExportJobsFn({ data: { limit: 10 } }),
    // Poll every 10s so the badge feels live without hammering the API;
    // this is independent of the ledger's polling preference.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const readyUnnotified = (myJobs ?? []).filter(
    (j) => j.status === "succeeded" && !j.notified_at,
  );
  const anyActive = (myJobs ?? []).some(
    (j) => j.status === "queued" || j.status === "running",
  );

  useEffect(() => {
    if (!readyUnnotified.length) return;
    for (const j of readyUnnotified) {
      toast.success("Export ready to download", {
        description: `${(j.row_count ?? 0).toLocaleString()} rows`,
        action: {
          label: "Download",
          onClick: async () => {
            try {
              const { url } = await getExportDownloadUrlFn({ data: { jobId: j.id } });
              window.location.href = url;
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Download failed");
            }
          },
        },
      });
    }
    markExportNotifiedFn({ data: { jobIds: readyUnnotified.map((j) => j.id) } })
      .then(() => queryClient.invalidateQueries({ queryKey: ["admin-export-jobs-header"] }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyUnnotified.map((j) => j.id).join(",")]);


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments Ledger</h1>
          <p className="text-sm text-muted-foreground">
            All Razorpay transactions across the platform.
          </p>
        </div>
        <PollingControls
          liveConnected={liveConnected}
          ariaLabel="Payments polling fallback interval"
          rightSlot={
            lastWebhook ? (
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
            )
          }
        />
        <div className="flex flex-wrap items-center gap-2">

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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!total || exporting}>
                {exporting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                Export CSV
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Export current filters</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onExport("page")}>
                Current page ({Math.min(search.pageSize, Math.max(0, total - search.page * search.pageSize))} row{Math.min(search.pageSize, Math.max(0, total - search.page * search.pageSize)) === 1 ? "" : "s"})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("filtered")}>
                All filtered rows ({total.toLocaleString()}{total >= 10_000 ? ", capped at 10k" : ""})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onExportAsync()}>
                <span className="flex flex-col">
                  <span>Export all (async){total > 10_000 ? " — recommended" : ""}</span>
                  <span className="text-[10px] text-muted-foreground">
                    Runs in the background, up to 250k rows. We'll notify you.
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="relative"
            title={anyActive ? "Background exports processing" : "Background exports"}
          >
            <Link to="/admin/exports" aria-label="Background exports">
              <Bell className="mr-2 h-4 w-4" />
              Exports
              {anyActive && (
                <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-sky-500 animate-pulse" aria-hidden />
              )}
              {readyUnnotified.length > 0 && (
                <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px]" variant="default">
                  {readyUnnotified.length}
                </Badge>
              )}
            </Link>
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
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick status filters">
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => {
                const meta = STATUS_META[s];
                const active = search.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    title={`Filter by ${meta.label}`}
                    onClick={() => setSearch({ status: s, page: 0 })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active ? meta.activeClass : "bg-background hover:bg-accent"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white/90" : meta.dot}`} />
                    {meta.label}
                  </button>
                );
              })}
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
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="hidden sm:inline">Sort by</span>
              <select
                value={search.sortBy}
                onChange={(e) => setSearch({ sortBy: e.target.value as SortCol, page: 0 })}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Sort field"
                title="Sort field (syncs with URL)"
              >
                {SORT_COLUMNS.map((c) => (
                  <option key={c} value={c}>{SORT_LABELS[c]}</option>
                ))}
              </select>
              <select
                value={search.sortDir}
                onChange={(e) => setSearch({ sortDir: e.target.value as "asc" | "desc", page: 0 })}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Sort direction"
                title="Sort direction (syncs with URL)"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </label>
            <select
              value={search.pageSize}
              onChange={(e) => setSearch({ pageSize: Number(e.target.value), page: 0 })}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              aria-label="Rows per page"
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
            <div className="overflow-x-auto" aria-busy="true" aria-label="Loading transactions">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {["Date","Customer","Membership","Inst.","Order / Payment","Method","Amount","Status","Reconciliation"].map((h) => (
                      <th key={h} className="py-2 pr-4 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.min(search.pageSize, 8) }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-3 pr-4"><Skeleton className="h-3 w-28" /></td>
                      <td className="py-3 pr-4">
                        <Skeleton className="mb-1 h-3 w-32" />
                        <Skeleton className="h-2.5 w-40" />
                      </td>
                      <td className="py-3 pr-4"><Skeleton className="h-3 w-20" /></td>
                      <td className="py-3 pr-4"><Skeleton className="h-3 w-10" /></td>
                      <td className="py-3 pr-4">
                        <Skeleton className="mb-1 h-2.5 w-36" />
                        <Skeleton className="h-2.5 w-32" />
                      </td>
                      <td className="py-3 pr-4"><Skeleton className="h-3 w-14" /></td>
                      <td className="py-3 pr-4"><Skeleton className="h-3 w-20" /></td>
                      <td className="py-3 pr-4"><Skeleton className="h-5 w-16 rounded-full" /></td>
                      <td className="py-3 pr-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading transactions…
              </div>
            </div>
          ) : rows.length === 0 ? (
            (() => {
              const activeFilters: { label: string; value: string; clear: Partial<z.infer<typeof searchSchema>> }[] = [];
              if (search.status !== "all") activeFilters.push({ label: "Status", value: STATUS_META[search.status as StatusKey]?.label ?? search.status, clear: { status: "all", page: 0 } });
              if (search.from) activeFilters.push({ label: "From", value: search.from, clear: { from: "", page: 0 } });
              if (search.to) activeFilters.push({ label: "To", value: search.to, clear: { to: "", page: 0 } });
              if (search.q) activeFilters.push({ label: "Search", value: search.q, clear: { q: "", page: 0 } });
              if (search.orderId) activeFilters.push({ label: "Order ID", value: search.orderId, clear: { orderId: "", page: 0 } });
              if (search.paymentId) activeFilters.push({ label: "Payment ID", value: search.paymentId, clear: { paymentId: "", page: 0 } });
              if (search.customer) activeFilters.push({ label: "Customer", value: search.customer, clear: { customer: "", page: 0 } });
              const hasFilters = activeFilters.length > 0;
              return (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="rounded-full border bg-muted/40 p-3">
                    <Inbox className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {hasFilters ? "No transactions match your filters" : "No transactions yet"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hasFilters
                        ? "Try adjusting or clearing filters below."
                        : "Payments will appear here as customers complete Razorpay checkout."}
                    </p>
                  </div>
                  {hasFilters && (
                    <>
                      <div className="flex max-w-2xl flex-wrap justify-center gap-1.5">
                        {activeFilters.map((f) => (
                          <Badge
                            key={f.label}
                            variant="secondary"
                            className="cursor-pointer gap-1 text-[11px]"
                            onClick={() => setSearch(f.clear)}
                            title={`Remove ${f.label} filter`}
                          >
                            <span className="text-muted-foreground">{f.label}:</span>
                            <span className="font-medium">{f.value}</span>
                            <span aria-hidden>×</span>
                          </Badge>
                        ))}
                      </div>
                      <Button
                        variant="outline"
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
                        <FilterX className="mr-1.5 h-3.5 w-3.5" /> Reset all filters
                      </Button>
                    </>
                  )}
                </div>
              );
            })()
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
                    const validation = validateAdminPaymentRowShape(r);
                    const invalid = !validation.ok;
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-b align-top last:border-0 hover:bg-accent/50"
                        onClick={() => {
                          if (invalid) {
                            const labels = validation.missing
                              .map((m) => ADMIN_PAYMENT_ROW_FIELD_LABELS[m])
                              .join(", ");
                            toast.warning(`Payment row is missing: ${labels}`);
                          }
                          setSelected(r);
                        }}
                      >
                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                          {new Date(r.paid_at ?? r.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1.5 font-medium">
                            {invalid && (
                              <AlertTriangle
                                className="h-3.5 w-3.5 text-amber-500"
                                aria-label={`Incomplete: ${validation.missing.map((m) => ADMIN_PAYMENT_ROW_FIELD_LABELS[m]).join(", ")}`}
                              />
                            )}
                            <span>{p?.full_name ?? "—"}</span>
                          </div>
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
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number((e.currentTarget.elements.namedItem("jump") as HTMLInputElement).value);
                    if (!Number.isFinite(n)) return;
                    const clamped = Math.min(pageCount, Math.max(1, Math.floor(n)));
                    if (clamped - 1 !== search.page) setSearch({ page: clamped - 1 });
                  }}
                >
                  <label htmlFor="jump-to-page" className="text-xs">Go to</label>
                  <Input
                    id="jump-to-page"
                    name="jump"
                    type="number"
                    min={1}
                    max={pageCount}
                    defaultValue={search.page + 1}
                    key={search.page}
                    className="h-8 w-16"
                    aria-label="Jump to page"
                  />
                  <Button type="submit" variant="outline" size="sm">Go</Button>
                </form>

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
