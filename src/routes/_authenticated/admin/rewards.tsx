import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  listRewardTiers,
  upsertRewardTier,
  deleteRewardTier,
  listRewardsAdmin,
  adminUpdateRewardStatus,
  recomputeAllRewards,
  type RewardTier,
  type CustomerRewardRow,
  type RewardTriggerType,
} from "@/lib/rewards.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Gift,
  Loader2,
  Plus,
  RefreshCcw,
  Trash2,
  Pencil,
  Check,
  Truck,
  X,
  Trophy,
  Send,
  Sparkles,
} from "lucide-react";
import { formatDateTime } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/admin/rewards")({
  head: () => ({ meta: [{ title: "Rewards — Admin" }] }),
  component: AdminRewardsPage,
});

const TRIGGERS: { value: RewardTriggerType; label: string; helper: string }[] = [
  { value: "advance_paid", label: "Advance paid", helper: "Unlocked when the customer pays advance." },
  { value: "installments_paid", label: "Installments paid", helper: "Unlocked at N paid installments." },
  { value: "on_time_streak", label: "On-time streak", helper: "Requires N installments paid on/before due date." },
  { value: "membership_completed", label: "Membership completed", helper: "Unlocks when the plan is fully paid." },
];

const emptyTier: Partial<RewardTier> = {
  name: "",
  description: "",
  trigger_type: "installments_paid",
  threshold: 3,
  reward_value: 0,
  certificate_title: "",
  certificate_body: "",
  is_active: true,
  sort_order: 0,
};

