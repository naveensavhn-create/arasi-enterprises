import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, Wallet, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  head: () => ({ meta: [{ title: "Reports — Admin" }] }),
  component: AdminReportsPage,
});

function AdminReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const [customers, promoters, plans, memberships, installments, payments] = await Promise.all([
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "customer"),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "promoter"),
        supabase.from("membership_plans").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("memberships").select("id, status, total_amount, paid_amount"),
        supabase.from("installments").select("status, amount"),
        supabase.from("payments").select("amount, status, created_at").filter("status::text", "eq", "paid"),
      ]);

      const mems = memberships.data ?? [];
      const insts = installments.data ?? [];
      const pays = payments.data ?? [];

      const totalCommitted = mems.reduce((a, m) => a + Number(m.total_amount ?? 0), 0);
      const totalCollected = pays.reduce((a, p) => a + Number(p.amount ?? 0), 0);
      const overdueCount = insts.filter((i) => i.status === "overdue").length;
      const overdueAmount = insts
        .filter((i) => i.status === "overdue")
        .reduce((a, i) => a + Number(i.amount), 0);

      // Monthly collection (last 6 months)
      const now = new Date();
      const months: { label: string; total: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const total = pays
          .filter((p) => {
            const t = new Date(p.created_at);
            return t >= d && t < next;
          })
          .reduce((a, p) => a + Number(p.amount), 0);
        months.push({ label: d.toLocaleDateString(undefined, { month: "short" }), total });
      }
      const maxMonth = Math.max(...months.map((m) => m.total), 1);

      return {
        customers: customers.count ?? 0,
        promoters: promoters.count ?? 0,
        activePlans: plans.count ?? 0,
        totalMemberships: mems.length,
        activeMemberships: mems.filter((m) => m.status === "active").length,
        totalCommitted,
        totalCollected,
        overdueCount,
        overdueAmount,
        months,
        maxMonth,
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading reports…
      </div>
    );
  }

  const cards = [
    { label: "Customers", value: data.customers, icon: Users },
    { label: "Promoters", value: data.promoters, icon: Users },
    { label: "Active plans", value: data.activePlans, icon: BarChart3 },
    { label: "Active memberships", value: data.activeMemberships, icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Snapshot of platform activity.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                {c.label}
              </CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{c.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total committed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              ₹{data.totalCommitted.toLocaleString("en-IN")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Sum of all membership contract values
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total collected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-gradient-gold">
              ₹{data.totalCollected.toLocaleString("en-IN")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Successful Razorpay payments
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Overdue installments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive">
              {data.overdueCount}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              ₹{data.overdueAmount.toLocaleString("en-IN")} outstanding
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> Collections — last 6 months
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 pt-4">
            {data.months.map((m) => (
              <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${(m.total / data.maxMonth) * 160 + 4}px`,
                    background: "var(--gradient-gold-value)",
                  }}
                  title={`₹${m.total.toLocaleString("en-IN")}`}
                />
                <div className="text-[10px] text-muted-foreground">{m.label}</div>
                <div className="text-[10px] font-medium">
                  ₹{m.total.toLocaleString("en-IN")}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
