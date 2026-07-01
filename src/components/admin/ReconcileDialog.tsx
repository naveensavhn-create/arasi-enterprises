import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck, Download } from "lucide-react";
import { toast } from "sonner";
import {
  reconcilePayments,
  listOpenReconciliations,
  resolveReconciliation,
  type ReconciliationResult,
  type ReconciliationRow,
} from "@/lib/payments.functions";
import type { PaymentStatus } from "@/lib/payments/status-filter";

// `status` is the shared `payment_status` enum union — never a plain string —
// so the dialog can only forward values that the server-fn schema accepts.
type Filters = {
  status?: PaymentStatus;
  from?: string;
  to?: string;
  q?: string;
};

export function ReconcileDialog({
  open,
  onOpenChange,
  filters,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: Filters;
}) {
  const qc = useQueryClient();
  const runFn = useServerFn(reconcilePayments);
  const listFn = useServerFn(listOpenReconciliations);
  const resolveFn = useServerFn(resolveReconciliation);
  const [result, setResult] = useState<ReconciliationResult | null>(null);

  const openList = useQuery({
    queryKey: ["open-reconciliations"],
    queryFn: () => listFn({ data: { limit: 200 } }),
    enabled: open,
  });

  const runMut = useMutation({
    mutationFn: () => runFn({ data: { ...filters, limit: 100 } }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["open-reconciliations"] });
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
      if (r.mismatched > 0) {
        toast.warning(`${r.mismatched} mismatch(es) flagged for review`);
      } else if (r.errors > 0) {
        toast.error(`Completed with ${r.errors} lookup errors`);
      } else {
        toast.success(`All ${r.matched} checked payments are in sync`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reconciliation failed"),
  });

  const resolveMut = useMutation({
    mutationFn: (v: { id: string; apply: boolean }) =>
      resolveFn({ data: { id: v.id, applyProviderStatus: v.apply } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["open-reconciliations"] });
      qc.invalidateQueries({ queryKey: ["admin-payments"] });
      toast.success("Reconciliation resolved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to resolve"),
  });

  const openRows = openList.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Reconcile with Razorpay
          </DialogTitle>
          <DialogDescription>
            Fetches the latest status from Razorpay for up to 100 payments matching the current
            filters and flags any that differ from what we've stored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">
              Scope:{" "}
              <span className="font-mono">
                {filters.status && filters.status !== "all" ? filters.status : "all"}
                {filters.from ? ` · from ${filters.from}` : ""}
                {filters.to ? ` · to ${filters.to}` : ""}
                {filters.q ? ` · "${filters.q}"` : ""}
              </span>
            </div>
            <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
              {runMut.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Run check
            </Button>
          </div>

          {result && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <Stat label="Checked" value={result.checked} />
              <Stat label="In sync" value={result.matched} tone="ok" />
              <Stat label="Mismatched" value={result.mismatched} tone="warn" />
              <Stat label="Skipped" value={result.skipped} />
              <Stat label="Errors" value={result.errors} tone="err" />
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Open mismatches</h3>
              <div className="flex items-center gap-2">
                {openList.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={openRows.length === 0}
                  onClick={() => exportMismatchesCsv(openRows)}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </div>
            </div>
            {openRows.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                No open mismatches. Everything is reconciled.
              </div>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr className="text-left text-muted-foreground">
                      <th className="p-2 font-medium">Payment</th>
                      <th className="p-2 font-medium">Stored</th>
                      <th className="p-2 font-medium">Razorpay</th>
                      <th className="p-2 font-medium">Note</th>
                      <th className="p-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openRows.map((r) => (
                      <tr key={r.id} className="border-t align-top">
                        <td className="p-2 font-mono">
                          <div>{r.payment?.provider_payment_id ?? "—"}</div>
                          <div className="text-muted-foreground">{r.payment?.provider_order_id ?? ""}</div>
                        </td>
                        <td className="p-2">
                          <Badge variant="secondary" className="capitalize">{r.stored_status}</Badge>
                        </td>
                        <td className="p-2">
                          <Badge variant="destructive" className="capitalize">
                            {r.provider_status ?? "unknown"}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">{r.note}</td>
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resolveMut.isPending}
                              onClick={() => resolveMut.mutate({ id: r.id, apply: true })}
                            >
                              Apply & resolve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={resolveMut.isPending}
                              onClick={() => resolveMut.mutate({ id: r.id, apply: false })}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "err" }) {
  const color =
    tone === "ok" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "err" ? "text-destructive" : "";
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : null;
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`flex items-center gap-1 text-lg font-semibold ${color}`}>
        {Icon ? <Icon className="h-4 w-4" /> : null}
        {value}
      </div>
    </div>
  );
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportMismatchesCsv(rows: ReconciliationRow[]) {
  const headers = [
    "reconciliation_id",
    "payment_id",
    "provider_order_id",
    "provider_payment_id",
    "stored_status",
    "provider_status",
    "provider_amount",
    "provider_method",
    "provider_error",
    "amount",
    "currency",
    "customer_id",
    "membership_id",
    "note",
    "created_at",
    "resolved_at",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.payment_id,
        r.payment?.provider_order_id ?? "",
        r.payment?.provider_payment_id ?? "",
        r.stored_status,
        r.provider_status ?? "",
        r.provider_amount ?? "",
        r.provider_method ?? "",
        r.provider_error ?? "",
        r.payment?.amount ?? "",
        r.payment?.currency ?? "",
        r.payment?.customer_id ?? "",
        r.payment?.membership_id ?? "",
        r.note ?? "",
        r.created_at,
        r.resolved_at ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reconciliation-mismatches-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
