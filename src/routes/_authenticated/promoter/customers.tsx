import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/promoter/customers")({
  head: () => ({ meta: [{ title: "My Customers — Promoter" }] }),
  component: PromoterCustomersPage,
});

type Row = {
  id: string;
  membership_number: string;
  status: string;
  total_amount: number;
  paid_amount: number;
  start_date: string;
  user_id: string;
};

function PromoterCustomersPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["promoter-memberships", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("memberships")
        .select("id, membership_number, status, total_amount, paid_amount, start_date, user_id")
        .eq("promoter_id", session!.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Customers</h1>
        <p className="text-sm text-muted-foreground">
          Memberships you've onboarded or are assigned to.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> {data?.length ?? 0} memberships
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !data || data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You don't have any assigned customers yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Membership #</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Started</th>
                    <th className="py-2 pr-4 font-medium">Committed</th>
                    <th className="py-2 pr-4 font-medium">Collected</th>
                    <th className="py-2 pr-4 font-medium">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((m) => {
                    const pct = m.total_amount
                      ? Math.min(100, Math.round((Number(m.paid_amount) / Number(m.total_amount)) * 100))
                      : 0;
                    return (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{m.membership_number}</td>
                        <td className="py-2 pr-4">
                          <Badge className="capitalize">{m.status}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(m.start_date).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-4">₹{Number(m.total_amount).toLocaleString("en-IN")}</td>
                        <td className="py-2 pr-4">₹{Number(m.paid_amount).toLocaleString("en-IN")}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full"
                                style={{ width: `${pct}%`, background: "var(--gradient-gold-value)" }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{pct}%</span>
                          </div>
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
