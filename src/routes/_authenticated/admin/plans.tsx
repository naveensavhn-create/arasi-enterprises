import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, Package, Plus, Pencil, Trash2, History } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PlanAuditDrawer } from "@/components/admin/PlanAuditDrawer";
import { deletePlanAudited } from "@/lib/plans.functions";

export const Route = createFileRoute("/_authenticated/admin/plans")({
  head: () => ({ meta: [{ title: "Plans — Admin" }] }),
  component: AdminPlansPage,
});

type Plan = {
  id: string;
  name: string;
  description: string | null;
  advance_amount: number;
  monthly_installment: number;
  duration_months: number;
  total_value: number;
  benefits: string[] | null;
  is_active: boolean;
  display_order: number;
};

type FormState = {
  name: string;
  description: string;
  advance_amount: string;
  monthly_installment: string;
  duration_months: string;
  benefits: string;
  is_active: boolean;
  display_order: string;
};

const empty: FormState = {
  name: "",
  description: "",
  advance_amount: "",
  monthly_installment: "",
  duration_months: "12",
  benefits: "",
  is_active: true,
  display_order: "0",
};

function AdminPlansPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmDelete, setConfirmDelete] = useState<Plan | null>(null);
  const [historyPlan, setHistoryPlan] = useState<Plan | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("membership_plans")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  const { data: usage } = useQuery({
    queryKey: ["admin-plans-usage"],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("memberships")
        .select("plan_id, status")
        .in("status", ["pending", "active"]);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { plan_id: string | null }[]) {
        if (row.plan_id) counts[row.plan_id] = (counts[row.plan_id] ?? 0) + 1;
      }
      return counts;
    },
  });
  const usageFor = (id: string) => usage?.[id] ?? 0;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        advance_amount: Number(form.advance_amount),
        monthly_installment: Number(form.monthly_installment),
        duration_months: Number(form.duration_months),
        benefits: form.benefits
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        is_active: form.is_active,
        display_order: Number(form.display_order) || 0,
      };
      if (editing) {
        const { error } = await supabase.from("membership_plans").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("membership_plans").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      setOpen(false);
      setEditing(null);
      setForm(empty);
      toast.success(editing ? "Plan updated" : "Plan created");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Plan) => {
      const { error } = await supabase
        .from("membership_plans")
        .update({ is_active: !p.is_active })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-plans"] }),
  });

  // Explicit, idempotent "deactivate" — used from the delete dialog so a
  // single click reliably disables future enrollments without touching
  // existing memberships.
  const deactivate = useMutation({
    mutationFn: async (p: Plan) => {
      if (!p.is_active) return { alreadyInactive: true as const };
      const { error } = await supabase
        .from("membership_plans")
        .update({ is_active: false })
        .eq("id", p.id);
      if (error) throw error;
      return { alreadyInactive: false as const };
    },
    onSuccess: (res, p) => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      qc.invalidateQueries({ queryKey: ["admin-plans-usage"] });
      toast.success(
        res?.alreadyInactive ? `${p.name} is already inactive` : `${p.name} deactivated`,
        {
          description: res?.alreadyInactive
            ? undefined
            : "Existing memberships are unchanged; new enrollments are now blocked.",
        },
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not deactivate plan"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // Server fn records the attempt (blocked or successful) in admin_audit_log
      // with actor details + per-status enrollment counts, then returns a
      // structured result rather than throwing on trigger blocks.
      const res = await deletePlanAudited({ data: { planId: id } });
      if (!res.success) {
        const err = new Error(
          `Cannot delete this plan: ${res.counts.blocking} active enrollment${res.counts.blocking === 1 ? "" : "s"} (pending or active) still reference it. Deactivate the plan instead.`,
        ) as Error & { blockedCount?: number | null };
        err.blockedCount = res.counts.blocking;
        throw err;
      }
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      qc.invalidateQueries({ queryKey: ["admin-plans-usage"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
      toast.success("Plan deleted", { description: "Attempt recorded in the audit log." });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ["admin-plans-usage"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
      const message = e instanceof Error ? e.message : "Delete failed";
      const blockedCount = (e as { blockedCount?: number | null } | null)?.blockedCount;
      if (typeof blockedCount === "number") {
        toast.error(message, {
          description:
            "Attempt recorded in the audit log. Use ‘Deactivate plan’ to stop new enrollments while preserving history.",
        });
      } else {
        toast.error(message);
      }
    },
  });

  function startCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function startEdit(p: Plan) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      advance_amount: String(p.advance_amount),
      monthly_installment: String(p.monthly_installment),
      duration_months: String(p.duration_months),
      benefits: (p.benefits ?? []).join("\n"),
      is_active: p.is_active,
      display_order: String(p.display_order),
    });
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Membership Plans</h1>
          <p className="text-sm text-muted-foreground">
            Advance amount + monthly installments × duration.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" /> New Plan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Plan" : "New Plan"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>Advance (₹)</Label>
                  <Input
                    type="number"
                    value={form.advance_amount}
                    onChange={(e) => setForm({ ...form, advance_amount: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Monthly (₹)</Label>
                  <Input
                    type="number"
                    value={form.monthly_installment}
                    onChange={(e) => setForm({ ...form, monthly_installment: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Months</Label>
                  <Input
                    type="number"
                    value={form.duration_months}
                    onChange={(e) => setForm({ ...form, duration_months: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Benefits (one per line)</Label>
                <Textarea
                  rows={4}
                  value={form.benefits}
                  onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  />
                  <Label>Active</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Display order</Label>
                  <Input
                    type="number"
                    className="w-20"
                    value={form.display_order}
                    onChange={(e) => setForm({ ...form, display_order: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create plan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" /> {data?.length ?? 0} plan{data?.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !data || data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No plans yet. Click "New Plan" to add one.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.map((p) => (
                <div key={p.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{p.name}</h3>
                        <Badge variant={p.is_active ? "default" : "secondary"}>
                          {p.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      {p.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(p)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setHistoryPlan(p)}
                        title="Audit history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleActive.mutate(p)}
                        title={p.is_active ? "Deactivate" : "Activate"}
                      >
                        <Switch checked={p.is_active} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmDelete(p)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Advance</div>
                      <div className="font-medium">₹{Number(p.advance_amount).toLocaleString("en-IN")}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Monthly × {p.duration_months}</div>
                      <div className="font-medium">₹{Number(p.monthly_installment).toLocaleString("en-IN")}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total</div>
                      <div className="font-medium text-gradient-gold">
                        ₹{Number(p.total_value).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>
                  {p.benefits && p.benefits.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {p.benefits.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          {(() => {
            const inUse = confirmDelete ? usageFor(confirmDelete.id) : 0;
            const blocked = inUse > 0;
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {blocked ? "Cannot delete this plan" : "Delete plan?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {blocked ? (
                      <>
                        <span className="font-semibold">{confirmDelete?.name}</span> has{" "}
                        <span className="font-semibold">{inUse}</span> active enrollment
                        {inUse === 1 ? "" : "s"} (pending or active memberships). Deleting it
                        would orphan those records. Deactivate the plan instead to stop new
                        enrollments while preserving history.
                      </>
                    ) : (
                      <>
                        This will permanently delete{" "}
                        <span className="font-semibold">{confirmDelete?.name}</span>. No active
                        enrollments reference this plan. This action cannot be undone.
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-2">
                  <AlertDialogCancel disabled={remove.isPending || deactivate.isPending}>
                    {blocked ? "Close" : "Cancel"}
                  </AlertDialogCancel>

                  {confirmDelete?.is_active && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!confirmDelete) return;
                        deactivate.mutate(confirmDelete, {
                          onSuccess: () => setConfirmDelete(null),
                        });
                      }}
                      disabled={deactivate.isPending || remove.isPending}
                    >
                      {deactivate.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Deactivate plan"
                      )}
                    </Button>
                  )}

                  {!blocked && (
                    <AlertDialogAction
                      disabled={remove.isPending || deactivate.isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        if (!confirmDelete) return;
                        remove.mutate(confirmDelete.id, {
                          onSuccess: () => setConfirmDelete(null),
                        });
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {remove.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Delete plan"
                      )}
                    </AlertDialogAction>
                  )}
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <PlanAuditDrawer
        planId={historyPlan?.id ?? null}
        planName={historyPlan?.name}
        open={!!historyPlan}
        onOpenChange={(o) => !o && setHistoryPlan(null)}
      />
    </div>
  );
}
