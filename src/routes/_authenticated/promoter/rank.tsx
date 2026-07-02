import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyPromoterDashboard, listMyRankHistory, listMyGifts, listMyIncentives } from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Award, Gift, TrendingUp, Users } from "lucide-react";
import { RankBadge, RankBanner } from "@/components/ranks/RankBadge";

export const Route = createFileRoute("/_authenticated/promoter/rank")({
  head: () => ({ meta: [{ title: "My Rank — Promoter" }] }),
  component: Page,
});

function inr(n: number) { return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 }); }

function Page() {
  const dash = useServerFn(getMyPromoterDashboard);
  const hist = useServerFn(listMyRankHistory);
  const gifts = useServerFn(listMyGifts);
  const inc = useServerFn(listMyIncentives);

  const { data, isLoading } = useQuery({ queryKey: ["promoter-dashboard"], queryFn: () => dash() });
  const { data: history } = useQuery({ queryKey: ["promoter-rank-history"], queryFn: () => hist() });
  const { data: myGifts } = useQuery({ queryKey: ["promoter-gifts"], queryFn: () => gifts() });
  const { data: myInc } = useQuery({ queryKey: ["promoter-incentives"], queryFn: () => inc() });

  if (isLoading || !data) return <div className="p-6 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Rank & Progress</h1>
        <p className="text-sm text-muted-foreground">Rank, commission %, incentives and gifts unlock automatically as you grow.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={<Award className="h-5 w-5" />} label="Current Rank" value={data.currentRank?.name ?? "Unranked"} sub={`Commission ${data.commissionPercent}%`} />
        <Stat icon={<Users className="h-5 w-5" />} label="Active Customers" value={String(data.activeCustomers)} sub={`Pending: ${data.pendingCustomers}`} />
        <Stat icon={<TrendingUp className="h-5 w-5" />} label="Month Earnings" value={inr(data.monthEarnings)} sub={`Today ${inr(data.todayEarnings)}`} />
        <Stat icon={<TrendingUp className="h-5 w-5" />} label="Lifetime Paid" value={inr(data.lifetimeEarnings)} sub={`Pending payout ${inr(data.pendingPayoutAmount)}`} />
      </div>

      <Card>
        <CardHeader><CardTitle>Rank Progress</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span>{data.currentRank?.name ?? "Unranked"}</span>
            <span className="text-muted-foreground">
              {data.nextRank ? `Next: ${data.nextRank.name} @ ${data.nextRank.min_active_customers} customers` : "Highest rank achieved"}
            </span>
          </div>
          <Progress value={data.progressPercent} />
          <div className="text-xs text-muted-foreground">
            {data.activeCustomers} active · {data.remainingToNext > 0 ? `${data.remainingToNext} more to next rank` : "target reached"}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Gift className="h-4 w-4" /> My Gifts</CardTitle></CardHeader>
          <CardContent>
            {(myGifts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No gifts unlocked yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(myGifts as Array<{ id: string; gift_name: string; status: string; tracking_number: string | null; courier_name: string | null }>).map((g) => (
                  <li key={g.id} className="flex justify-between items-center border-b pb-1 last:border-0">
                    <span>{g.gift_name}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{g.status}</Badge>
                      {g.tracking_number && <span className="text-xs text-muted-foreground">{g.courier_name} · {g.tracking_number}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Monthly Incentives</CardTitle></CardHeader>
          <CardContent>
            {(myInc ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No incentives yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(myInc as Array<{ id: string; period_year: number; period_month: number; amount: number; status: string }>).map((i) => (
                  <li key={i.id} className="flex justify-between items-center border-b pb-1 last:border-0">
                    <span>{i.period_year}-{String(i.period_month).padStart(2, "0")}</span>
                    <span className="flex items-center gap-2">
                      <span>{inr(Number(i.amount))}</span>
                      <Badge variant="outline">{i.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Promotion History</CardTitle></CardHeader>
        <CardContent>
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No promotions yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(history as Array<{ id: string; created_at: string; reason: string; active_customer_count: number }>).map((h) => (
                <li key={h.id} className="flex justify-between border-b pb-1 last:border-0">
                  <span>{new Date(h.created_at).toLocaleString()}</span>
                  <span className="text-muted-foreground">{h.reason} · {h.active_customer_count} customers</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
