import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/promoter/collections")({
  head: () => ({ meta: [{ title: "Collections — Promoter" }] }),
  component: PromoterCollectionsPage,
});

type Row = {
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
  memberships: { membership_number: string; user_id: string } | { membership_number: string; user_id: string }[];
};

function PromoterCollectionsPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["promoter-collections", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("installments")
        .select("id, sequence, due_date, amount, status, paid_at, memberships!inner(membership_number, user_id, promoter_id)")
        .eq("memberships.promoter_id", session!.user.id)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = data ?? [];
  const pending = rows.filter((r) => r.status !== "paid");
  const collected = rows
    .filter((r) => r.status === "paid")
    .reduce((a, r) => a + Number(r.amount), 0);
  const outstanding = pending.reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
        <p className="text-sm text-muted-foreground">
          Installments across your assigned memberships.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold text-gradient-gold">
            ₹{collected.toLocaleString("en-IN")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Outstanding</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">₹{outstanding.toLocaleString("en-IN")}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending EMIs</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{pending.length}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No installments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Membership</th>
                    <th className="py-2 pr-4 font-medium">EMI #</th>
                    <th className="py-2 pr-4 font-medium">Due</th>
                    <th className="py-2 pr-4 font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = Array.isArray(r.memberships) ? r.memberships[0] : r.memberships;
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{m?.membership_number}</td>
                        <td className="py-2 pr-4">#{r.sequence}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(r.due_date).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-4">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={
                              r.status === "paid"
                                ? "default"
                                : r.status === "overdue"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="capitalize"
                          >
                            {r.status}
                          </Badge>
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
