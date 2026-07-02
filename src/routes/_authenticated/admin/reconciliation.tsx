import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listReconciliationFindings,
  getReconciliationSummary,
  resolveReconciliationFinding,
  runReconciliationNow,
  type ReconciliationFinding,
} from "@/lib/reconciliation.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Ban,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/reconciliation")({
  component: ReconciliationPage,
});

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500 border-red-500/30",
  warning: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-500 border-sky-500/30",
};

const CATEGORY_LABEL: Record<string, string> = {
  membership: "Membership",
  receipt: "Receipt",
  reward: "Reward",
  draw: "Lucky Draw",
  commission: "Commission",
  audit: "Audit Trail",
};

function ReconciliationPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listReconciliationFindings);
  const summaryFn = useServerFn(getReconciliationSummary);
  const resolveFn = useServerFn(resolveReconciliationFinding);
  const runFn = useServerFn(runReconciliationNow);

  const [status, setStatus] = useState<"open" | "resolved" | "ignored" | "all">(
    "open",
  );
  const [category, setCategory] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [selected, setSelected] = useState<ReconciliationFinding | null>(null);
  const [note, setNote] = useState("");

  const summary = useQuery({
    queryKey: ["recon", "summary"],
    queryFn: () => summaryFn(),
  });

  const findings = useQuery({
    queryKey: ["recon", "list", status, category, severity],
    queryFn: () =>
      listFn({
        data: {
          status,
          category: category as any,
          severity: severity as any,
        },
      }),
  });

  const runMut = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (res: any) => {
      toast.success(`Reconciliation complete — ${res?.total ?? 0} findings`);
      qc.invalidateQueries({ queryKey: ["recon"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Reconciliation failed"),
  });

  const resolveMut = useMutation({
    mutationFn: (input: {
      id: string;
      status: "resolved" | "ignored" | "open";
      note?: string;
    }) => resolveFn({ data: input }),
    onSuccess: () => {
      toast.success("Finding updated");
      setSelected(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["recon"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const rows = findings.data ?? [];
  const s = summary.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reconciliation Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Compares expected membership, receipt, reward, draw, and commission
            state against actual data and the audit log. Runs automatically
            every 6 hours.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["recon"] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
          >
            <PlayCircle className="mr-2 h-4 w-4" />
            {runMut.isPending ? "Running…" : "Run now"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          icon={<ShieldAlert className="h-4 w-4 text-red-500" />}
          label="Critical open"
          value={s?.critical ?? 0}
          tone="critical"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          label="Warnings open"
          value={s?.warning ?? 0}
          tone="warning"
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Resolved (all-time)"
          value={s?.resolved ?? 0}
        />
        <StatCard
          icon={<Ban className="h-4 w-4 text-muted-foreground" />}
          label="Ignored"
          value={s?.ignored ?? 0}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Findings</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="ignored">Ignored</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Severity</TableHead>
                  <TableHead className="w-[130px]">Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[130px]">Entity</TableHead>
                  <TableHead className="w-[110px]">Seen</TableHead>
                  <TableHead className="w-[80px] text-right">×</TableHead>
                  <TableHead className="w-[110px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Loading findings…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No findings for this filter. Systems are in sync.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={SEVERITY_STYLE[f.severity]}
                        >
                          {f.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {CATEGORY_LABEL[f.category] ?? f.category}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{f.description}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {f.code}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="text-muted-foreground">
                          {f.entity_type}
                        </div>
                        <div className="truncate font-mono text-[11px]">
                          {f.entity_ref ?? f.entity_id ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {new Date(f.last_seen_at).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {f.occurrence_count}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelected(f);
                            setNote(f.resolution_note ?? "");
                          }}
                        >
                          Review
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

      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Finding detail</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={SEVERITY_STYLE[selected.severity]}
                >
                  {selected.severity}
                </Badge>
                <Badge variant="secondary">
                  {CATEGORY_LABEL[selected.category] ?? selected.category}
                </Badge>
                <Badge variant="outline">{selected.status}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {selected.code}
                </span>
              </div>
              <p>{selected.description}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                    Expected
                  </div>
                  <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(selected.expected, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                    Actual
                  </div>
                  <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(selected.actual, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <div>
                  Entity: {selected.entity_type} ·{" "}
                  <span className="font-mono">
                    {selected.entity_ref ?? selected.entity_id ?? "—"}
                  </span>
                </div>
                <div>Occurrences: {selected.occurrence_count}</div>
                <div>
                  First seen:{" "}
                  {new Date(selected.first_seen_at).toLocaleString("en-IN")}
                </div>
                <div>
                  Last seen:{" "}
                  {new Date(selected.last_seen_at).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                  Resolution note
                </div>
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What was done, or why this is being ignored?"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                selected &&
                resolveMut.mutate({
                  id: selected.id,
                  status: "open",
                  note: note || undefined,
                })
              }
              disabled={resolveMut.isPending || selected?.status === "open"}
            >
              Reopen
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                selected &&
                resolveMut.mutate({
                  id: selected.id,
                  status: "ignored",
                  note: note || undefined,
                })
              }
              disabled={resolveMut.isPending}
            >
              Ignore
            </Button>
            <Button
              onClick={() =>
                selected &&
                resolveMut.mutate({
                  id: selected.id,
                  status: "resolved",
                  note: note || undefined,
                })
              }
              disabled={resolveMut.isPending}
            >
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "critical" | "warning";
}) {
  return (
    <Card
      className={
        tone === "critical" && value > 0
          ? "border-red-500/40"
          : tone === "warning" && value > 0
            ? "border-amber-500/40"
            : ""
      }
    >
      <CardContent className="flex items-center gap-3 py-4">
        <div className="rounded-md border p-2">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
