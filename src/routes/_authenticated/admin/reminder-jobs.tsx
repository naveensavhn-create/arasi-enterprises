import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  AlertTriangle,
  Ban,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  cancelReminderJobs,
  listReminderJobs,
  retryReminderJobs,
  type ReminderJobRow,
  type ReminderJobStatus,
} from "@/lib/reminders.functions";

export const Route = createFileRoute("/_authenticated/admin/reminder-jobs")({
  head: () => ({
    meta: [{ title: "Reminder Jobs — Arasi Enterprises" }],
  }),
  component: ReminderJobsPage,
});

type StatusOption = ReminderJobStatus | "all";
type ChannelOption = "email" | "sms" | "all";

const STATUS_STYLES: Record<ReminderJobStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  sending: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  sent: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-700 border-red-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  skipped: "bg-muted text-muted-foreground border-border",
};

function formatINR(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmt(d: string | null) {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM yyyy, HH:mm");
  } catch {
    return d;
  }
}

function ReminderJobsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listReminderJobs);
  const retry = useServerFn(retryReminderJobs);
  const cancel = useServerFn(cancelReminderJobs);

  const [status, setStatus] = useState<StatusOption>("all");
  const [channel, setChannel] = useState<ChannelOption>("all");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<ReminderJobRow | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "retry" | "cancel"; ids: string[] }>(null);

  // debounce search
  useMemo(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useQuery({
    queryKey: ["admin-reminder-jobs", status, channel, qDebounced, page],
    queryFn: () =>
      list({
        data: { status, channel, q: qDebounced || undefined, page, pageSize },
      }),
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const allChecked = rows.length > 0 && rows.every((r) => selected[r.id]);
  const toggleAll = (v: boolean) => {
    const next = { ...selected };
    for (const r of rows) next[r.id] = v;
    setSelected(next);
  };

  const retryMut = useMutation({
    mutationFn: (ids: string[]) => retry({ data: { jobIds: ids } }),
    onSuccess: (res) => {
      toast.success(
        `Retried ${res.updated} job(s)` +
          (res.skipped ? ` — ${res.skipped} skipped (already sent or in flight).` : "."),
      );
      setSelected({});
      qc.invalidateQueries({ queryKey: ["admin-reminder-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to retry jobs"),
  });

  const cancelMut = useMutation({
    mutationFn: (ids: string[]) => cancel({ data: { jobIds: ids } }),
    onSuccess: (res) => {
      toast.success(
        `Cancelled ${res.updated} job(s)` +
          (res.skipped ? ` — ${res.skipped} skipped (already sent or in flight).` : "."),
      );
      setSelected({});
      qc.invalidateQueries({ queryKey: ["admin-reminder-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to cancel jobs"),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reminder Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Inspect every dispatch attempt, retry failed jobs, and cancel pending ones.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Narrow the list before acting.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v as StatusOption); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sending">Sending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Channel</Label>
            <Select value={channel} onValueChange={(v) => { setChannel(v as ChannelOption); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Search (email, phone, error, provider id)</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="foo@bar.com, +9198…, invalid_recipient…"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
        <Button
          size="sm"
          disabled={!selectedIds.length || retryMut.isPending}
          onClick={() => setConfirm({ kind: "retry", ids: selectedIds })}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Retry selected ({selectedIds.length})
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!selectedIds.length || cancelMut.isPending}
          onClick={() => setConfirm({ kind: "cancel", ids: selectedIds })}
        >
          <Ban className="mr-2 h-4 w-4" />
          Cancel selected ({selectedIds.length})
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {total.toLocaleString("en-IN")} job{total === 1 ? "" : "s"}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={(v) => toggleAll(Boolean(v))}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Installment</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Provider error</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      No reminder jobs match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Checkbox
                          checked={!!selected[r.id]}
                          onCheckedChange={(v) =>
                            setSelected((s) => ({ ...s, [r.id]: Boolean(v) }))
                          }
                          aria-label={`Select ${r.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLES[r.status]}>
                          {r.status}
                        </Badge>
                        {r.dead_letter_at ? (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                            <AlertTriangle className="h-3 w-3" />
                            dead-lettered
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs">
                          {r.channel === "email" ? (
                            <Mail className="h-3 w-3" />
                          ) : (
                            <MessageSquare className="h-3 w-3" />
                          )}
                          {r.channel}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{r.reminder_kind}</div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <div className="truncate font-medium">
                          {r.customer_name ?? r.recipient_email ?? r.recipient_phone ?? "—"}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {r.channel === "email"
                            ? r.recipient_email ?? "(no email)"
                            : r.recipient_phone ?? "(no phone)"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          #{r.installment_sequence ?? "—"} · {formatINR(r.installment_amount)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.membership_number ?? r.member_display_id ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{fmt(r.scheduled_at)}</div>
                        {r.next_attempt_at ? (
                          <div className="text-[11px] text-muted-foreground">
                            next: {fmt(r.next_attempt_at)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.attempts} / {r.max_attempts}
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        {r.error_code || r.error_message ? (
                          <div>
                            <div className="font-mono text-[11px] text-red-600">
                              {r.error_code ?? "error"}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {r.error_message}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || query.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || query.isFetching}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Reminder job</SheetTitle>
            <SheetDescription>Full dispatch record and provider metadata.</SheetDescription>
          </SheetHeader>
          {detail ? (
            <div className="mt-4 space-y-4 text-sm">
              <DetailRow label="Job ID" value={<code className="text-[11px]">{detail.id}</code>} />
              <DetailRow
                label="Status"
                value={
                  <Badge variant="outline" className={STATUS_STYLES[detail.status]}>
                    {detail.status}
                  </Badge>
                }
              />
              <DetailRow label="Channel / kind" value={`${detail.channel} · ${detail.reminder_kind}`} />
              <DetailRow
                label="Recipient"
                value={
                  <div>
                    <div>{detail.customer_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {detail.recipient_email ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {detail.recipient_phone ?? "—"}
                    </div>
                  </div>
                }
              />
              <DetailRow
                label="Installment"
                value={`#${detail.installment_sequence ?? "—"} · ${formatINR(detail.installment_amount)} · due ${detail.installment_due_date ?? "—"}`}
              />
              <DetailRow
                label="Membership"
                value={detail.membership_number ?? detail.member_display_id ?? "—"}
              />
              <DetailRow label="Scheduled at" value={fmt(detail.scheduled_at)} />
              <DetailRow label="Next attempt" value={fmt(detail.next_attempt_at)} />
              <DetailRow label="Last attempt" value={fmt(detail.last_attempt_at)} />
              <DetailRow label="Sent at" value={fmt(detail.sent_at)} />
              <DetailRow label="Attempts" value={`${detail.attempts} / ${detail.max_attempts}`} />
              <DetailRow label="Provider" value={detail.provider ?? "—"} />
              <DetailRow
                label="Provider message ID"
                value={
                  detail.provider_message_id ? (
                    <code className="text-[11px]">{detail.provider_message_id}</code>
                  ) : (
                    "—"
                  )
                }
              />
              <DetailRow
                label="Error code"
                value={
                  detail.error_code ? (
                    <code className="text-[11px] text-red-600">{detail.error_code}</code>
                  ) : (
                    "—"
                  )
                }
              />
              <DetailRow
                label="Error message"
                value={
                  <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {detail.error_message ?? "—"}
                  </div>
                }
              />
              {detail.dead_letter_at ? (
                <DetailRow
                  label="Dead-lettered"
                  value={
                    <div>
                      <div className="text-xs">{fmt(detail.dead_letter_at)}</div>
                      <div className="text-xs text-muted-foreground">
                        {detail.dead_letter_reason ?? "—"}
                      </div>
                    </div>
                  }
                />
              ) : null}
              <DetailRow
                label="Metadata"
                value={
                  <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(detail.metadata ?? {}, null, 2)}
                  </pre>
                }
              />
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => setConfirm({ kind: "retry", ids: [detail.id] })}
                  disabled={retryMut.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Retry
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirm({ kind: "cancel", ids: [detail.id] })}
                  disabled={cancelMut.isPending}
                >
                  <Ban className="mr-2 h-4 w-4" /> Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "retry" ? "Retry" : "Cancel"} {confirm?.ids.length} job(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "retry"
                ? "Failed, cancelled, and skipped jobs will be re-scheduled for immediate delivery. Already-sent or in-flight jobs will be left alone."
                : "Pending, failed, and skipped jobs will be marked cancelled so the worker skips them. Already-sent or in-flight jobs will be left alone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep as-is</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "retry") retryMut.mutate(confirm.ids);
                else cancelMut.mutate(confirm.ids);
                setConfirm(null);
                setDetail(null);
              }}
            >
              Yes, {confirm?.kind === "retry" ? "retry" : "cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b pb-2 last:border-none">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm">{value}</div>
    </div>
  );
}
