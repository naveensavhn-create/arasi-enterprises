import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listCommissionsAdmin,
  updateCommissionStatus,
  type CommissionRow,
} from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/commissions")({
  head: () => ({ meta: [{ title: "Commissions Ledger — Admin" }] }),
  component: Page,
});

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  paid: "bg-green-500/15 text-green-700 dark:text-green-400",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
};

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listCommissionsAdmin);
  const update = useServerFn(updateCommissionStatus);
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "paid" | "rejected">("all");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-commissions", status],
    queryFn: () => list({ data: { status, limit: 200 } }),
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      [r.ledger_number, r.membership_number, r.customer_name, r.promoter_name, r.receipt_number]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [data, q]);

  const total = filtered.reduce((a, r) => a + Number(r.commission_amount), 0);

  const updMut = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "paid" | "rejected"; reference?: string }) =>
      update({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-commissions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    const header = [
      "Ledger#", "Date", "Promoter", "Customer", "Membership", "Receipt",
      "Amount", "Rate%", "Commission", "Status", "Ref",
    ].join(",");
    const lines = filtered.map((r) =>
      [
        r.ledger_number,
        r.payment_date,
        r.promoter_name ?? "",
        r.customer_name ?? "",
        r.membership_number ?? "",
        r.receipt_number ?? "",
        r.installment_amount,
        r.commission_percent,
        r.commission_amount,
        r.status,
        r.paid_reference ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Commission Ledger</h1>
        <p className="text-sm text-muted-foreground">Approve, mark paid, or reject commission entries.</p>
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 gap-3 flex-wrap">
          <div className="flex gap-2 items-center flex-wrap">
            <Input placeholder="Search ledger#, customer, promoter…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm">Total: <b>₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b> ({filtered.length})</div>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No commission entries.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ledger #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Promoter</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead className="text-right">Collection</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <Row key={r.id} row={r} onUpdate={(v) => updMut.mutate(v)} pending={updMut.isPending} />
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

function Row({
  row,
  onUpdate,
  pending,
}: {
  row: CommissionRow;
  onUpdate: (v: { id: string; status: "approved" | "paid" | "rejected"; reference?: string }) => void;
  pending: boolean;
}) {
  const [ref, setRef] = useState("");
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.ledger_number}</TableCell>
      <TableCell className="text-xs">{new Date(row.payment_date).toLocaleDateString()}</TableCell>
      <TableCell>{row.promoter_name ?? "—"}</TableCell>
      <TableCell>{row.customer_name ?? "—"}</TableCell>
      <TableCell className="font-mono text-xs">{row.membership_number ?? "—"}</TableCell>
      <TableCell className="text-right">₹{Number(row.installment_amount).toLocaleString("en-IN")}</TableCell>
      <TableCell className="text-right">{Number(row.commission_percent).toFixed(2)}%</TableCell>
      <TableCell className="text-right font-semibold">₹{Number(row.commission_amount).toLocaleString("en-IN")}</TableCell>
      <TableCell><Badge className={STATUS_COLORS[row.status]}>{row.status}</Badge></TableCell>
      <TableCell>
        <div className="flex gap-1 items-center">
          {row.status === "pending" && (
            <>
              <Button size="sm" variant="success" disabled={pending} onClick={() => onUpdate({ id: row.id, status: "approved" })}>Approve</Button>
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => onUpdate({ id: row.id, status: "rejected" })}>Reject</Button>
            </>
          )}
          {row.status === "approved" && (
            <>
              <Input placeholder="Ref#" value={ref} onChange={(e) => setRef(e.target.value)} className="h-8 w-24 text-xs" />
              <Button size="sm" variant="success" disabled={pending} onClick={() => onUpdate({ id: row.id, status: "paid", reference: ref || undefined })}>Mark Paid</Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
