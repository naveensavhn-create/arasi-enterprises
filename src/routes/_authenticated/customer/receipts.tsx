import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyReceipts } from "@/lib/receipts.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/customer/receipts")({
  component: CustomerReceiptsPage,
});

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });

function CustomerReceiptsPage() {
  const fetchReceipts = useServerFn(listMyReceipts);
  const q = useQuery({ queryKey: ["customer-receipts"], queryFn: () => fetchReceipts() });
  const rows = q.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Receipts</h1>
        <p className="text-sm text-muted-foreground">
          Every successful payment produces a numbered receipt. Open one to print or save as PDF.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Receipt history</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No receipts yet. They appear here after each successful payment.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.receipt_number}</TableCell>
                  <TableCell>{fmt(r.issued_at)}</TableCell>
                  <TableCell>
                    {r.installment_sequence ? `Installment #${r.installment_sequence}` : "Advance"}
                    {r.plan_name && <div className="text-[11px] text-muted-foreground">{r.plan_name}</div>}
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
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/receipts/$receiptNumber" params={{ receiptNumber: r.receipt_number }}>
                        <Eye className="mr-1 h-4 w-4" /> View
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/receipts/$receiptNumber" params={{ receiptNumber: r.receipt_number }}>
                        <Download className="mr-1 h-4 w-4" /> PDF
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
