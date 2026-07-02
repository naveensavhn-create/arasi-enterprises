import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListReceipts, adminVoidReceipt } from "@/lib/receipts.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Ban, Download, Eye, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/receipts")({
  component: AdminReceiptsPage,
});

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function AdminReceiptsPage() {
  const [search, setSearch] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const qc = useQueryClient();
  const listFn = useServerFn(adminListReceipts);
  const voidFn = useServerFn(adminVoidReceipt);

  const q = useQuery({
    queryKey: ["admin-receipts", search, includeVoided],
    queryFn: () => listFn({ data: { search: search.trim() || undefined, includeVoided } }),
  });

  const voidMut = useMutation({
    mutationFn: (v: { receiptId: string; reason: string }) => voidFn({ data: v }),
    onSuccess: () => {
      toast.success("Receipt voided");
      setVoidTarget(null);
      setVoidReason("");
      qc.invalidateQueries({ queryKey: ["admin-receipts"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to void"),
  });

  const rows = q.data ?? [];

  const exportCsv = () => {
    const header = ["Receipt No", "Issued", "Customer", "Email", "Membership", "For", "Amount", "Currency", "Method", "Txn ID", "Status", "Voided At", "Void Reason"];
    const lines = rows.map((r) => [
      r.receipt_number, fmt(r.issued_at), r.customer_name ?? "", r.customer_email ?? "",
      r.member_display_id ?? r.membership_number ?? "",
      r.installment_sequence ? `Installment #${r.installment_sequence}` : "Advance",
      r.amount, r.currency, r.payment_method ?? "", r.transaction_id ?? "",
      r.voided_at ? "VOID" : "PAID",
      r.voided_at ? fmt(r.voided_at) : "", r.void_reason ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          Sequential receipts (ARASI-YYYY-000000) generated automatically for each paid payment.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">All receipts</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Receipt no / Transaction ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeVoided} onCheckedChange={(v) => setIncludeVoided(Boolean(v))} />
              Include voided
            </label>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt No.</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No receipts match.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                  <TableCell className="text-xs">{fmt(r.issued_at)}</TableCell>
                  <TableCell>
                    <div className="text-sm">{r.customer_name ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground">{r.customer_email}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.member_display_id ?? r.membership_number ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.installment_sequence ? `Installment #${r.installment_sequence}` : "Advance"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{inr(r.amount)}</TableCell>
                  <TableCell>
                    {r.voided_at ? (
                      <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">Void</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Paid</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm" title="View">
                      <Link to="/receipts/$receiptNumber" params={{ receiptNumber: r.receipt_number }}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm" title="Reprint">
                      <Link to="/receipts/$receiptNumber" params={{ receiptNumber: r.receipt_number }}>
                        <Printer className="h-4 w-4" />
                      </Link>
                    </Button>
                    {!r.voided_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Void"
                        onClick={() => setVoidTarget({ id: r.id, number: r.receipt_number })}
                      >
                        <Ban className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void receipt {voidTarget?.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Voiding is permanent and logged in the audit trail. The receipt stays in history marked as VOID.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason (required)"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            className="min-h-[80px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voidMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={voidReason.trim().length < 3 || voidMut.isPending}
              onClick={() =>
                voidTarget && voidMut.mutate({ receiptId: voidTarget.id, reason: voidReason.trim() })
              }
            >
              {voidMut.isPending ? "Voiding…" : "Void receipt"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
