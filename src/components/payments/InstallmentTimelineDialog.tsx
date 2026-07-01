import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInstallmentWebhookTimeline } from "@/lib/payments.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, RefreshCw, ArrowRightCircle, Zap } from "lucide-react";
import { useState } from "react";

function eventIcon(type: string | null) {
  const t = (type ?? "").toLowerCase();
  if (t.includes("captured") || t.includes("paid"))
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (t.includes("failed")) return <XCircle className="h-4 w-4 text-destructive" />;
  if (t.includes("refund")) return <RefreshCw className="h-4 w-4 text-amber-500" />;
  if (t.includes("authorized")) return <Zap className="h-4 w-4 text-blue-500" />;
  return <ArrowRightCircle className="h-4 w-4 text-muted-foreground" />;
}

export function InstallmentTimelineDialog({
  installmentId,
  open,
  onOpenChange,
}: {
  installmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fn = useServerFn(getInstallmentWebhookTimeline);
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["installment-timeline", installmentId],
    enabled: open && !!installmentId,
    queryFn: () => fn({ data: { installmentId: installmentId! } }),
    refetchInterval: open ? 6000 : false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Webhook timeline</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.installment.membership_number ?? "—"} · Installment #${data.installment.sequence} · Due ${new Date(data.installment.due_date).toLocaleDateString()}`
              : "Razorpay events recorded for this installment"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading events…
          </div>
        ) : error ? (
          <p className="py-6 text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load timeline"}
          </p>
        ) : !data || data.events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No webhook events recorded yet for this installment.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-2">
            <ol className="relative border-l border-border pl-5">
              {data.events.map((e) => {
                const isOpen = !!showRaw[e.id];
                return (
                  <li key={e.id} className="mb-5 last:mb-0">
                    <span className="absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-background">
                      {eventIcon(e.event_type)}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{e.event_type ?? "unknown"}</span>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {e.status}
                      </Badge>
                      {e.resulting_installment_status && (
                        <Badge
                          variant={
                            e.resulting_installment_status === "paid"
                              ? "default"
                              : e.resulting_installment_status === "payment failed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[10px] capitalize"
                        >
                          → {e.resulting_installment_status}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Received {new Date(e.received_at).toLocaleString()}
                      {e.processed_at !== e.received_at
                        ? ` · Processed ${new Date(e.processed_at).toLocaleString()}`
                        : ""}
                    </div>
                    <div className="mt-1 grid gap-0.5 text-[11px] text-muted-foreground">
                      {e.payment_provider_id && (
                        <div>
                          <span className="text-foreground/70">Payment:</span>{" "}
                          <span className="font-mono">{e.payment_provider_id}</span>
                          {e.amount != null && (
                            <span> · {e.currency ?? "INR"} {Number(e.amount).toLocaleString("en-IN")}</span>
                          )}
                        </div>
                      )}
                      {e.order_id && (
                        <div>
                          <span className="text-foreground/70">Order:</span>{" "}
                          <span className="font-mono">{e.order_id}</span>
                        </div>
                      )}
                      {e.error_code && (
                        <div className="text-destructive">
                          {e.error_code}: {e.error_description ?? ""}
                        </div>
                      )}
                    </div>
                    {e.raw && (
                      <button
                        onClick={() => setShowRaw((s) => ({ ...s, [e.id]: !s[e.id] }))}
                        className="mt-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {isOpen ? "Hide" : "Show"} raw payload
                      </button>
                    )}
                    {isOpen && (
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] leading-tight">
                        {JSON.stringify(e.raw, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
