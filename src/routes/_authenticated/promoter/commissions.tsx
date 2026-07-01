import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Receipt } from "lucide-react";

export const Route = createFileRoute("/_authenticated/promoter/commissions")({
  head: () => ({ meta: [{ title: "Commissions — Promoter" }] }),
  component: PromoterCommissionsPage,
});

const COMMISSION_RATE = 0.05; // 5% — configurable later via admin

type Row = {
  id: string;
  amount: number;
  paid_at: string | null;
  created_at: string;
  membership_id: string;
  memberships: { membership_number: string; promoter_id: string } | { membership_number: string; promoter_id: string }[];
};

function PromoterCommissionsPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["promoter-commissions", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, paid_at, created_at, membership_id, memberships!inner(membership_number, promoter_id)")
        .eq("status", "paid")
        .eq("memberships.promoter_id", session!.user.id)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = data ?? [];
  const totalCollected = rows.reduce((a, r) => a + Number(r.amount), 0);
  const totalCommission = totalCollected * COMMISSION_RATE;

  const thisMonth = rows.filter((r) => {
    const t = new Date(r.paid_at ?? r.created_at);
    const now = new Date();
    return t.getMonth() === now.getMonth() && t.getFullYear() === now.getFullYear();
  });
  const monthCommission = thisMonth.reduce((a, r) => a + Number(r.amount), 0) * COMMISSION_RATE;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Commissions</h1>
        <p className="text-sm text-muted-foreground">
          Earnings at {(COMMISSION_RATE * 100).toFixed(1)}% on successful collections from your customers.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total earned</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-gradient-gold">
            ₹{totalCommission.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">This month</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            ₹{monthCommission.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Payments counted</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{rows.length}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="h-4 w-4" /> Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No commissions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Membership</th>
                    <th className="py-2 pr-4 font-medium">Collection</th>
                    <th className="py-2 pr-4 font-medium">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = Array.isArray(r.memberships) ? r.memberships[0] : r.memberships;
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(r.paid_at ?? r.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{m?.membership_number}</td>
                        <td className="py-2 pr-4">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                        <td className="py-2 pr-4 font-medium text-gradient-gold">
                          ₹{(Number(r.amount) * COMMISSION_RATE).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
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
