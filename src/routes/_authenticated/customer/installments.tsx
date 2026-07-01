import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { PayInstallmentButton } from "@/components/payments/PayInstallmentButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/customer/installments")({
  head: () => ({ meta: [{ title: "Installments — Arasi Enterprises" }] }),
  component: InstallmentsPage,
});

type Row = {
  id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  paid_at: string | null;
  membership_id: string;
  memberships: { membership_number: string } | { membership_number: string }[];
};

function InstallmentsPage() {
  const { session } = useSession();
  const email = session?.user.email ?? undefined;
  const phone = session?.user.phone ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullName = (session?.user.user_metadata as any)?.full_name as string | undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-installments", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("installments")
        .select(
          "id, sequence, due_date, amount, status, paid_at, membership_id, memberships!inner(membership_number, user_id)"
        )
        .eq("memberships.user_id", session!.user.id)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading installments…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">Failed to load installments.</p>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No installments yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Once your membership is active, your monthly installment schedule will appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Installments</h1>
        <p className="text-sm text-muted-foreground">
          Pay your monthly installments securely via Razorpay.
        </p>
      </div>

      <div className="grid gap-3">
        {rows.map((r) => {
          const membership = Array.isArray(r.memberships) ? r.memberships[0] : r.memberships;
          const isPaid = r.status === "paid";
          const isOverdue = r.status === "overdue";
          return (
            <Card key={r.id} className="glass">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {membership?.membership_number} · Installment #{r.sequence}
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    ₹{Number(r.amount).toLocaleString("en-IN")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Due {new Date(r.due_date).toLocaleDateString()}
                    {r.paid_at ? ` · Paid ${new Date(r.paid_at).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={isPaid ? "default" : isOverdue ? "destructive" : "secondary"}
                    className="capitalize"
                  >
                    {r.status}
                  </Badge>
                  {!isPaid && (
                    <PayInstallmentButton
                      installmentId={r.id}
                      amount={Number(r.amount)}
                      sequence={r.sequence}
                      customerName={fullName}
                      customerEmail={email}
                      customerPhone={phone}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
