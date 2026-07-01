import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Search, Download } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_authenticated/admin/payments")({
  head: () => ({ meta: [{ title: "Payments — Admin" }] }),
  component: AdminPaymentsPage,
});

type Row = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  provider: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  error_code: string | null;
  error_description: string | null;
  paid_at: string | null;
  created_at: string;
  customer_id: string;
  membership_id: string;
  installment_id: string | null;
  memberships: { membership_number: string | null } | null;
  installments: { sequence: number; due_date: string } | null;
  profile?: { full_name: string | null; email: string | null } | null;
};

const STATUSES = ["all", "paid", "created", "attempted", "failed", "refunded"];

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(rows: Row[]) {
  const headers = [
    "Created", "Paid At", "Order ID", "Payment ID", "Status", "Method",
    "Amount", "Currency", "Customer", "Email", "Membership #",
    "Installment #", "Due Date", "Error",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.created_at, r.paid_at ?? "", r.provider_order_id ?? "",
      r.provider_payment_id ?? "", r.status, r.method ?? "",
      r.amount, r.currency,
      r.memberships?.profiles?.full_name ?? "",
      r.memberships?.profiles?.email ?? "",
      r.memberships?.membership_number ?? "",
      r.installments?.sequence ?? (r.installment_id ? "" : "advance"),
      r.installments?.due_date ?? "",
      r.error_code ? `${r.error_code}: ${r.error_description ?? ""}` : "",
    ].map(csvEscape).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AdminPaymentsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-payments"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          `id, amount, currency, status, method, provider,
           provider_order_id, provider_payment_id, error_code, error_description,
           paid_at, created_at, customer_id, membership_id, installment_id,
           memberships:membership_id ( membership_number ),
           installments:installment_id ( sequence, due_date )`
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];
      const ids = Array.from(new Set(rows.map((r) => r.customer_id))).filter(Boolean);
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", ids);
        const map = new Map((profs ?? []).map((p) => [p.id, p]));
        for (const r of rows) {
          const p = map.get(r.customer_id);
          r.profile = p ? { full_name: p.full_name, email: p.email } : null;
        }
      }
      return rows;
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const fromT = from ? new Date(from).getTime() : null;
    const toT = to ? new Date(to).getTime() + 86_400_000 : null;
    const s = q.trim().toLowerCase();
    return data.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      const t = new Date(r.created_at).getTime();
      if (fromT && t < fromT) return false;
      if (toT && t >= toT) return false;
      if (!s) return true;
      return (
        r.provider_order_id?.toLowerCase().includes(s) ||
        r.provider_payment_id?.toLowerCase().includes(s) ||
        r.memberships?.membership_number?.toLowerCase().includes(s) ||
        r.memberships?.profiles?.email?.toLowerCase().includes(s) ||
        r.memberships?.profiles?.full_name?.toLowerCase().includes(s)
      );
    });
  }, [data, q, status, from, to]);

  const totals = useMemo(() => {
    const paid = filtered.filter((r) => r.status === "paid");
    return {
      count: paid.length,
      sum: paid.reduce((a, r) => a + Number(r.amount), 0),
      total: filtered.length,
    };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments Ledger</h1>
          <p className="text-sm text-muted-foreground">
            All Razorpay transactions across the platform.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!filtered.length}
          onClick={() => downloadCSV(filtered)}
        >
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected (filtered)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-gradient-gold">
            ₹{totals.sum.toLocaleString("en-IN")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Successful</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{totals.count}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total shown</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{totals.total}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Transactions
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-md border px-2.5 py-1 text-xs capitalize ${
                    status === s ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" />
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Order/payment id, customer, email, member #"
                className="h-8 w-72 pl-7 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions match filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Customer</th>
                    <th className="py-2 pr-4 font-medium">Membership</th>
                    <th className="py-2 pr-4 font-medium">Inst.</th>
                    <th className="py-2 pr-4 font-medium">Order / Payment</th>
                    <th className="py-2 pr-4 font-medium">Method</th>
                    <th className="py-2 pr-4 font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const p = r.memberships?.profiles;
                    return (
                      <tr key={r.id} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                          {new Date(r.paid_at ?? r.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email ?? ""}</div>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {r.memberships?.membership_number ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {r.installments
                            ? `#${r.installments.sequence}`
                            : <span className="text-muted-foreground">advance</span>}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[11px]">
                          <div>{r.provider_order_id ?? "—"}</div>
                          <div className="text-muted-foreground">{r.provider_payment_id ?? ""}</div>
                        </td>
                        <td className="py-2 pr-4 capitalize">{r.method ?? "—"}</td>
                        <td className="py-2 pr-4 font-medium whitespace-nowrap">
                          {r.currency} {Number(r.amount).toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={
                              r.status === "paid"
                                ? "default"
                                : r.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="capitalize"
                          >
                            {r.status}
                          </Badge>
                          {r.error_code && (
                            <div className="mt-1 text-[10px] text-destructive">
                              {r.error_code}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
