import { useState } from "react";
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
import { Loader2, Copy, ExternalLink, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import type { AdminPaymentRow } from "@/lib/payments.functions";

export type PaymentDetailRow = AdminPaymentRow;

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
  row: PaymentDetailRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function PaymentDetailDrawer({ row, open, onOpenChange }: Props) {
  const orderId = row?.provider_order_id ?? null;
  const paymentId = row?.provider_payment_id ?? null;
  const membershipId = row?.membership_id ?? null;
  const installmentId = row?.installment_id ?? null;

  const [eventsPage, setEventsPage] = useState(0);

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

        {!row ? null : (
          <div className="mt-4 space-y-5">
            {/* Amount */}
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Amount</div>
              <div className="mt-1 text-2xl font-bold text-gradient-gold">
                {row.currency} {Number(row.amount).toLocaleString("en-IN")}
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
                    {events.map((e) => (
                      <li key={e.id} className="p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{e.event_type ?? "—"}</span>
                          <span className="text-muted-foreground">
                            {new Date(e.received_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                          {e.status && <Badge variant="outline" className="text-[10px] capitalize">{e.status}</Badge>}
                          <span className="font-mono text-[10px] break-all">{e.event_id}</span>
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
        )}
      </SheetContent>
    </Sheet>
  );
}
