import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listMembershipsAdmin,
  listCustomerOptions,
  listPromoterOptions,
  listActivePlanOptions,
  createMembershipAdmin,
  updateMembershipAdmin,
  activateMembershipAdmin,
  cancelMembershipAdmin,
} from "@/lib/memberships.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportMembershipsDialog } from "@/components/admin/ImportMembershipsDialog";

export const Route = createFileRoute("/_authenticated/admin/memberships")({
  component: MembershipsAdminPage,
});

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

const STATUSES = ["pending", "active", "completed", "cancelled", "defaulted"] as const;

const statusVariant: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  completed: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  defaulted: "bg-red-500/10 text-red-500 border-red-500/30",
};

function MembershipsAdminPage() {
  const qc = useQueryClient();
  const list = useServerFn(listMembershipsAdmin);
  const customers = useServerFn(listCustomerOptions);
  const promoters = useServerFn(listPromoterOptions);
  const plans = useServerFn(listActivePlanOptions);
  const createFn = useServerFn(createMembershipAdmin);
  const updateFn = useServerFn(updateMembershipAdmin);
  const activateFn = useServerFn(activateMembershipAdmin);
  const cancelFn = useServerFn(cancelMembershipAdmin);

  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [openImport, setOpenImport] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const membershipsQ = useQuery({
    queryKey: ["admin-memberships", status, search],
    queryFn: () => list({ data: { status, search } }),
  });
  const customersQ = useQuery({ queryKey: ["opt-customers"], queryFn: () => customers() });
  const promotersQ = useQuery({ queryKey: ["opt-promoters"], queryFn: () => promoters() });
  const plansQ = useQuery({ queryKey: ["opt-plans"], queryFn: () => plans() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-memberships"] });

  const createMut = useMutation({
    mutationFn: (data: any) => createFn({ data }),
    onSuccess: (row: any) => {
      toast.success(`Membership ${row.membership_number} created — installments generated`);
      setOpenCreate(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create"),
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => updateFn({ data }),
    onSuccess: () => {
      toast.success("Membership updated");
      setEditing(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => activateFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Membership activated");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Membership cancelled");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const rows = membershipsQ.data ?? [];
  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r: any) => r.status === "active").length;
    const pending = rows.filter((r: any) => r.status === "pending").length;
    const collected = rows.reduce((s: number, r: any) => s + Number(r.paid_amount || 0), 0);
    return { total, active, pending, collected };
  }, [rows]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Memberships</h1>
          <p className="text-sm text-muted-foreground">
            Create, assign, and manage customer memberships. Installments are auto-generated on create.
          </p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button>New membership</Button>
          </DialogTrigger>
          <CreateMembershipDialog
            customers={customersQ.data ?? []}
            promoters={promotersQ.data ?? []}
            plans={plansQ.data ?? []}
            onSubmit={(v) => createMut.mutate(v)}
            submitting={createMut.isPending}
          />
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total (visible)" value={stats.total.toString()} />
        <StatCard label="Active" value={stats.active.toString()} />
        <StatCard label="Pending" value={stats.pending.toString()} />
        <StatCard label="Collected" value={inr(stats.collected)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">All memberships</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search # / customer / plan"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membership #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Promoter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start</TableHead>
                <TableHead className="text-right">Paid / Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {membershipsQ.isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No memberships</TableCell></TableRow>
              ) : rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.membership_number}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.customer?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.customer?.email}</div>
                  </TableCell>
                  <TableCell>{r.plan?.name ?? "—"}</TableCell>
                  <TableCell>{r.promoter?.full_name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusVariant[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>{r.start_date}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inr(Number(r.paid_amount))} <span className="text-muted-foreground">/ {inr(Number(r.total_amount))}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
                      {r.status === "pending" && (
                        <Button size="sm" onClick={() => activateMut.mutate(r.id)} disabled={activateMut.isPending}>Activate</Button>
                      )}
                      {r.status !== "cancelled" && r.status !== "completed" && (
                        <Button size="sm" variant="ghost" onClick={() => cancelMut.mutate(r.id)} disabled={cancelMut.isPending}>Cancel</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <EditMembershipDialog
          row={editing}
          promoters={promotersQ.data ?? []}
          onClose={() => setEditing(null)}
          onSubmit={(v) => updateMut.mutate({ id: editing.id, ...v })}
          submitting={updateMut.isPending}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function CreateMembershipDialog({
  customers, promoters, plans, onSubmit, submitting,
}: {
  customers: any[]; promoters: any[]; plans: any[];
  onSubmit: (v: any) => void; submitting: boolean;
}) {
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState("");
  const [promoterId, setPromoterId] = useState<string>("none");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [advance, setAdvance] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(false);

  const plan = plans.find((p) => p.id === planId);
  const advanceDefault = plan?.advance_amount ?? 0;

  const submit = () => {
    if (!userId || !planId || !startDate) {
      toast.error("Customer, plan, and start date are required");
      return;
    }
    onSubmit({
      user_id: userId,
      plan_id: planId,
      promoter_id: promoterId === "none" ? null : promoterId,
      start_date: startDate,
      advance_paid: advance === "" ? Number(advanceDefault) : Number(advance),
      notes: notes || undefined,
      activate,
    });
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>New membership</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div>
          <Label>Customer</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name || c.email} — {c.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Plan</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
            <SelectContent>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {inr(Number(p.monthly_installment))}/mo × {p.duration_months}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {plan && (
            <p className="mt-1 text-xs text-muted-foreground">
              Advance {inr(Number(plan.advance_amount))} • Total {inr(Number(plan.total_value ?? plan.advance_amount + plan.monthly_installment * plan.duration_months))}
            </p>
          )}
        </div>
        <div>
          <Label>Assign promoter (optional)</Label>
          <Select value={promoterId} onValueChange={setPromoterId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {promoters.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label>Advance paid</Label>
            <Input
              type="number" min={0} step="1"
              placeholder={String(advanceDefault)}
              value={advance}
              onChange={(e) => setAdvance(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
          Activate immediately (skip pending)
        </label>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={submitting}>{submitting ? "Creating…" : "Create membership"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function EditMembershipDialog({
  row, promoters, onClose, onSubmit, submitting,
}: {
  row: any; promoters: any[];
  onClose: () => void; onSubmit: (v: any) => void; submitting: boolean;
}) {
  const [promoterId, setPromoterId] = useState<string>(row.promoter_id ?? "none");
  const [status, setStatus] = useState<string>(row.status);
  const [notes, setNotes] = useState<string>(row.notes ?? "");
  const [startDate, setStartDate] = useState<string>(row.start_date);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit {row.membership_number}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Promoter</Label>
            <Select value={promoterId} onValueChange={setPromoterId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {promoters.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            onClick={() =>
              onSubmit({
                promoter_id: promoterId === "none" ? null : promoterId,
                status,
                notes: notes || null,
                start_date: startDate,
              })
            }
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
