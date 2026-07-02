import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listMyRewards, requestReward, type CustomerRewardRow } from "@/lib/rewards.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Gift, Sparkles, Trophy, Award, Loader2, FileText, Truck, Check, X, Send } from "lucide-react";
import { formatDateTime } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/customer/rewards")({
  head: () => ({ meta: [{ title: "Rewards — Arasi" }] }),
  component: CustomerRewardsPage,
});

const statusMeta: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  eligible:   { label: "Eligible to claim", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", icon: Sparkles },
  requested:  { label: "Requested",        className: "bg-blue-500/15 text-blue-500 border-blue-500/30",        icon: Send },
  approved:   { label: "Approved",         className: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",  icon: Check },
  dispatched: { label: "Dispatched",       className: "bg-amber-500/15 text-amber-500 border-amber-500/30",     icon: Truck },
  delivered:  { label: "Delivered",        className: "bg-primary/15 text-primary border-primary/30",           icon: Trophy },
  rejected:   { label: "Rejected",         className: "bg-destructive/15 text-destructive border-destructive/30", icon: X },
  locked:     { label: "Locked",           className: "bg-muted text-muted-foreground border-border",           icon: Gift },
};

function CustomerRewardsPage() {
  const listMine = useServerFn(listMyRewards);
  const req = useServerFn(requestReward);
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; row?: CustomerRewardRow; note: string }>({
    open: false,
    note: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["my-rewards"],
    queryFn: () => listMine(),
  });

  const mut = useMutation({
    mutationFn: (v: { id: string; note?: string }) => req({ data: v }),
    onSuccess: () => {
      toast.success("Reward claim submitted");
      qc.invalidateQueries({ queryKey: ["my-rewards"] });
      setDialog({ open: false, note: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data ?? [];
  const eligibleCount = rows.filter((r) => r.status === "eligible").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Award className="h-6 w-6 text-primary" /> My Rewards
          </h1>
          <p className="text-sm text-muted-foreground">
            Track milestones you've unlocked and claim your rewards.
          </p>
        </div>
        {eligibleCount > 0 && (
          <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
            {eligibleCount} ready to claim
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rewards…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Gift className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No rewards unlocked yet. Keep paying your monthly installments to earn milestone rewards!
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const meta = statusMeta[r.status] ?? statusMeta.locked;
            const Icon = meta.icon;
            return (
              <Card key={r.id} className="glass">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Gift className="h-4 w-4 text-primary" />
                      {r.tier?.name ?? "Reward"}
                    </CardTitle>
                    <Badge variant="outline" className={meta.className}>
                      <Icon className="h-3 w-3 mr-1" /> {meta.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{r.tier?.description ?? ""}</p>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>Reward # <span className="font-mono text-foreground">{r.reward_number}</span></div>
                    <div>Unlocked {formatDateTime(r.unlocked_at)}</div>
                    {r.requested_at && <div>Requested {formatDateTime(r.requested_at)}</div>}
                    {r.approved_at && <div>Approved {formatDateTime(r.approved_at)}</div>}
                    {r.dispatched_at && <div>Dispatched {formatDateTime(r.dispatched_at)}</div>}
                    {r.delivered_at && <div>Delivered {formatDateTime(r.delivered_at)}</div>}
                    {r.tracking_reference && <div>Tracking: <span className="font-mono">{r.tracking_reference}</span></div>}
                    {r.admin_note && <div className="italic">Note: {r.admin_note}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.status === "eligible" && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => setDialog({ open: true, row: r, note: "" })}
                      >
                        Claim reward
                      </Button>
                    )}
                    <Link to="/reward-certificate/$rewardId" params={{ rewardId: r.id }}>
                      <Button size="sm" variant="outline">
                        <FileText className="h-4 w-4 mr-1" /> Certificate
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim reward</DialogTitle>
            <DialogDescription>
              {dialog.row?.tier?.name} — {dialog.row?.reward_number}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Optional note or preferred delivery address"
            value={dialog.note}
            onChange={(e) => setDialog((s) => ({ ...s, note: e.target.value }))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, note: "" })}>
              Cancel
            </Button>
            <Button
              variant="success"
              disabled={mut.isPending}
              onClick={() => dialog.row && mut.mutate({ id: dialog.row.id, note: dialog.note })}
            >
              {mut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Submit claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
