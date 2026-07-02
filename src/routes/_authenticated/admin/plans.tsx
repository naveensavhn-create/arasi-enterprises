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
import { Loader2, Package, Plus, Pencil, Trash2, History, Sparkles, Calendar, Wallet, TrendingUp, CheckCircle2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PlanAuditDrawer } from "@/components/admin/PlanAuditDrawer";
import { deletePlanAudited } from "@/lib/plans.functions";
import { BLOCKING_STATUSES, computePlanUsage, usageFor } from "@/lib/plans-precheck";
import { cn } from "@/lib/utils";
import { z } from "zod";

const planFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Plan name is required")
      .max(100, "Plan name must be 100 characters or fewer"),
    description: z
      .string()
      .trim()
      .max(500, "Description must be 500 characters or fewer")
      .optional()
      .or(z.literal("")),
    has_advance: z.boolean(),
    advance_amount: z.string(),
    monthly_installment: z
      .string()
      .refine((v) => v.trim() !== "" && !Number.isNaN(Number(v)), "Enter a valid amount")
      .refine((v) => Number(v) >= 0, "Monthly installment cannot be negative"),
    duration_months: z
      .string()
      .refine((v) => v.trim() !== "" && Number.isInteger(Number(v)), "Enter a whole number of months")
      .refine((v) => Number(v) >= 1, "Duration must be at least 1 month")
      .refine((v) => Number(v) <= 120, "Duration cannot exceed 120 months"),
    benefits: z.string().max(2000, "Benefits text is too long").optional().or(z.literal("")),
    is_active: z.boolean(),
    display_order: z
      .string()
      .refine((v) => v.trim() !== "" && Number.isInteger(Number(v)), "Display order must be a whole number")
      .refine((v) => Number(v) >= 0, "Display order cannot be negative"),
  })
  .superRefine((data, ctx) => {
    if (data.has_advance) {
      const n = Number(data.advance_amount);
      if (data.advance_amount.trim() === "" || Number.isNaN(n)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["advance_amount"],
          message: "Enter a valid advance amount",
        });
      } else if (n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["advance_amount"],
          message: "Advance must be greater than 0 (or turn off the advance requirement)",
        });
      }
    }
    const advance = data.has_advance ? Number(data.advance_amount || 0) : 0;
    const monthly = Number(data.monthly_installment || 0);
    const months = Number(data.duration_months || 0);
    if (advance + monthly * months <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monthly_installment"],
        message: "Plan total must be greater than 0",
      });
    }
  });

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
  has_advance: boolean;
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
  has_advance: true,
  advance_amount: "",
  monthly_installment: "",
  duration_months: "12",
  benefits: "",
  is_active: true,
  display_order: "0",
};

const inr = (n: number) =>
  `₹${Number.isFinite(n) ? Math.round(n).toLocaleString("en-IN") : "0"}`;

function AdminPlansPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmDelete, setConfirmDelete] = useState<Plan | null>(null);
  const [historyPlan, setHistoryPlan] = useState<Plan | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const validation = useMemo(() => planFormSchema.safeParse(form), [form]);
  const errors = useMemo(() => {
    const map: Partial<Record<keyof FormState, string>> = {};
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const key = issue.path[0] as keyof FormState | undefined;
        if (key && !map[key]) map[key] = issue.message;
      }
    }
    return map;
  }, [validation]);
  const showErr = (k: keyof FormState) => (showErrors ? errors[k] : undefined);

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
        .in("status", [...BLOCKING_STATUSES]);
      if (error) throw error;
      return computePlanUsage((data ?? []) as { plan_id: string | null; status: string | null }[]);
    },
  });
  const usageForPlan = (id: string) => usageFor(usage, id);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = planFormSchema.safeParse(form);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Please fix the highlighted fields");
      }
      const d = parsed.data;
      const advance = d.has_advance ? Number(d.advance_amount || 0) : 0;
      const payload = {
        name: d.name.trim(),
        description: (d.description ?? "").trim() || null,
        advance_amount: advance,
        monthly_installment: Number(d.monthly_installment),
        duration_months: Number(d.duration_months),
        benefits: (d.benefits ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        is_active: d.is_active,
        display_order: Number(d.display_order),
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
      setShowErrors(false);
      toast.success(editing ? "Plan updated" : "Plan created");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const handleSave = () => {
    if (save.isPending) return;
    if (!validation.success) {
      setShowErrors(true);
      toast.error(validation.error.issues[0]?.message ?? "Please fix the highlighted fields");
      return;
    }
    save.mutate();
  };

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
      has_advance: Number(p.advance_amount) > 0,
      advance_amount: String(p.advance_amount),
      monthly_installment: String(p.monthly_installment),
      duration_months: String(p.duration_months),
      benefits: (p.benefits ?? []).join("\n"),
      is_active: p.is_active,
      display_order: String(p.display_order),
    });
    setOpen(true);
  }

  const formTotals = useMemo(() => {
    const advance = form.has_advance ? Number(form.advance_amount || 0) : 0;
    const monthly = Number(form.monthly_installment || 0);
    const months = Number(form.duration_months || 0);
    return { advance, monthly, months, total: advance + monthly * months };
  }, [form.has_advance, form.advance_amount, form.monthly_installment, form.duration_months]);

  const activeCount = data?.filter((p) => p.is_active).length ?? 0;
  const totalEnrolled = usage ? Object.values(usage).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Catalog
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Membership Plans</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Configure your advance-and-installment offerings. Toggle the advance requirement
              off for pure monthly plans, or set both to build custom subscriptions.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Total plans</div>
              <div className="text-2xl font-semibold">{data?.length ?? 0}</div>
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-xs text-muted-foreground">Active</div>
              <div className="text-2xl font-semibold text-primary">{activeCount}</div>
            </div>
            <div className="hidden text-right md:block">
              <div className="text-xs text-muted-foreground">Enrollments</div>
              <div className="text-2xl font-semibold">{totalEnrolled}</div>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="lg" onClick={startCreate} className="shadow-md">
                  <Plus className="mr-2 h-4 w-4" /> New plan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-xl">
                    {editing ? "Edit plan" : "Create a new plan"}
                  </DialogTitle>
                </DialogHeader>

                <div className="grid gap-5 py-2">
                  <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                    <div className="grid gap-1.5">
                      <Label>Plan name</Label>
                      <Input
                        placeholder="e.g. Gold"
                        value={form.name}
                        aria-invalid={!!showErr("name")}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                      {showErr("name") && (
                        <p className="text-xs text-destructive">{showErr("name")}</p>
                      )}
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Display order</Label>
                      <Input
                        type="number"
                        value={form.display_order}
                        aria-invalid={!!showErr("display_order")}
                        onChange={(e) => setForm({ ...form, display_order: e.target.value })}
                      />
                      {showErr("display_order") && (
                        <p className="text-xs text-destructive">{showErr("display_order")}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label>Description</Label>
                    <Textarea
                      rows={2}
                      placeholder="Short pitch shown to customers"
                      value={form.description}
                      aria-invalid={!!showErr("description")}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                    {showErr("description") && (
                      <p className="text-xs text-destructive">{showErr("description")}</p>
                    )}
                  </div>

                  {/* Advance toggle */}
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-primary/10 p-2 text-primary">
                          <Wallet className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium">Requires an advance payment</div>
                          <div className="text-xs text-muted-foreground">
                            Turn off for pure monthly plans with no upfront amount.
                          </div>
                        </div>
                      </div>
                      <Switch
                        checked={form.has_advance}
                        onCheckedChange={(v) =>
                          setForm({ ...form, has_advance: v, advance_amount: v ? form.advance_amount : "0" })
                        }
                      />
                    </div>

                    {form.has_advance && (
                      <div className="mt-3 grid gap-1.5">
                        <Label className="text-xs">Advance amount (₹)</Label>
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={form.advance_amount}
                          aria-invalid={!!showErr("advance_amount")}
                          onChange={(e) => setForm({ ...form, advance_amount: e.target.value })}
                        />
                        {showErr("advance_amount") && (
                          <p className="text-xs text-destructive">{showErr("advance_amount")}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5" /> Monthly installment (₹)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={form.monthly_installment}
                        aria-invalid={!!showErr("monthly_installment")}
                        onChange={(e) => setForm({ ...form, monthly_installment: e.target.value })}
                      />
                      {showErr("monthly_installment") && (
                        <p className="text-xs text-destructive">{showErr("monthly_installment")}</p>
                      )}
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" /> Duration (months)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={form.duration_months}
                        aria-invalid={!!showErr("duration_months")}
                        onChange={(e) => setForm({ ...form, duration_months: e.target.value })}
                      />
                      {showErr("duration_months") && (
                        <p className="text-xs text-destructive">{showErr("duration_months")}</p>
                      )}
                    </div>
                  </div>

                  {/* Live totals preview */}
                  <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Preview
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Advance</div>
                        <div className="font-semibold">{inr(formTotals.advance)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          {inr(formTotals.monthly)} × {formTotals.months}
                        </div>
                        <div className="font-semibold">{inr(formTotals.monthly * formTotals.months)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Total value</div>
                        <div className="text-lg font-bold text-primary">{inr(formTotals.total)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label>Benefits <span className="text-xs text-muted-foreground">(one per line)</span></Label>
                    <Textarea
                      rows={4}
                      placeholder={"Priority support\nExclusive draws\nEarly access"}
                      value={form.benefits}
                      onChange={(e) => setForm({ ...form, benefits: e.target.value })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.is_active}
                        onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                      />
                      <div>
                        <div className="text-sm font-medium">Active</div>
                        <div className="text-xs text-muted-foreground">
                          Visible to customers for new enrollments
                        </div>
                      </div>
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
        </div>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading plans…
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <div className="font-medium">No plans yet</div>
              <p className="text-sm text-muted-foreground">
                Create your first membership plan to start accepting enrollments.
              </p>
            </div>
            <Button onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" /> New plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const enrolled = usageForPlan(p.id);
            const noAdvance = Number(p.advance_amount) <= 0;
            return (
              <div
                key={p.id}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
                  !p.is_active && "opacity-70",
                )}
              >
                {/* Accent bar */}
                <div
                  className={cn(
                    "h-1.5 w-full",
                    p.is_active
                      ? "bg-gradient-to-r from-primary via-primary/70 to-primary/40"
                      : "bg-muted",
                  )}
                />

                <div className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold">{p.name}</h3>
                        <Badge variant={p.is_active ? "default" : "secondary"} className="shrink-0">
                          {p.is_active ? "Active" : "Inactive"}
                        </Badge>
                        {noAdvance && (
                          <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
                            No advance
                          </Badge>
                        )}
                      </div>
                      {p.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
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
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Price block */}
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold tracking-tight text-gradient-gold">
                        {inr(Number(p.total_value))}
                      </span>
                      <span className="text-xs text-muted-foreground">total value</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                        <div>
                          <div className="text-muted-foreground">Advance</div>
                          <div className="font-medium text-foreground">
                            {noAdvance ? "—" : inr(Number(p.advance_amount))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        <div>
                          <div className="text-muted-foreground">Monthly × {p.duration_months}</div>
                          <div className="font-medium text-foreground">
                            {inr(Number(p.monthly_installment))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {p.benefits && p.benefits.length > 0 && (
                    <ul className="space-y-1.5 text-sm">
                      {p.benefits.slice(0, 4).map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span className="text-muted-foreground">{b}</span>
                        </li>
                      ))}
                      {p.benefits.length > 4 && (
                        <li className="pl-6 text-xs text-muted-foreground">
                          +{p.benefits.length - 4} more
                        </li>
                      )}
                    </ul>
                  )}

                  <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {enrolled} enrolled
                    </span>
                    <span>Order #{p.display_order}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          {(() => {
            const inUse = confirmDelete ? usageForPlan(confirmDelete.id) : 0;
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
