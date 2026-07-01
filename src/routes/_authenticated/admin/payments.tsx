import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, CreditCard, Search } from "lucide-react";
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
  provider_order_id: string | null;
  provider_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  customer_id: string;
};

function AdminPaymentsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-payments"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, amount, currency, status, method, provider_order_id, provider_payment_id, paid_at, created_at, customer_id"
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        r.provider_order_id?.toLowerCase().includes(s) ||
        r.provider_payment_id?.toLowerCase().includes(s)
      );
    });
  }, [data, q, status]);

  const totals = useMemo(() => {
    const paid = (data ?? []).filter((r) => r.status === "paid");
    const sum = paid.reduce((a, r) => a + Number(r.amount), 0);
    return { count: paid.length, sum };
  }, [data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-sm text-muted-foreground">
          All Razorpay transactions across the platform.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total collected</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-gradient-gold">
            ₹{totals.sum.toLocaleString("en-IN")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Successful</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{totals.count}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total transactions</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{data?.length ?? 0}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Transactions
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {["all", "paid", "created", "attempted", "failed"].map((s) => (
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
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Order / payment id"
                className="h-8 w-56 pl-7 text-xs"
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
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Order ID</th>
                    <th className="py-2 pr-4 font-medium">Payment ID</th>
                    <th className="py-2 pr-4 font-medium">Method</th>
                    <th className="py-2 pr-4 font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(r.paid_at ?? r.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.provider_order_id ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.provider_payment_id ?? "—"}</td>
                      <td className="py-2 pr-4 capitalize">{r.method ?? "—"}</td>
                      <td className="py-2 pr-4 font-medium">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
