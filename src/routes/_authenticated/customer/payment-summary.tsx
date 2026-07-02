import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMyPaymentSummaries,
  type PaymentSummary,
} from "@/lib/payment-summary.functions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Activity,
  Gift,
  Ticket,
  ShieldCheck,
  Receipt,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute(
  "/_authenticated/customer/payment-summary",
)({
  component: PaymentSummaryPage,
});

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    completed: "bg-sky-500/10 text-sky-500 border-sky-500/30",
    cancelled: "bg-red-500/10 text-red-500 border-red-500/30",
  };
  return (
    <Badge
      variant="outline"
      className={map[status] ?? "bg-muted text-muted-foreground"}
    >
      {status}
    </Badge>
  );
}

function SummaryCard({ item }: { item: PaymentSummary }) {
  const rewardsCount = item.rewards.length;
  const drawsCount = item.draws.length;

  return (
    <AccordionItem
      value={item.payment_id}
      className="border rounded-lg bg-card"
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex flex-1 flex-wrap items-center gap-3 pr-4 text-left">
          <div className="flex items-center gap-2 min-w-[9rem]">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium tabular-nums">
              {inr(item.amount)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground min-w-[10rem]">
            {fmtDateTime(item.paid_at)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.installment_sequence != null && (
              <Badge variant="secondary" className="text-[10px]">
                Installment #{item.installment_sequence}
              </Badge>
            )}
            {item.membership?.became_active && (
              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                Membership activated
              </Badge>
            )}
            {item.membership?.became_completed && (
              <Badge className="text-[10px] bg-sky-500/15 text-sky-500 border-sky-500/30">
                Plan completed
              </Badge>
            )}
            {rewardsCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30"
              >
                <Gift className="mr-1 h-3 w-3" />
                {rewardsCount} reward{rewardsCount === 1 ? "" : "s"}
              </Badge>
            )}
            {drawsCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] bg-violet-500/10 text-violet-500 border-violet-500/30"
              >
                <Ticket className="mr-1 h-3 w-3" />
                {drawsCount} draw{drawsCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          {item.receipt_number && (
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {item.receipt_number}
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Membership snapshot */}
          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Membership status
            </div>
            {item.membership ? (
              <>
                <div className="grid grid-cols-2 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Plan</span>
                  <span>{item.membership.plan_name ?? "—"}</span>
                  <span className="text-muted-foreground">Member ID</span>
                  <span className="font-mono">
                    {item.membership.member_display_id ??
                      item.membership.membership_number ??
                      "—"}
                  </span>
                  <span className="text-muted-foreground">Status after</span>
                  <span>
                    <StatusBadge status={item.membership.status_after} />
                  </span>
                  <span className="text-muted-foreground">Paid so far</span>
                  <span className="tabular-nums">
                    {inr(item.membership.paid_amount)}
                    {item.membership.plan_total_amount != null && (
                      <span className="text-muted-foreground">
                        {" "}
                        / {inr(item.membership.plan_total_amount)}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">Installments</span>
                  <span className="tabular-nums">
                    {item.membership.paid_installments} /{" "}
                    {item.membership.total_installments}
                  </span>
                </div>
                {item.membership.total_installments > 0 && (
                  <Progress
                    value={item.membership.progress_percent}
                    className="mt-3 h-1.5"
                  />
                )}
                {(item.membership.became_active ||
                  item.membership.became_completed) && (
                  <div className="mt-3 flex items-center gap-1.5 rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-500">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {item.membership.became_completed
                      ? "This payment completed your plan."
                      : "This payment activated your membership."}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground">
                No membership linked to this payment.
              </div>
            )}
          </div>

          {/* Reward + draw cascades */}
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Gift className="h-4 w-4 text-amber-500" />
                Rewards triggered
              </div>
              {item.rewards.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No new reward eligibility changed by this payment.
                </div>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {item.rewards.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">
                          {r.tier_name ?? "Reward"}{" "}
                          {r.tier_value != null && (
                            <span className="text-muted-foreground">
                              ({inr(r.tier_value)})
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {r.event_type === "unlocked" ? (
                            <>Unlocked</>
                          ) : r.from_status ? (
                            <span className="inline-flex items-center gap-1">
                              {r.from_status}
                              <ArrowRight className="h-3 w-3" />
                              {r.to_status ?? "—"}
                            </span>
                          ) : (
                            r.event_type
                          )}
                          {r.reward_number && (
                            <span className="ml-2 font-mono text-[10px]">
                              {r.reward_number}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Ticket className="h-4 w-4 text-violet-500" />
                Lucky draw entries
              </div>
              {item.draws.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No new draw entries generated by this payment.
                </div>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {item.draws.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-medium">
                          {d.draw_title ?? "Draw"}
                        </span>
                        {d.draw_status && (
                          <span className="ml-2 text-muted-foreground">
                            · {d.draw_status}
                          </span>
                        )}
                      </div>
                      {d.entry_number && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {d.entry_number}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {(item.receipt_number || item.provider_payment_id) && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {item.provider_payment_id && (
              <span className="font-mono">
                Txn: {item.provider_payment_id}
              </span>
            )}
            {item.payment_method && (
              <span>Method: {item.payment_method.toUpperCase()}</span>
            )}
            {item.receipt_number && (
              <Button asChild variant="outline" size="sm" className="ml-auto">
                <Link
                  to="/receipts/$receiptNumber"
                  params={{ receiptNumber: item.receipt_number }}
                >
                  View receipt
                </Link>
              </Button>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function PaymentSummaryPage() {
  const fetchSummaries = useServerFn(listMyPaymentSummaries);
  const q = useQuery({
    queryKey: ["customer", "payment-summary"],
    queryFn: () => fetchSummaries({ data: { limit: 50 } }),
  });
  const rows = q.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Payment Processing Summary
        </h1>
        <p className="text-sm text-muted-foreground">
          After each successful payment, we automatically update your
          membership status, unlock any rewards you qualify for, and enter you
          into eligible lucky draws. Every payment below shows what changed.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Payment-driven activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading your payment history…
            </div>
          ) : q.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Couldn't load payment summaries. Please refresh and try again.
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No successful payments yet. Once your first payment clears, you'll
              see membership, reward, and draw updates here.
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {rows.map((r) => (
                <SummaryCard key={r.payment_id} item={r} />
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Showing your {rows.length} most recent successful payment
        {rows.length === 1 ? "" : "s"}. Reward and draw activity is correlated
        to each payment within a 5-minute window after processing.
      </p>
    </div>
  );
}

export { fmtDate };
