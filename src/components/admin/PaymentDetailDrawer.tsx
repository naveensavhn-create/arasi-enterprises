import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";


import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Copy, ExternalLink, ChevronLeft, ChevronRight, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useServerFn } from "@tanstack/react-start";
import { getWebhookEventPayload } from "@/lib/payments.functions";
import {
  validateAdminPaymentRowShape,
  ADMIN_PAYMENT_ROW_FIELD_LABELS as FIELD_LABELS,
  type AdminPaymentRow,
  type AdminPaymentRowRequiredField,
} from "@/lib/payments/validate-row";

/**
 * Runtime validation of the ledger row before the drawer renders it.
 * Delegates to the shared helper so the drawer and ledger apply the same
 * required-field rules (see `@/lib/payments/validate-row`).
 */
type RequiredField = AdminPaymentRowRequiredField;

/** Short remediation hints shown under each missing-field bullet in the drawer. */
const HINTS: Record<RequiredField, string> = {
  amount: "Reconcile with Razorpay dashboard; the stored value is invalid or negative.",
  currency: "Currency code is empty. Check the originating order metadata.",
  status: "Payment status is blank. Trigger a webhook replay or manual reconcile.",
  paymentId: "Marked paid without a Razorpay payment ID. Verify the webhook fired.",
  customerName: "Linked profile is missing or has no name/email. The customer may have been deleted.",
};


function validateRow(
  row: AdminPaymentRow,
): { ok: true } | { ok: false; missing: RequiredField[] } {
  const result = validateAdminPaymentRowShape(row);
  return result.ok ? { ok: true } : { ok: false, missing: result.missing };
}



const EVENTS_PAGE_SIZE = 10;
const RAW_MAX_BYTES = 96 * 1024; // 96 KB inline cap; larger payloads must be downloaded



type WebhookEvent = {
  id: string;
  event_id: string;
  event_type: string | null;
  order_id: string | null;
  payment_id: string | null;
  status: string | null;
  received_at: string;
  processed_at: string | null;
};


type MembershipRow = {
  id: string;
  membership_number: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  total_amount: number;
  paid_amount: number;
  advance_paid: number;
  plan_id: string;
  membership_plans: { name: string } | null;
};

type InstallmentRow = {
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
};

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed"),
  );
}

