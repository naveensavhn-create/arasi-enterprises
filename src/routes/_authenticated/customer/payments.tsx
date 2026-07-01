import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customer/payments")({
  component: CustomerPaymentsPage,
});

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const statusStyle: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  captured: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  authorized: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  created: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  failed: "bg-red-500/10 text-red-500 border-red-500/30",
  refunded: "bg-purple-500/10 text-purple-500 border-purple-500/30",
};

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

function CustomerPaymentsPage() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const paymentsQ = useQuery({
    queryKey: ["customer-payments"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) return [];
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, membership_id, installment_id, provider, provider_order_id, provider_payment_id, amount, currency, status, method, error_code, error_description, paid_at, created_at",
        )
        .eq("customer_id", uid)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const rows = paymentsQ.data ?? [];

  const membershipIds = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.membership_id).filter(Boolean))),
    [rows],
  );
  const installmentIds = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.installment_id).filter(Boolean))),
    [rows],
  );

  const membershipsQ = useQuery({
    enabled: membershipIds.length > 0,
    queryKey: ["cust-payments-memberships", membershipIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memberships")
        .select("id, membership_number")
        .in("id", membershipIds as string[]);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const installmentsQ = useQuery({
    enabled: installmentIds.length > 0,
    queryKey: ["cust-payments-installments", installmentIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installments")
        .select("id, sequence, due_date")
        .in("id", installmentIds as string[]);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const mMap = new Map((membershipsQ.data ?? []).map((m: any) => [m.id, m]));
  const iMap = new Map((installmentsQ.data ?? []).map((i: any) => [i.id, i]));

  const filtered = useMemo(() => {
    return rows.filter((r: any) => {
      if (status !== "all" && r.status !== status) return false;
      if (search) {
        const s = search.toLowerCase();
        const m = mMap.get(r.membership_id);
        return (
          r.provider_order_id?.toLowerCase().includes(s) ||
          r.provider_payment_id?.toLowerCase().includes(s) ||
          m?.membership_number?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [rows, status, search, mMap]);

  const totals = useMemo(() => {
    const paid = filtered.filter((r: any) => r.status === "paid" || r.status === "captured");
    const failed = filtered.filter((r: any) => r.status === "failed");
    return {
      count: filtered.length,
      paidCount: paid.length,
      paidAmount: paid.reduce((s, r: any) => s + Number(r.amount || 0), 0),
      failedCount: failed.length,
    };
  }, [filtered]);

  const exportCsv = () => {
    const header = [
      "Created", "Paid at", "Membership", "Installment", "Amount", "Currency",
      "Status", "Method", "Order ID", "Payment ID", "Error",
    ];
    const lines = filtered.map((r: any) => {
      const m = mMap.get(r.membership_id);
      const inst = iMap.get(r.installment_id);
      return [
        fmtDate(r.created_at), fmtDate(r.paid_at),
        m?.membership_number ?? "",
        inst ? `#${inst.sequence}` : (r.installment_id ? "" : "Advance"),
        r.amount, r.currency, r.status, r.method ?? "",
        r.provider_order_id ?? "", r.provider_payment_id ?? "",
        r.error_description ?? r.error_code ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment History</h1>
        <p className="text-sm text-muted-foreground">
          Every Razorpay charge on your account, including successful and failed attempts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total payments" value={String(totals.count)} />
        <StatCard label="Successful" value={`${totals.paidCount} · ${inr(totals.paidAmount)}`} />
        <StatCard label="Failed" value={String(totals.failedCount)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Transactions</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Order / Payment / Membership #"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="captured">Captured</SelectItem>
                <SelectItem value="authorized">Authorized</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Razorpay IDs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentsQ.isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No payments yet</TableCell></TableRow>
              ) : filtered.map((r: any) => {
                const m = mMap.get(r.membership_id);
                const inst = iMap.get(r.installment_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="text-sm">{fmtDate(r.paid_at ?? r.created_at)}</div>
                      {r.paid_at && r.created_at !== r.paid_at && (
                        <div className="text-[11px] text-muted-foreground">created {fmtDate(r.created_at)}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m?.membership_number ?? "—"}</TableCell>
                    <TableCell>
                      {inst ? (
                        <div>
                          <div>Installment #{inst.sequence}</div>
                          <div className="text-[11px] text-muted-foreground">due {inst.due_date}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Advance</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{inr(Number(r.amount))}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusStyle[r.status] ?? ""}>{r.status}</Badge>
                      {r.status === "failed" && (r.error_description || r.error_code) && (
                        <div className="mt-1 text-[11px] text-red-500 max-w-[220px] truncate" title={r.error_description ?? r.error_code}>
                          {r.error_description ?? r.error_code}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.method ?? "—"}</TableCell>
                    <TableCell>
                      <div className="space-y-1 text-[11px] font-mono">
                        {r.provider_payment_id && (
                          <button
                            className="flex items-center gap-1 hover:text-foreground"
                            onClick={() => copy(r.provider_payment_id, "Payment ID")}
                            title={r.provider_payment_id}
                          >
                            <span className="text-muted-foreground">pay:</span>
                            <span className="truncate max-w-[140px]">{r.provider_payment_id}</span>
                            <Copy className="h-3 w-3 opacity-60" />
                          </button>
                        )}
                        {r.provider_order_id && (
                          <button
                            className="flex items-center gap-1 hover:text-foreground"
                            onClick={() => copy(r.provider_order_id, "Order ID")}
                            title={r.provider_order_id}
                          >
                            <span className="text-muted-foreground">ord:</span>
                            <span className="truncate max-w-[140px]">{r.provider_order_id}</span>
                            <Copy className="h-3 w-3 opacity-60" />
                          </button>
                        )}
                        {!r.provider_payment_id && !r.provider_order_id && "—"}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
