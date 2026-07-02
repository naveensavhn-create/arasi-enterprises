import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listMyCommissions } from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, Printer } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promoter/commissions")({
  head: () => ({ meta: [{ title: "Commissions — Promoter" }] }),
  component: Page,
});

function Page() {
  const list = useServerFn(listMyCommissions);
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "paid" | "rejected">("all");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["my-commissions", status],
    queryFn: () => list({ data: { status, limit: 500 } }),
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (!q.trim()) return rows;
    const n = q.toLowerCase();
    return rows.filter((r) =>
      [r.ledger_number, r.customer_name, r.membership_number, r.receipt_number]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(n)),
    );
  }, [data, q]);

  const totals = useMemo(() => {
    const sum = (s: string) =>
      filtered.filter((r) => r.status === s).reduce((a, r) => a + Number(r.commission_amount), 0);
    return { pending: sum("pending"), approved: sum("approved"), paid: sum("paid") };
  }, [filtered]);

  const exportCsv = () => {
    const rows = filtered.map((r) => [
      r.ledger_number, r.payment_date, r.customer_name ?? "",
      r.membership_number ?? "", r.installment_amount, r.commission_percent,
      r.commission_amount, r.status, r.paid_reference ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = ["Ledger#,Date,Customer,Membership,Collection,Rate%,Commission,Status,Ref", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `my-commissions-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Commissions</h1>
        <p className="text-sm text-muted-foreground">Commission is auto-calculated at your current rank % on every collection.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Pending" value={totals.pending} />
        <SummaryCard label="Approved" value={totals.approved} />
        <SummaryCard label="Paid" value={totals.paid} />
      </div>
      <Card>
        <CardHeader className="flex-row items-center gap-3 flex-wrap space-y-0">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto"><Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />CSV</Button></div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No commissions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ledger #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead className="text-right">Collection</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.ledger_number}</TableCell>
                      <TableCell className="text-xs">{new Date(r.payment_date).toLocaleDateString()}</TableCell>
                      <TableCell>{r.customer_name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.membership_number ?? "—"}</TableCell>
                      <TableCell className="text-right">₹{Number(r.installment_amount).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">{Number(r.commission_percent).toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-semibold">₹{Number(r.commission_amount).toLocaleString("en-IN")}</TableCell>
                      <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
      </CardContent>
    </Card>
  );
}
