import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  listKycEmailNotifications,
  retryKycEmailNotification,
  processKycEmailQueue,
  type KycEmailNotification,
  type KycEmailStatus,
} from "@/lib/kyc-emails.functions";

export const Route = createFileRoute("/_authenticated/admin/kyc-emails")({
  component: KycEmailsPage,
});

const STATUS_META: Record<
  KycEmailStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    icon: Clock,
  },
  sending: {
    label: "Sending",
    className: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    icon: Loader2,
  },
  sent: {
    label: "Sent",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed (will retry)",
    className: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    icon: AlertCircle,
  },
  dead_letter: {
    label: "Dead-lettered",
    className: "bg-red-500/10 text-red-600 border-red-500/30",
    icon: XCircle,
  },
  skipped: {
    label: "Skipped (no infra)",
    className: "bg-slate-500/10 text-slate-500 border-slate-500/30",
    icon: AlertCircle,
  },
};

function KycEmailsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"all" | KycEmailStatus>("all");
  const [decision, setDecision] = useState<"all" | "approved" | "rejected">("all");
  const [selected, setSelected] = useState<KycEmailNotification | null>(null);

  const listFn = useServerFn(listKycEmailNotifications);
  const retryFn = useServerFn(retryKycEmailNotification);
  const processFn = useServerFn(processKycEmailQueue);

  const query = useQuery({
    queryKey: ["kyc-emails", status, decision],
    queryFn: () =>
      listFn({
        data: {
          status: status === "all" ? undefined : status,
          decision: decision === "all" ? undefined : decision,
          limit: 100,
        },
      }),
    refetchInterval: 15000,
  });

  const retryMut = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }),
    onSuccess: (res) => {
      toast.success(
        res.status === "sent"
          ? "Email sent successfully."
          : `Retry finished: ${res.status}${res.error ? ` — ${res.error}` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["kyc-emails"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  const processMut = useMutation({
    mutationFn: () => processFn({ data: { limit: 25 } }),
    onSuccess: (res) => {
      toast.success(`Processed ${res.claimed} due job(s).`);
      qc.invalidateQueries({ queryKey: ["kyc-emails"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Failed to process queue"),
  });

  const rows = query.data ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      total: rows.length,
      sent: 0,
      failed: 0,
      dead_letter: 0,
      pending: 0,
    };
    for (const r of rows) {
      if (r.status === "sent") c.sent++;
      else if (r.status === "failed") c.failed++;
      else if (r.status === "dead_letter") c.dead_letter++;
      else if (r.status === "pending" || r.status === "sending") c.pending++;
    }
    return c;
  }, [rows]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Mail className="h-6 w-6" /> KYC Email Log
          </h1>
          <p className="text-sm text-muted-foreground">
            Every KYC approved/rejected notification, with delivery status and retry controls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["kyc-emails"] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => processMut.mutate()}
            disabled={processMut.isPending}
          >
            {processMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Process due retries
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total (100 latest)", value: counts.total },
          { label: "Sent", value: counts.sent },
          { label: "Pending / sending", value: counts.pending },
          { label: "Failed (will retry)", value: counts.failed },
          { label: "Dead-lettered", value: counts.dead_letter },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold mt-1">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle>Delivery attempts</CardTitle>
            <CardDescription>Newest first · auto-refreshes every 15s</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="sending">Sending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="dead_letter">Dead-lettered</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as typeof decision)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Decision" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All decisions</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No KYC emails match these filters yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Next retry</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const meta = STATUS_META[r.status];
                    const Icon = meta.icon;
                    const canRetry =
                      r.status === "failed" ||
                      r.status === "dead_letter" ||
                      r.status === "skipped" ||
                      r.status === "pending";
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(r)}
                      >
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(new Date(r.created_at), "dd MMM, HH:mm")}
                        </TableCell>
                        <TableCell className="text-sm">{r.recipient_email}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              r.decision === "approved"
                                ? "border-emerald-500/40 text-emerald-600"
                                : "border-red-500/40 text-red-600"
                            }
                          >
                            {r.decision}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={meta.className}>
                            <Icon
                              className={`h-3 w-3 mr-1 ${
                                r.status === "sending" ? "animate-spin" : ""
                              }`}
                            />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.attempts}/{r.max_attempts}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.next_attempt_at
                            ? format(new Date(r.next_attempt_at), "dd MMM, HH:mm")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              !canRetry ||
                              (retryMut.isPending && retryMut.variables === r.id)
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              retryMut.mutate(r.id);
                            }}
                          >
                            {retryMut.isPending && retryMut.variables === r.id ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3 mr-1" />
                            )}
                            Retry
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>KYC email attempt</SheetTitle>
                <SheetDescription>{selected.recipient_email}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <Row label="Decision" value={selected.decision} />
                <Row label="Status" value={selected.status} />
                <Row label="Subject" value={selected.subject ?? "—"} />
                <Row label="Provider" value={selected.provider ?? "—"} />
                <Row label="Provider msg id" value={selected.message_id ?? "—"} />
                <Row
                  label="Attempts"
                  value={`${selected.attempts} / ${selected.max_attempts}`}
                />
                <Row
                  label="Last attempt"
                  value={
                    selected.last_attempt_at
                      ? format(new Date(selected.last_attempt_at), "dd MMM yyyy HH:mm")
                      : "—"
                  }
                />
                <Row
                  label="Next attempt"
                  value={
                    selected.next_attempt_at
                      ? format(new Date(selected.next_attempt_at), "dd MMM yyyy HH:mm")
                      : "—"
                  }
                />
                <Row label="Reviewer" value={selected.reviewer_email ?? "—"} />
                <Row label="Assigned role" value={selected.assigned_role ?? "—"} />
                {selected.error_message ? (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">
                      Error
                    </div>
                    <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-red-600 text-xs whitespace-pre-wrap">
                      {selected.error_code ? `[${selected.error_code}] ` : ""}
                      {selected.error_message}
                    </div>
                  </div>
                ) : null}
                {selected.review_notes ? (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">
                      Review notes
                    </div>
                    <div className="rounded border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                      {selected.review_notes}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="text-xs uppercase text-muted-foreground mb-1">
                    Attempt history
                  </div>
                  <pre className="rounded border bg-muted/40 p-2 text-[11px] overflow-x-auto max-h-64">
                    {selected.attempts_log}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
