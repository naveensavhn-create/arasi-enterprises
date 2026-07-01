import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/customer/membership")({
  head: () => ({ meta: [{ title: "My Membership — Arasi" }] }),
  component: CustomerMembershipPage,
});

type Row = {
  id: string;
  membership_number: string;
  status: string;
  start_date: string;
  end_date: string | null;
  advance_paid: number;
  total_amount: number;
  paid_amount: number;
  plan_id: string;
  membership_plans: { name: string; description: string | null; monthly_installment: number; duration_months: number; benefits: string[] | null } | null;
};

function CustomerMembershipPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["my-memberships", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("memberships")
        .select(
          "id, membership_number, status, start_date, end_date, advance_paid, total_amount, paid_amount, plan_id, membership_plans(name, description, monthly_installment, duration_months, benefits)"
        )
        .eq("user_id", session!.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading membership…
      </div>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>No active membership</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>You don't have a membership yet. Contact your promoter or admin to enroll in a plan.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Membership</h1>
        <p className="text-sm text-muted-foreground">Your enrolled plan and progress.</p>
      </div>

      <div className="grid gap-4">
        {rows.map((m) => {
          const pct = m.total_amount
            ? Math.min(100, Math.round((Number(m.paid_amount) / Number(m.total_amount)) * 100))
            : 0;
          const plan = m.membership_plans;
          return (
            <Card key={m.id} className="glass">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <CardTitle className="text-lg">{plan?.name ?? "Membership"}</CardTitle>
                      <Badge className="capitalize">{m.status}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{m.membership_number}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/customer/installments">View installments</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {plan?.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}

                <div className="grid gap-2 sm:grid-cols-4">
                  <Stat label="Advance" value={`₹${Number(m.advance_paid).toLocaleString("en-IN")}`} />
                  <Stat
                    label={`Monthly × ${plan?.duration_months ?? "—"}`}
                    value={`₹${Number(plan?.monthly_installment ?? 0).toLocaleString("en-IN")}`}
                  />
                  <Stat label="Total value" value={`₹${Number(m.total_amount).toLocaleString("en-IN")}`} />
                  <Stat label="Paid so far" value={`₹${Number(m.paid_amount).toLocaleString("en-IN")}`} />
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span><span>{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full"
                      style={{ width: `${pct}%`, background: "var(--gradient-gold-value)" }}
                    />
                  </div>
                </div>

                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>Start: {new Date(m.start_date).toLocaleDateString()}</div>
                  <div>End: {m.end_date ? new Date(m.end_date).toLocaleDateString() : "—"}</div>
                </div>

                {plan?.benefits && plan.benefits.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Benefits
                    </div>
                    <ul className="space-y-1 text-sm">
                      {plan.benefits.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
