import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getCustomerRewardTimeline,
  getCustomerLite,
  recomputeCustomerRewardsForUser,
  type RewardTimelineEvent,
} from "@/lib/rewards.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  RefreshCcw,
  Sparkles,
  ArrowRight,
  Truck,
  Check,
  X,
  MessageSquare,
  Trophy,
  Loader2,
} from "lucide-react";
import { formatDateTime } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/admin/reward-timeline/$userId")({
  head: () => ({ meta: [{ title: "Reward Timeline — Admin" }] }),
  component: RewardTimelinePage,
});

const STATUS_TONE: Record<string, string> = {
  eligible: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  requested: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  dispatched: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  delivered: "bg-emerald-600/20 text-emerald-300 border-emerald-500/40",
  rejected: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  locked: "bg-muted text-muted-foreground border-border",
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={STATUS_TONE[status] ?? ""}>
      {status}
    </Badge>
  );
}

function EventIcon({ type }: { type: string }) {
  if (type === "unlocked") return <Sparkles className="h-4 w-4 text-amber-400" />;
  if (type === "recomputed") return <RefreshCcw className="h-4 w-4 text-sky-400" />;
  if (type === "admin_note") return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
  if (type === "tracking_updated") return <Truck className="h-4 w-4 text-indigo-400" />;
  if (type === "status_change") return <ArrowRight className="h-4 w-4 text-primary" />;
  if (type.startsWith("reward_")) return <Trophy className="h-4 w-4 text-amber-400" />;
  return <Check className="h-4 w-4 text-muted-foreground" />;
}

function eventTitle(e: RewardTimelineEvent): string {
  switch (e.event_type) {
    case "unlocked":
      return `Unlocked ${e.tier_name ?? "reward"}${e.reward_number ? ` (${e.reward_number})` : ""}`;
    case "status_change":
      return `Status changed${e.from_status ? ` from ${e.from_status}` : ""}${e.to_status ? ` to ${e.to_status}` : ""}`;
    case "recomputed": {
      const c = e.metadata.unlocked_count ?? 0;
      return `Eligibility recomputed${c ? ` — ${c} newly unlocked` : " — no change"}`;
    }
    case "admin_note":
      return "Admin note updated";
    case "tracking_updated":
      return `Tracking updated${e.metadata.tracking_reference ? `: ${e.metadata.tracking_reference}` : ""}`;
    default:
      return e.event_type.replace(/_/g, " ");
  }
}

function RewardTimelinePage() {
  const { userId } = Route.useParams();
  const qc = useQueryClient();
  const fetchTimeline = useServerFn(getCustomerRewardTimeline);
  const fetchCustomer = useServerFn(getCustomerLite);
  const recompute = useServerFn(recomputeCustomerRewardsForUser);

  const customerQ = useQuery({
    queryKey: ["admin", "customer-lite", userId],
    queryFn: () => fetchCustomer({ data: { userId } }),
  });
  const timelineQ = useQuery({
    queryKey: ["admin", "reward-timeline", userId],
    queryFn: () => fetchTimeline({ data: { userId, limit: 300 } }),
  });

  const recomputeM = useMutation({
    mutationFn: () => recompute({ data: { userId } }),
    onSuccess: (r) => {
      toast.success(`Recomputed ${r.processed} membership(s), ${r.unlocked} newly unlocked.`);
      qc.invalidateQueries({ queryKey: ["admin", "reward-timeline", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const events = timelineQ.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/admin/rewards">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Rewards
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Reward Timeline</h1>
          {customerQ.data ? (
            <p className="text-sm text-muted-foreground">
              {customerQ.data.full_name ?? customerQ.data.email ?? userId}
              {customerQ.data.membership_number ? ` · ${customerQ.data.membership_number}` : ""}
            </p>
          ) : customerQ.isLoading ? (
            <Skeleton className="h-4 w-64" />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => timelineQ.refetch()}
            disabled={timelineQ.isFetching}
          >
            <RefreshCcw className={`mr-1 h-4 w-4 ${timelineQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => recomputeM.mutate()}
            disabled={recomputeM.isPending}
          >
            {recomputeM.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            Recompute eligibility
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event history ({events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineQ.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : timelineQ.error ? (
            <p className="text-sm text-destructive">
              {(timelineQ.error as Error).message}
            </p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reward events yet. Trigger a recompute or wait for the next payment to be processed.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-6">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[29px] top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background">
                    <EventIcon type={e.event_type} />
                  </span>
                  <div className="rounded-md border border-border/70 bg-card/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{eventTitle(e)}</span>
                        {e.source === "audit_log" ? (
                          <Badge variant="outline" className="text-xs">audit</Badge>
                        ) : null}
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {formatDateTime(e.created_at)}
                      </time>
                    </div>

                    {(e.from_status || e.to_status) && e.event_type !== "recomputed" ? (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <StatusPill status={e.from_status} />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <StatusPill status={e.to_status} />
                      </div>
                    ) : null}

                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      {e.reward_number ? (
                        <div>
                          <span className="text-muted-foreground/70">Reward</span>{" "}
                          <span className="text-foreground">{e.reward_number}</span>
                          {e.tier_name ? ` · ${e.tier_name}` : ""}
                        </div>
                      ) : null}
                      {e.membership_number ? (
                        <div>
                          <span className="text-muted-foreground/70">Membership</span>{" "}
                          <span className="text-foreground">{e.membership_number}</span>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-muted-foreground/70">Actor</span>{" "}
                        <span className="text-foreground">
                          {e.actor_name ?? (e.actor_id ? "system" : "system")}
                        </span>
                      </div>
                      {e.metadata.tracking_reference ? (
                        <div>
                          <span className="text-muted-foreground/70">Tracking</span>{" "}
                          <span className="text-foreground">{e.metadata.tracking_reference}</span>
                        </div>
                      ) : null}
                    </div>

                    {e.note ? (
                      <div className="mt-2 rounded border border-border/60 bg-background/60 p-2 text-xs">
                        <span className="text-muted-foreground">Note: </span>
                        <span className="text-foreground">{e.note}</span>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
