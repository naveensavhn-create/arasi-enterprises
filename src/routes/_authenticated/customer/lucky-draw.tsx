import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ticket, Trophy, CalendarClock, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/customer/lucky-draw")({
  head: () => ({ meta: [{ title: "Lucky Draw — Arasi" }] }),
  component: CustomerLuckyDrawPage,
});

function CustomerLuckyDrawPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["my-draw-eligibility", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data, error } = await supabase
        .from("installments")
        .select("status, due_date, memberships!inner(user_id)")
        .eq("memberships.user_id", session!.user.id)
        .gte("due_date", monthStart)
        .lt("due_date", new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString());
      if (error) throw error;
      const monthly = data ?? [];
      const dueThisMonth = monthly.length;
      const paidThisMonth = monthly.filter((i) => i.status === "paid").length;
      return {
        eligible: dueThisMonth > 0 && paidThisMonth === dueThisMonth,
        dueThisMonth,
        paidThisMonth,
      };
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lucky Draw</h1>
        <p className="text-sm text-muted-foreground">
          Pay every installment on time this month to enter the monthly draw.
        </p>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-primary" /> This month's status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={data.eligible ? "default" : "secondary"}>
                {data.eligible ? "Eligible" : "Not yet eligible"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {data.paidThisMonth} / {data.dueThisMonth} paid this month
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Draws run at the end of each month. Winners are notified via email and SMS.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Next draw
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            End of {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Your wins
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            None yet — good luck!
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