function Field({ label, value, mono, copyable }: { label: string; value: React.ReactNode; mono?: boolean; copyable?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`flex items-center gap-1 text-right text-sm ${mono ? "font-mono text-xs" : ""}`}>
        <span className="break-all">{value ?? "—"}</span>
        {copyable && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => copy(copyable, label)}
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

interface Props {
  row: AdminPaymentRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function PaymentDetailDrawer({ row, open, onOpenChange }: Props) {
  const orderId = row?.provider_order_id ?? null;
  const paymentId = row?.provider_payment_id ?? null;
  const membershipId = row?.membership_id ?? null;
  const installmentId = row?.installment_id ?? null;

  const [eventsPage, setEventsPage] = useState(0);

  // Surface a missing-field toast the first time the drawer opens with a row
  // that fails runtime validation. Keyed on (open, row.id) so re-renders don't
  // spam and each newly-opened invalid row still notifies exactly once.
  useEffect(() => {
    if (!open || !row) return;
    const v = validateAdminPaymentRowShape(row);
    if (v.ok) return;
    const labels = v.missing.map((m) => FIELD_LABELS[m]).join(", ");
    toast.warning(`Payment row is missing: ${labels}`, {
      id: `payment-row-missing-${row.id}`,
    });
  }, [open, row]);

  const { data: eventsResult, isLoading: eventsLoading } = useQuery({
    queryKey: ["payment-webhook-events", orderId, paymentId, eventsPage],
    enabled: open && (!!orderId || !!paymentId),
    queryFn: async (): Promise<{ rows: WebhookEvent[]; total: number }> => {
      const from = eventsPage * EVENTS_PAGE_SIZE;
      const to = from + EVENTS_PAGE_SIZE - 1;
      let q = supabase
        .from("razorpay_webhook_events")
        .select(
          "id, event_id, event_type, order_id, payment_id, status, received_at, processed_at",
          { count: "exact" },
        )
        .order("received_at", { ascending: false })
        .range(from, to);
      if (orderId && paymentId) {
        q = q.or(`order_id.eq.${orderId},payment_id.eq.${paymentId}`);
      } else if (orderId) {
        q = q.eq("order_id", orderId);
      } else if (paymentId) {
        q = q.eq("payment_id", paymentId);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as WebhookEvent[], total: count ?? 0 };
    },
  });

  const events = eventsResult?.rows;
  const eventsTotal = eventsResult?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(eventsTotal / EVENTS_PAGE_SIZE));


  const { data: membership } = useQuery({
    queryKey: ["payment-membership", membershipId],
    enabled: open && !!membershipId,
    queryFn: async (): Promise<MembershipRow | null> => {
      const { data, error } = await supabase
        .from("memberships")
        .select("id, membership_number, status, start_date, end_date, total_amount, paid_amount, advance_paid, plan_id, membership_plans(name)")
        .eq("id", membershipId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as MembershipRow | null;
    },
  });

  const { data: installment } = useQuery({
    queryKey: ["payment-installment", installmentId],
    enabled: open && !!installmentId,
    queryFn: async (): Promise<InstallmentRow | null> => {
      const { data, error } = await supabase
        .from("installments")
        .select("id, sequence, due_date, amount, status, paid_at")
        .eq("id", installmentId!)
        .maybeSingle();
      if (error) throw error;
      return data as InstallmentRow | null;
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Payment detail
            {row && (
              <Badge
                variant={row.status === "paid" ? "default" : row.status === "failed" ? "destructive" : "secondary"}
                className="capitalize"
              >
                {row.status}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Razorpay identifiers, webhook history, and linked membership/installment.
          </SheetDescription>
        </SheetHeader>

        {!row ? null : (() => {
          const validation = validateRow(row);
          const missing = validation.ok ? [] : validation.missing;
          const missingSet = new Set(missing);
          const amountNum = Number(row.amount);
          const amountSafe = Number.isFinite(amountNum) && amountNum >= 0;
          const hasName = Boolean(row.profile?.full_name?.trim() || row.profile?.email?.trim());
          const displayName =
            row.profile?.full_name?.trim() ||
            row.profile?.email?.trim() ||
            UNAVAILABLE_LABEL;
          return (
          <div className="mt-4 space-y-5">
            {missing.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Incomplete payment record</AlertTitle>
                <AlertDescription>
                  <p className="text-xs">
                    This row is missing required data. Missing values are shown
                    as <span className="font-medium">“{UNAVAILABLE_LABEL}”</span> below —
                    verify with the provider before acting on it.
                  </p>
                  <ul className="mt-2 list-inside list-disc text-xs">
                    {missing.map((f) => (
                      <li key={f}>
                        <span className="font-medium">{FIELD_LABELS[f]}</span>
                        <span className="opacity-80"> — {HINTS[f]}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="opacity-80">Row ID:</span>
                    <span className="font-mono">{row.id}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={async () => {
                        const rowId = row.id;
                        const toastId = `payment-row-copy-${rowId}`;
                        try {
                          if (!navigator.clipboard?.writeText) {
                            throw new Error("Clipboard API unavailable in this browser.");
                          }
                          await navigator.clipboard.writeText(rowId);
                          toast.success("Row ID copied", {
                            id: toastId,
                            description: rowId,
                          });
                        } catch (err) {
                          const message =
                            err instanceof Error ? err.message : "Unknown clipboard error";
                          toast.error("Couldn't copy row ID", {
                            id: toastId,
                            description: message,
                          });
                        }
                      }}
                    >
                      <Copy className="mr-1 h-3 w-3" /> Copy
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {/* Customer */}
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Customer</div>
              <div className="mt-1 font-medium">
                {hasName ? (
                  displayName
                ) : (
                  <UnavailableTag reason={missingSet.has("customerName") ? "Linked profile missing" : undefined} />
                )}
              </div>
              {row.profile?.email && (
                <div className="text-xs text-muted-foreground">{row.profile.email}</div>
              )}
            </div>

            {/* Amount */}
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Amount</div>
              <div className="mt-1 text-2xl font-bold text-gradient-gold">
                {amountSafe && row.currency ? (
                  <>
                    {row.currency} {amountNum.toLocaleString("en-IN")}
                  </>
                ) : (
                  <UnavailableTag
                    reason={
                      !amountSafe && !row.currency
                        ? "Amount and currency missing"
                        : !amountSafe
                          ? "Amount invalid"
                          : "Currency missing"
                    }
                  />
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Created {new Date(row.created_at).toLocaleString()}
                {row.paid_at && ` · Paid ${new Date(row.paid_at).toLocaleString()}`}
              </div>
            </div>



            {/* Razorpay */}
            <section>
              <h3 className="mb-1 text-sm font-semibold">Razorpay</h3>
              <div className="rounded-lg border p-3">
                <Field label="Order ID" value={row.provider_order_id ?? "—"} mono copyable={row.provider_order_id ?? undefined} />
                <Field label="Payment ID" value={row.provider_payment_id ?? "—"} mono copyable={row.provider_payment_id ?? undefined} />
                <Field label="Method" value={<span className="capitalize">{row.method ?? "—"}</span>} />
                <Field label="Provider" value={<span className="capitalize">{row.provider}</span>} />
                {eventsPage === 0 && events && events[0] && (
                  <>
                    <Separator className="my-2" />
                    <Field
                      label="Latest webhook"
                      value={
                        <span className="flex items-center gap-1.5">
                          {events[0].status && (
                            <Badge variant="outline" className="text-[10px] capitalize">{events[0].status}</Badge>
                          )}
                          <span className="text-[11px] text-muted-foreground">{events[0].event_type ?? "—"}</span>
                        </span>
                      }
                    />
                    <Field
                      label="Webhook event ID"
                      value={events[0].event_id}
                      mono
                      copyable={events[0].event_id}
                    />
                    <Field
                      label="Webhook row ID"
                      value={events[0].id}
                      mono
                      copyable={events[0].id}
                    />
                  </>
                )}
                {row.provider_payment_id && (
                  <div className="pt-2">
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                    >
                      <a
                        href={`https://dashboard.razorpay.com/app/payments/${row.provider_payment_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Razorpay <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                )}
                {row.error_code && (
                  <>
                    <Separator className="my-2" />
                    <Field label="Error code" value={<span className="text-destructive">{row.error_code}</span>} />
                    {row.error_description && (
                      <Field label="Error message" value={<span className="text-destructive">{row.error_description}</span>} />
                    )}
                  </>
                )}
              </div>
            </section>

            {/* Customer */}
            <section>
              <h3 className="mb-1 text-sm font-semibold">Customer</h3>
              <div className="rounded-lg border p-3">
                <Field label="Name" value={row.profile?.full_name ?? "—"} />
                <Field label="Email" value={row.profile?.email ?? "—"} copyable={row.profile?.email ?? undefined} />
                <Field label="User ID" value={row.customer_id} mono copyable={row.customer_id} />
              </div>
            </section>

            {/* Membership */}
            <section>
              <h3 className="mb-1 text-sm font-semibold">Membership</h3>
              <div className="rounded-lg border p-3">
                {membership ? (
                  <>
                    <Field label="Plan" value={membership.membership_plans?.name ?? "—"} />
                    <Field label="Number" value={membership.membership_number ?? "—"} mono copyable={membership.membership_number ?? undefined} />
                    <Field
                      label="Status"
                      value={<Badge variant="outline" className="capitalize">{membership.status}</Badge>}
                    />
                    <Field
                      label="Progress"
                      value={`₹${Number(membership.paid_amount).toLocaleString("en-IN")} / ₹${Number(membership.total_amount).toLocaleString("en-IN")}`}
                    />
                    <Field
                      label="Term"
                      value={`${new Date(membership.start_date).toLocaleDateString()} → ${membership.end_date ? new Date(membership.end_date).toLocaleDateString() : "—"}`}
                    />
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No linked membership.</p>
                )}
              </div>
            </section>

            {/* Installment */}
            <section>
              <h3 className="mb-1 text-sm font-semibold">Installment</h3>
              <div className="rounded-lg border p-3">
                {installment ? (
                  <>
                    <Field label="Sequence" value={`#${installment.sequence}`} />
                    <Field label="Due date" value={new Date(installment.due_date).toLocaleDateString()} />
                    <Field
                      label="Amount"
                      value={`₹${Number(installment.amount).toLocaleString("en-IN")}`}
                    />
                    <Field
                      label="Status"
                      value={<Badge variant="outline" className="capitalize">{installment.status}</Badge>}
                    />
                    {installment.paid_at && (
                      <Field label="Paid at" value={new Date(installment.paid_at).toLocaleString()} />
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Advance payment — no installment reference.
                  </p>
                )}
              </div>
            </section>

            {/* Webhook events */}
            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  Webhook events
                  {eventsTotal > 0 && (
                    <Badge variant="secondary" className="text-[10px]">{eventsTotal}</Badge>
                  )}
                </h3>
                {eventsTotal > EVENTS_PAGE_SIZE && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={eventsPage === 0 || eventsLoading}
                      onClick={() => setEventsPage((p) => Math.max(0, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span>
                      {eventsPage + 1} / {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={eventsPage + 1 >= totalPages || eventsLoading}
                      onClick={() => setEventsPage((p) => p + 1)}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="rounded-lg border">
                {eventsLoading ? (
                  <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading events…
                  </div>
                ) : !events || events.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    No webhook events recorded for this order/payment yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {events.map((e, idx) => (
                      <li key={e.id} className="p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium flex items-center gap-1.5">
                            {e.event_type ?? "—"}
                            {idx === 0 && eventsPage === 0 && (
                              <Badge variant="default" className="h-4 px-1 text-[9px]">Latest</Badge>
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(e.received_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                          {e.status && <Badge variant="outline" className="text-[10px] capitalize">{e.status}</Badge>}
                          <span className="font-mono text-[10px] break-all">{e.event_id}</span>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => copy(e.event_id, "Event ID")}
                            aria-label="Copy event ID"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="uppercase tracking-wider">DB row</span>
                          <span className="font-mono break-all">{e.id}</span>
                          <button
                            className="hover:text-foreground"
                            onClick={() => copy(e.id, "Webhook row ID")}
                            aria-label="Copy webhook row ID"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        {e.processed_at && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            Processed {new Date(e.processed_at).toLocaleString()}
                          </div>
                        )}
                        <RawPayload eventRowId={e.id} eventId={e.event_id} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

          </div>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}

function RawPayload({ eventRowId, eventId }: { eventRowId: string; eventType?: string } & { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fetchPayload = useServerFn(getWebhookEventPayload);

  // Cheap metadata probe — no JSON body, just size + oversized flag.
  const { data: meta, isLoading, error } = useQuery({
    queryKey: ["webhook-event-meta", eventRowId],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: () => fetchPayload({ data: { eventRowId, mode: "meta" } }),
  });

  // Small preview payload for inline display when the event is not oversized.
  // Kept separate from the download flow so oversized events never fetch bytes.
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["webhook-event-preview", eventRowId],
    enabled: open && !!meta && !meta.oversized && !meta.empty,
    staleTime: 5 * 60_000,
    queryFn: () => fetchPayload({ data: { eventRowId, mode: "download" } }),
  });

  const RAW_PREVIEW_BYTES = 96 * 1024;
  const previewText = preview?.json ?? "";
  const previewTruncated = previewText.length > RAW_PREVIEW_BYTES;

  const downloadFull = async () => {
    if (!meta) return;
    if (meta.oversized) {
      toast.error(
        `Payload is ${(meta.bytes / 1024 / 1024).toFixed(2)} MB — exceeds the ${(meta.maxBytes / 1024 / 1024).toFixed(0)} MB download limit. Query the database directly.`,
      );
      return;
    }
    setDownloading(true);
    try {
      const full = preview ?? (await fetchPayload({ data: { eventRowId, mode: "download" } }));
      const blob = new Blob([full.json ?? ""], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `webhook-${eventId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("PAYLOAD_TOO_LARGE:")) {
        const [, size, cap] = msg.split(":");
        toast.error(
          `Payload is ${(Number(size) / 1024 / 1024).toFixed(2)} MB — exceeds the ${(Number(cap) / 1024 / 1024).toFixed(0)} MB download cap.`,
        );
      } else if (msg === "Forbidden") {
        toast.error("You do not have permission to download this payload.");
      } else {
        toast.error(`Download failed: ${msg}`);
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾ Hide raw payload" : "▸ Raw payload"}
      </button>
      {open && (
        <div className="mt-1">
          {isLoading ? (
            <div className="flex items-center rounded bg-muted p-2 text-[10px] text-muted-foreground">
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Checking payload…
            </div>
          ) : error ? (
            <p className="rounded bg-muted p-2 text-[10px] text-destructive">
              Failed to load payload metadata.
            </p>
          ) : !meta || meta.empty ? (
            <p className="rounded bg-muted p-2 text-[10px] text-muted-foreground">
              No payload stored.
            </p>
          ) : meta.oversized ? (
            <Alert variant="destructive" className="py-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertTitle className="text-[11px]">Payload too large for browser</AlertTitle>
              <AlertDescription className="text-[10px]">
                {(meta.bytes / 1024 / 1024).toFixed(2)} MB — exceeds the{" "}
                {(meta.maxBytes / 1024 / 1024).toFixed(0)} MB download cap. Inline preview and
                download are disabled to protect the session. Query{" "}
                <code className="rounded bg-background/50 px-1">razorpay_webhook_events</code>{" "}
                directly with the event id above.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>
                  {(meta.bytes / 1024).toFixed(1)} KB
                  {previewTruncated && " • truncated preview"}
                </span>
                <button
                  type="button"
                  onClick={downloadFull}
                  disabled={downloading || previewLoading}
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-accent disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Download full JSON
                </button>
              </div>
              {previewLoading ? (
                <div className="flex items-center rounded bg-muted p-2 text-[10px] text-muted-foreground">
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Loading preview…
                </div>
              ) : (
                <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">
                  {previewTruncated
                    ? previewText.slice(0, RAW_PREVIEW_BYTES) + "\n… (truncated — download for full JSON)"
                    : previewText}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}


