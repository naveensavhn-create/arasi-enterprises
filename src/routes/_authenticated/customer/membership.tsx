import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, CalendarClock, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PayInstallmentButton } from "@/components/payments/PayInstallmentButton";

export const Route = createFileRoute("/_authenticated/customer/membership")({
  head: () => ({ meta: [{ title: "Membership Status — Arasi" }] }),
  component: CustomerMembershipPage,
});

type Installment = {
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
  membership_id: string;
};


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
  const userId = session?.user.id;
  const email = session?.user.email ?? undefined;
  const phone = session?.user.phone ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullName = (session?.user.user_metadata as any)?.full_name as string | undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["my-memberships", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("memberships")
        .select(
          "id, membership_number, status, start_date, end_date, advance_paid, total_amount, paid_amount, plan_id, membership_plans(name, description, monthly_installment, duration_months, benefits)"
        )
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const { data: installments } = useQuery({
    queryKey: ["my-installments-inline", userId],
    enabled: !!userId,
    refetchInterval: 8000,
    queryFn: async (): Promise<Installment[]> => {
      const { data, error } = await supabase
        .from("installments")
        .select("id, sequence, due_date, amount, status, paid_at, membership_id, memberships!inner(user_id)")
        .eq("memberships.user_id", userId!)
        .order("sequence", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Installment[];
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
          <p>You don't have a membership yet. Pick a plan and pay the advance to activate it.</p>
          <Button asChild style={{ background: "var(--gradient-gold-value)" }}>
            <Link to="/customer/enroll">Browse plans</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Membership Status</h1>
        <p className="text-sm text-muted-foreground">Your plan, current state, and full installment schedule.</p>

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
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{m.membership_number}</p>
                  </div>
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

                {/* Installment schedule */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" /> Installment schedule
                    </div>
                    <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                      <Link to="/customer/installments">Open full view</Link>
                    </Button>
                  </div>
                  {(() => {
                    const rows = (installments ?? []).filter((i) => i.membership_id === m.id);
                    if (rows.length === 0) {
                      return (
                        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                          {m.status === "pending"
                            ? "Schedule will appear once your advance payment is confirmed."
                            : "No installments generated yet."}
                        </p>
                      );
                    }
                    return (
                      <div className="overflow-hidden rounded-md border">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                            <tr>
                              <th className="px-2 py-2">#</th>
                              <th className="px-2 py-2">Due</th>
                              <th className="px-2 py-2">Amount</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.id} className="border-t">
                                <td className="px-2 py-2 font-mono">{r.sequence}</td>
                                <td className="px-2 py-2">{new Date(r.due_date).toLocaleDateString()}</td>
                                <td className="px-2 py-2 font-medium">
                                  ₹{Number(r.amount).toLocaleString("en-IN")}
                                </td>
                                <td className="px-2 py-2"><InstallmentStatus status={r.status} /></td>
                                <td className="px-2 py-2 text-right">
                                  {r.status !== "paid" ? (
                                    <PayInstallmentButton
                                      installmentId={r.id}
                                      amount={Number(r.amount)}
                                      customer={{ name: fullName, email, phone }}
                                    />
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">
                                      {r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "Paid"}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
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
