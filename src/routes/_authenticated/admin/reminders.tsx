import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  AlertCircle,
  BellRing,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Mail,
  Search,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  enqueueInstallmentReminders,
  listDueInstallmentsForReminders,
  type DueInstallmentRow,
} from "@/lib/reminders.functions";

export const Route = createFileRoute("/_authenticated/admin/reminders")({
  head: () => ({
    meta: [{ title: "Payment Reminders — Arasi Enterprises" }],
  }),
  component: RemindersPage,
});

type StatusFilter = "all" | "pending" | "overdue";

function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function isToday(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function StatusBadge({ status, dueDate }: { status: string; dueDate: string }) {
  if (status === "overdue") {
    return <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700">Overdue</Badge>;
  }
  if (isToday(dueDate)) {
    return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">Due today</Badge>;
  }
  return <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-700">Upcoming</Badge>;
}

function RemindersPage() {
  const queryClient = useQueryClient();

  const dueQuery = useQuery({
    queryKey: ["admin", "reminders", "due-installments"],
    queryFn: () => listDueInstallmentsForReminders(),
  });

  const rows = dueQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [scheduleAt, setScheduleAt] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    // yyyy-MM-ddTHH:mm for datetime-local
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [previewOpen, setPreviewOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.customer_name ?? "").toLowerCase().includes(q) ||
        (r.customer_email ?? "").toLowerCase().includes(q) ||
        (r.membership_number ?? "").toLowerCase().includes(q) ||
        (r.member_display_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const filteredIds = useMemo(() => filtered.map((r) => r.installment_id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someFilteredSelected = filteredIds.some((id) => selected.has(id));

  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) filteredIds.forEach((id) => next.add(id));
      else filteredIds.forEach((id) => next.delete(id));
      return next;
    });
  };
  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.installment_id)),
    [rows, selected],
  );
  const selectedWithEmail = selectedRows.filter((r) => !!r.customer_email);
  const selectedMissingEmail = selectedRows.length - selectedWithEmail.length;
  const selectedTotalAmount = selectedRows.reduce((sum, r) => sum + r.amount, 0);

  const enqueueFn = useServerFn(enqueueInstallmentReminders);
  const enqueue = useMutation({
    mutationFn: (payload: { installmentIds: string[]; scheduledAt?: string }) =>
      enqueueFn({
        data: {
          installmentIds: payload.installmentIds,
          channel: "email",
          reminderKind: "manual",
          scheduledAt: payload.scheduledAt,
        },
      }),
    onSuccess: (res) => {
      const when = new Date(res.scheduled_at);
      const whenLabel = format(when, "PPp");
      toast.success(`Queued ${res.created} reminder${res.created === 1 ? "" : "s"}`, {
        description: `Scheduled for ${whenLabel}. ${res.skipped_existing} already queued, ${res.skipped_missing_contact} missing contact.`,
      });
      setSelected(new Set());
      setPreviewOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "reminders"] });
    },
    onError: (err) => {
      toast.error("Failed to queue reminders", {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const handleSend = () => {
    if (selectedRows.length === 0) {
      toast.warning("Select at least one installment first.");
      return;
    }
    let scheduledAtIso: string | undefined;
    if (sendMode === "schedule") {
      const d = new Date(scheduleAt);
      if (Number.isNaN(d.getTime())) {
        toast.error("Pick a valid date and time.");
        return;
      }
      if (d.getTime() <= Date.now()) {
        toast.error("Scheduled time must be in the future.");
        return;
      }
      scheduledAtIso = d.toISOString();
    }
    enqueue.mutate({
      installmentIds: selectedRows.map((r) => r.installment_id),
      scheduledAt: scheduledAtIso,
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BellRing className="h-6 w-6 text-primary" /> Payment Reminders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick due installments, preview recipients, and send reminders now or schedule for later.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Users className="h-3 w-3" /> {selected.size} selected
          </Badge>
          <Button
            variant="outline"
            disabled={selected.size === 0}
            onClick={() => setPreviewOpen(true)}
          >
            Preview & send
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="text-base">Due installments</CardTitle>
              <CardDescription>
                {dueQuery.isLoading
                  ? "Loading…"
                  : `${filtered.length} of ${rows.length} shown`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name, email, membership…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 h-9 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All due</SelectItem>
                  <SelectItem value="overdue">Overdue only</SelectItem>
                  <SelectItem value="pending">Pending only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleSelectAllFiltered(v === true)}
                      aria-label="Select all filtered"
                    />
                  </TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Installment</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dueQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      No due installments match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => {
                    const checked = selected.has(r.installment_id);
                    return (
                      <TableRow key={r.installment_id} data-state={checked ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleRow(r.installment_id, v === true)}
                            aria-label={`Select installment ${r.sequence}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.customer_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.customer_email ?? "no email"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{r.membership_number ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.member_display_id ?? ""}</div>
                        </TableCell>
                        <TableCell>#{r.sequence}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(r.due_date + "T00:00:00"), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-right">{formatINR(r.amount)}</TableCell>
                        <TableCell><StatusBadge status={r.status} dueDate={r.due_date} /></TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send reminders</DialogTitle>
            <DialogDescription>
              Review who will receive an email reminder, then send now or schedule for later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Recipients</div>
              <div className="text-lg font-semibold">{selectedWithEmail.length}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Missing email</div>
              <div className="text-lg font-semibold">{selectedMissingEmail}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Total due</div>
              <div className="text-lg font-semibold">{formatINR(selectedTotalAmount)}</div>
            </div>
          </div>

          <div className="max-h-56 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Installment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedRows.map((r) => (
                  <TableRow key={r.installment_id}>
                    <TableCell>
                      <div className="text-sm">{r.customer_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_email ?? "no email"}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      #{r.sequence} · {format(new Date(r.due_date + "T00:00:00"), "dd MMM")}
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatINR(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {selectedMissingEmail > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
              <span>
                {selectedMissingEmail} selected {selectedMissingEmail === 1 ? "customer has" : "customers have"} no email on file — they will be skipped.
              </span>
            </div>
          )}

          <div className="space-y-3">
            <RadioGroup value={sendMode} onValueChange={(v) => setSendMode(v as "now" | "schedule")} className="grid grid-cols-2 gap-3">
              <Label htmlFor="mode-now" className="flex cursor-pointer items-start gap-2 rounded-md border p-3 [&:has([data-state=checked])]:border-primary">
                <RadioGroupItem id="mode-now" value="now" className="mt-0.5" />
                <div>
                  <div className="font-medium text-sm flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Send now</div>
                  <div className="text-xs text-muted-foreground">Queue for immediate delivery.</div>
                </div>
              </Label>
              <Label htmlFor="mode-schedule" className="flex cursor-pointer items-start gap-2 rounded-md border p-3 [&:has([data-state=checked])]:border-primary">
                <RadioGroupItem id="mode-schedule" value="schedule" className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Schedule</div>
                  <div className="text-xs text-muted-foreground">Pick a future date and time.</div>
                </div>
              </Label>
            </RadioGroup>
            {sendMode === "schedule" && (
              <div className="space-y-1.5">
                <Label htmlFor="schedule-at" className="text-xs">Deliver at</Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={enqueue.isPending || selectedWithEmail.length === 0}>
              {enqueue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sendMode === "now" ? "Send now" : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
