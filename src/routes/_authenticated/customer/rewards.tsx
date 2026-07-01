import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift, Sparkles, Trophy, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/customer/rewards")({
  head: () => ({ meta: [{ title: "Rewards — Arasi" }] }),
  component: CustomerRewardsPage,
});

const MILESTONES = [
  { paid: 3, title: "3 installments cleared", body: "Welcome reward", icon: Gift },
  { paid: 6, title: "Half-way milestone", body: "Bonus coupon", icon: Sparkles },
  { paid: 12, title: "Plan complete", body: "Product delivery + bonus", icon: Trophy },
];

function CustomerRewardsPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["my-installments-count", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installments")
        .select("status, memberships!inner(user_id)")
        .eq("memberships.user_id", session!.user.id);
      if (error) throw error;
      const paid = (data ?? []).filter((i) => i.status === "paid").length;
      return { paid };
    },
  });

  const paid = data?.paid ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rewards</h1>
        <p className="text-sm text-muted-foreground">
          Earn milestone rewards as you keep clearing your installments.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {MILESTONES.map((m) => {
            const reached = paid >= m.paid;
            return (
              <Card key={m.title} className="glass">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <m.icon className={`h-4 w-4 ${reached ? "text-primary" : "text-muted-foreground"}`} />
                      {m.title}
                    </span>
                    <Badge variant={reached ? "default" : "secondary"}>
                      {reached ? "Unlocked" : `${paid}/${m.paid}`}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{m.body}</CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
