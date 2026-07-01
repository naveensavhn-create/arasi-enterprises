import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gift, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/rewards")({
  head: () => ({ meta: [{ title: "Rewards — Admin" }] }),
  component: AdminRewardsPage,
});

function AdminRewardsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rewards Program</h1>
        <p className="text-sm text-muted-foreground">
          Configure milestone rewards granted to customers as they clear installments.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "3 months on-time", body: "Small welcome gift", icon: Gift },
          { title: "6 months on-time", body: "Premium gift + coupon", icon: Sparkles },
          { title: "Full plan complete", body: "Product delivery + bonus", icon: Gift },
        ].map((t) => (
          <Card key={t.title} className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <t.icon className="h-4 w-4 text-primary" /> {t.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{t.body}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Rewards trigger automatically as customers hit milestones. When you're ready to
            operationalize this, we'll add a <code>rewards</code> catalog and a{" "}
            <code>reward_grants</code> ledger table and post reward events from the payment webhook.
          </p>
          <p>
            Ask to enable the rewards module and we'll scaffold the schema, admin CRUD, and
            customer-facing view in one step.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
