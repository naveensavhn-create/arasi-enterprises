import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listRanks,
  upsertRank,
  deleteRank,
  getCommissionSettings,
  updateCommissionSettings,
  type Rank,
} from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { RankBadge } from "@/components/ranks/RankBadge";

export const Route = createFileRoute("/_authenticated/admin/ranks")({
  head: () => ({ meta: [{ title: "Promoter Ranks — Admin" }] }),
  component: RanksPage,
});

const EMPTY: Rank = {
  id: "",
  code: "",
  name: "",
  tier_order: 1,
  min_active_customers: 0,
  commission_percent: 0,
  monthly_incentive: 0,
  gift_name: null,
  is_active: true,
};

function RanksPage() {
  const qc = useQueryClient();
  const list = useServerFn(listRanks);
  const upsert = useServerFn(upsertRank);
  const del = useServerFn(deleteRank);
  const getSettings = useServerFn(getCommissionSettings);
  const updSettings = useServerFn(updateCommissionSettings);

  const { data: ranks, isLoading } = useQuery({ queryKey: ["ranks"], queryFn: () => list() });
  const { data: settings } = useQuery({ queryKey: ["commission_settings"], queryFn: () => getSettings() });

  const [editing, setEditing] = useState<Rank | null>(null);
  const [open, setOpen] = useState(false);

  const saveMut = useMutation({
    mutationFn: (r: Rank) =>
      upsert({
        data: {
          id: r.id || undefined,
          code: r.code,
          name: r.name,
          tier_order: r.tier_order,
          min_active_customers: r.min_active_customers,
          commission_percent: r.commission_percent,
          monthly_incentive: r.monthly_incentive,
          gift_name: r.gift_name,
          is_active: r.is_active,
        },
      }),
    onSuccess: () => {
      toast.success("Rank saved");
      qc.invalidateQueries({ queryKey: ["ranks"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Rank deleted");
      qc.invalidateQueries({ queryKey: ["ranks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const settingsMut = useMutation({
    mutationFn: (v: { commission_auto_approve: boolean; incentive_mode: "automatic" | "manual" }) =>
      updSettings({ data: v }),
    onSuccess: () => {
      toast.success("Settings updated");
      qc.invalidateQueries({ queryKey: ["commission_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Promoter Ranks</h1>
          <p className="text-muted-foreground text-sm">Configure tiers, commission %, incentives and gifts.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="success" onClick={() => setEditing({ ...EMPTY })}>
              <Plus className="h-4 w-4 mr-1" /> New Rank
            </Button>
          </DialogTrigger>
          <RankDialog editing={editing} setEditing={setEditing} save={(r) => saveMut.mutate(r)} saving={saveMut.isPending} />
        </Dialog>
      </div>

      {settings && (
        <Card>
          <CardHeader><CardTitle>Commission Settings</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={settings.commission_auto_approve}
                onCheckedChange={(v) => settingsMut.mutate({ ...settings, commission_auto_approve: v })}
              />
              <Label>Auto-approve commissions on payment</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label>Incentive Mode</Label>
              <Select
                value={settings.incentive_mode}
                onValueChange={(v) => settingsMut.mutate({ ...settings, incentive_mode: v as "automatic" | "manual" })}
              >
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual approval</SelectItem>
                  <SelectItem value="automatic">Automatic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(ranks ?? []).map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex-row items-start justify-between space-y-0 gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <RankBadge rank={r} size="md" showLabel={false} />
                <div className="min-w-0">
                  <CardTitle className="truncate">{r.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">Tier {r.tier_order} · {r.code}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{r.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Promoters currently in this rank will be recomputed on next membership change.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => delMut.mutate(r.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Min active customers: <b>{r.min_active_customers}</b></div>
              <div>Commission: <b>{Number(r.commission_percent).toFixed(2)}%</b></div>
              <div>One-time incentive: <b>₹{Number(r.monthly_incentive).toLocaleString("en-IN")}</b></div>
              <div>Gift: <b>{r.gift_name ?? "—"}</b></div>
              <div>Status: <b>{r.is_active ? "Active" : "Inactive"}</b></div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RankDialog({
  editing,
  setEditing,
  save,
  saving,
}: {
  editing: Rank | null;
  setEditing: (r: Rank | null) => void;
  save: (r: Rank) => void;
  saving: boolean;
}) {
  if (!editing) return null;
  const set = (patch: Partial<Rank>) => setEditing({ ...editing, ...patch });
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{editing.id ? "Edit rank" : "New rank"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Code</Label><Input value={editing.code} onChange={(e) => set({ code: e.target.value })} /></div>
          <div><Label>Name</Label><Input value={editing.name} onChange={(e) => set({ name: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Tier order</Label><Input type="number" value={editing.tier_order} onChange={(e) => set({ tier_order: Number(e.target.value) })} /></div>
          <div><Label>Min active customers</Label><Input type="number" value={editing.min_active_customers} onChange={(e) => set({ min_active_customers: Number(e.target.value) })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Commission %</Label><Input type="number" step="0.01" value={editing.commission_percent} onChange={(e) => set({ commission_percent: Number(e.target.value) })} /></div>
          <div><Label>One-time incentive (₹)</Label><Input type="number" value={editing.monthly_incentive} onChange={(e) => set({ monthly_incentive: Number(e.target.value) })} /></div>
        </div>
        <div><Label>Gift name</Label><Input value={editing.gift_name ?? ""} onChange={(e) => set({ gift_name: e.target.value || null })} /></div>
        <div className="flex items-center gap-2">
          <Switch checked={editing.is_active} onCheckedChange={(v) => set({ is_active: v })} />
          <Label>Active</Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="success" disabled={saving} onClick={() => save(editing)}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