const statusMeta: Record<string, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
  eligible:   { className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", icon: Sparkles },
  requested:  { className: "bg-blue-500/15 text-blue-500 border-blue-500/30",        icon: Send },
  approved:   { className: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",  icon: Check },
  dispatched: { className: "bg-amber-500/15 text-amber-500 border-amber-500/30",     icon: Truck },
  delivered:  { className: "bg-primary/15 text-primary border-primary/30",           icon: Trophy },
  rejected:   { className: "bg-destructive/15 text-destructive border-destructive/30", icon: X },
  locked:     { className: "bg-muted text-muted-foreground border-border",           icon: Gift },
};

function AdminRewardsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rewards Program</h1>
        <p className="text-sm text-muted-foreground">
          Configure reward tiers, review customer claims, and dispatch rewards.
        </p>
      </div>
      <Tabs defaultValue="claims">
        <TabsList>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="tiers">Reward tiers</TabsTrigger>
        </TabsList>
        <TabsContent value="claims" className="mt-4">
          <ClaimsPanel />
        </TabsContent>
        <TabsContent value="tiers" className="mt-4">
          <TiersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --------------- Claims ---------------
function ClaimsPanel() {
  const list = useServerFn(listRewardsAdmin);
  const update = useServerFn(adminUpdateRewardStatus);
  const recompute = useServerFn(recomputeAllRewards);
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [editing, setEditing] = useState<{ row?: CustomerRewardRow; open: boolean; note: string; tracking: string; next?: string }>({
    open: false,
    note: "",
    tracking: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-rewards", status],
    queryFn: () => list({ data: { status: status as never, limit: 200 } }),
  });

  const mut = useMutation({
    mutationFn: (v: { id: string; status: string; admin_note?: string; tracking_reference?: string }) =>
      update({ data: v as never }),
    onSuccess: () => {
      toast.success("Reward updated");
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
      setEditing({ open: false, note: "", tracking: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recompMut = useMutation({
    mutationFn: () => recompute(),
    onSuccess: (r: { processed: number; unlocked: number }) => {
      toast.success(`Recomputed ${r.processed} memberships, ${r.unlocked} new unlocks`);
      qc.invalidateQueries({ queryKey: ["admin-rewards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data ?? [];

  const nextTransitions = (row: CustomerRewardRow) => {
    switch (row.status) {
      case "requested":
        return ["approved", "rejected"];
      case "approved":
        return ["dispatched", "rejected"];
      case "dispatched":
        return ["delivered"];
      case "eligible":
        return ["rejected"];
      case "rejected":
        return ["eligible"];
      default:
        return [];
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Reward claims</CardTitle>
          <Badge variant="outline">{rows.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="eligible">Eligible</SelectItem>
              <SelectItem value="requested">Requested</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="dispatched">Dispatched</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => recompMut.mutate()} disabled={recompMut.isPending}>
            {recompMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
            Recompute
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No reward claims match the filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reward #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = statusMeta[r.status] ?? statusMeta.locked;
                  const Icon = meta.icon;
                  const next = nextTransitions(r);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.reward_number}</TableCell>
                      <TableCell>
                        <div className="text-sm">{r.customer_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.customer_email ?? ""}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{r.membership_number ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.tier?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={meta.className}>
                          <Icon className="h-3 w-3 mr-1" /> {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.requested_at ? formatDateTime(r.requested_at) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end flex-wrap items-center">
                          <Button asChild size="sm" variant="ghost" title="Open timeline">
                            <Link to="/admin/reward-timeline/$userId" params={{ userId: r.user_id }}>
                              Timeline
                            </Link>
                          </Button>
                          {next.length === 0 ? null : (
                            next.map((s) => (
                              <Button
                                key={s}
                                size="sm"
                                variant={s === "rejected" ? "destructive" : "outline"}
                                onClick={() =>
                                  setEditing({
                                    open: true,
                                    row: r,
                                    next: s,
                                    note: r.admin_note ?? "",
                                    tracking: r.tracking_reference ?? "",
                                  })
                                }
                              >
                                {s}
                              </Button>
                            ))
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={editing.open} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move reward → {editing.next}</DialogTitle>
            <DialogDescription>
              {editing.row?.reward_number} · {editing.row?.customer_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Admin note (visible to customer)</Label>
              <Textarea
                value={editing.note}
                onChange={(e) => setEditing((s) => ({ ...s, note: e.target.value }))}
              />
            </div>
            {(editing.next === "dispatched" || editing.next === "delivered") && (
              <div>
                <Label>Tracking reference</Label>
                <Input
                  value={editing.tracking}
                  onChange={(e) => setEditing((s) => ({ ...s, tracking: e.target.value }))}
                  placeholder="e.g. courier AWB #"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing({ open: false, note: "", tracking: "" })}>
              Cancel
            </Button>
            <Button
              variant="success"
              disabled={mut.isPending}
              onClick={() =>
                editing.row &&
                editing.next &&
                mut.mutate({
                  id: editing.row.id,
                  status: editing.next,
                  admin_note: editing.note,
                  tracking_reference: editing.tracking,
                })
              }
            >
              {mut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --------------- Tiers ---------------
const tierFormSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  trigger_type: z.enum(["installments_paid", "membership_completed", "on_time_streak", "advance_paid"]),
  threshold: z.number().int().min(0),
  reward_value: z.number().min(0),
  certificate_title: z.string().nullable().optional(),
  certificate_body: z.string().nullable().optional(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0),
});

function TiersPanel() {
  const list = useServerFn(listRewardTiers);
  const upsert = useServerFn(upsertRewardTier);
  const del = useServerFn(deleteRewardTier);
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<RewardTier> | null>(null);
  const [confirmDel, setConfirmDel] = useState<RewardTier | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reward-tiers"],
    queryFn: () => list(),
  });

  const mut = useMutation({
    mutationFn: (v: Partial<RewardTier>) => {
      const parsed = tierFormSchema.parse({
        ...v,
        description: v.description ?? "",
        reward_value: Number(v.reward_value ?? 0),
        threshold: Number(v.threshold ?? 0),
        sort_order: Number(v.sort_order ?? 0),
        is_active: v.is_active ?? true,
      });
      return upsert({ data: parsed });
    },
    onSuccess: () => {
      toast.success("Reward tier saved");
      qc.invalidateQueries({ queryKey: ["reward-tiers"] });
      setForm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Reward tier deleted");
      qc.invalidateQueries({ queryKey: ["reward-tiers"] });
      setConfirmDel(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tiers = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Reward tiers</CardTitle>
        <Button size="sm" variant="success" onClick={() => setForm(emptyTier)}>
          <Plus className="h-4 w-4 mr-1" /> New tier
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.description ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-xs">{t.trigger_type}</TableCell>
                    <TableCell>{t.threshold}</TableCell>
                    <TableCell>₹{Number(t.reward_value).toFixed(2)}</TableCell>
                    <TableCell>
                      {t.is_active ? (
                        <Badge variant="outline" className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline">Off</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => setForm(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDel(t)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit reward tier" : "New reward tier"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={form.description ?? ""}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Trigger</Label>
                  <Select
                    value={form.trigger_type ?? "installments_paid"}
                    onValueChange={(v) => setForm({ ...form, trigger_type: v as RewardTriggerType })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGERS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {TRIGGERS.find((t) => t.value === form.trigger_type)?.helper}
                  </p>
                </div>
                <div>
                  <Label>Threshold</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.threshold ?? 0}
                    onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Reward value (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.reward_value ?? 0}
                    onChange={(e) => setForm({ ...form, reward_value: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Sort order</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.sort_order ?? 0}
                    onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <Label>Certificate title</Label>
                <Input
                  value={form.certificate_title ?? ""}
                  onChange={(e) => setForm({ ...form, certificate_title: e.target.value })}
                />
              </div>
              <div>
                <Label>Certificate body</Label>
                <Textarea
                  value={form.certificate_body ?? ""}
                  onChange={(e) => setForm({ ...form, certificate_body: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label>Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button
              variant="success"
              disabled={mut.isPending}
              onClick={() => form && mut.mutate(form)}
            >
              {mut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete reward tier?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{confirmDel?.name}&rdquo; will be removed. Existing customer rewards linked to it will block deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDel && delMut.mutate(confirmDel.id);
              }}
              disabled={delMut.isPending}
            >
              {delMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
