import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMyExportJobs,
  getExportDownloadUrl,
  retryExportJob,
  cancelExportJob,
  markExportJobNotified,
  type ExportJob,
} from "@/lib/exports.functions";
import {
  PollingControls,
  useListRefetchInterval,
} from "@/components/admin/PollingControls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  Loader2,
  RefreshCw,
  Ban,
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/exports")({
  head: () => ({ meta: [{ title: "Exports — Admin" }] }),
  component: AdminExportsPage,
});

const STATUS_META: Record<
  ExportJob["status"],
  { label: string; className: string; icon: typeof Clock }
> = {
  queued: {
    label: "Queued",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    icon: Clock,
  },
  running: {
    label: "Running",
    className: "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
    icon: Loader2,
  },
  succeeded: {
    label: "Ready",
    className:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200",
    icon: AlertTriangle,
  },
  expired: {
    label: "Expired",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground",
    icon: Ban,
  },
};

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function filterSummary(f: ExportJob["filters"]): string[] {
  const chips: string[] = [];
  if (f.status) chips.push(`Status: ${f.status}`);
  if (f.from || f.to)
    chips.push(`Date: ${f.from || "…"} → ${f.to || "…"} (${f.dateField})`);
  if (f.q) chips.push(`Search: ${f.q}`);
  if (f.orderId) chips.push(`Order: ${f.orderId}`);
  if (f.paymentId) chips.push(`Payment: ${f.paymentId}`);
  if (f.customer) chips.push(`Customer: ${f.customer}`);
  chips.push(`Sort: ${f.sortBy} ${f.sortDir}`);
  return chips;
}

function AdminExportsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listMyExportJobs);
  const downloadFn = useServerFn(getExportDownloadUrl);
  const retryFn = useServerFn(retryExportJob);
  const cancelFn = useServerFn(cancelExportJob);
  const markNotifiedFn = useServerFn(markExportJobNotified);

  const refetchInterval = useListRefetchInterval();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-export-jobs"],
    queryFn: () => listFn({ data: { limit: 50 } }),
    // Poll more aggressively than the shared default so a running job flips
    // to "Ready" without a manual refresh; still capped by the user pref.
    refetchInterval:
      refetchInterval === false ? 5_000 : Math.min(Number(refetchInterval), 5_000),
    refetchOnWindowFocus: true,
  });

  const jobs = useMemo(() => data ?? [], [data]);
  const anyActive = jobs.some((j) => j.status === "queued" || j.status === "running");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Toast + mark-notified when a job flips to succeeded since last visit.
  useEffect(() => {
    const unnotified = jobs.filter(
      (j) => j.status === "succeeded" && !j.notified_at,
    );
    if (!unnotified.length) return;
    for (const j of unnotified) {
      toast.success("Export ready", {
        description: `${(j.row_count ?? 0).toLocaleString()} rows · ${formatBytes(j.byte_size)}`,
        action: {
          label: "Download",
          onClick: () => handleDownload(j.id),
        },
      });
    }
    markNotifiedFn({ data: { jobIds: unnotified.map((j) => j.id) } })
      .then(() => queryClient.invalidateQueries({ queryKey: ["admin-export-jobs"] }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  async function handleDownload(jobId: string) {
    setBusyId(jobId);
    try {
      const { url } = await downloadFn({ data: { jobId } });
      // Signed URL already has ?download=filename, open triggers the download.
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRetry(jobId: string) {
    setBusyId(jobId);
    try {
      await retryFn({ data: { jobId } });
      toast.success("Export re-queued");
      queryClient.invalidateQueries({ queryKey: ["admin-export-jobs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(jobId: string) {
    setBusyId(jobId);
    try {
      await cancelFn({ data: { jobId } });
      toast.success("Export cancelled");
      queryClient.invalidateQueries({ queryKey: ["admin-export-jobs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Background Exports
          </h1>
          <p className="text-sm text-muted-foreground">
            Large payments exports run in the background. Files stay
            downloadable for 7 days.
          </p>
        </div>
        <PollingControls
          ariaLabel="Exports polling fallback interval"
          rightSlot={
            anyActive ? (
              <Badge variant="outline" className="gap-1.5 text-[10px]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processing
              </Badge>
            ) : null
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My export jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
              <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No export jobs yet. Start one from the Payments page →
              <span className="font-medium"> Export CSV → Export all (async)</span>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requested</TableHead>
                    <TableHead>Filters</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const meta = STATUS_META[j.status];
                    const Icon = meta.icon;
                    const expired =
                      j.expires_at &&
                      new Date(j.expires_at).getTime() < Date.now();
                    const chips = filterSummary(j.filters);
                    return (
                      <TableRow key={j.id}>
                        <TableCell className="align-top whitespace-nowrap text-xs">
                          {format(new Date(j.created_at), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap gap-1 max-w-[420px]">
                            {chips.map((c) => (
                              <Badge
                                key={c}
                                variant="outline"
                                className="text-[10px] font-normal"
                              >
                                {c}
                              </Badge>
                            ))}
                          </div>
                          {j.error && (
                            <div className="mt-1 text-[11px] text-red-600 dark:text-red-400 max-w-[420px]">
                              {j.error}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            className={`gap-1 ${meta.className}`}
                            variant="secondary"
                          >
                            <Icon
                              className={`h-3 w-3 ${j.status === "running" ? "animate-spin" : ""}`}
                            />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-right tabular-nums text-xs">
                          {j.row_count?.toLocaleString() ?? "—"}
                        </TableCell>
                        <TableCell className="align-top text-right tabular-nums text-xs">
                          {formatBytes(j.byte_size)}
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap text-xs text-muted-foreground">
                          {j.expires_at
                            ? format(new Date(j.expires_at), "MMM d, HH:mm")
                            : "—"}
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <div className="flex justify-end gap-1">
                            {j.status === "succeeded" && !expired && (
                              <Button
                                size="sm"
                                variant="default"
                                disabled={busyId === j.id}
                                onClick={() => handleDownload(j.id)}
                              >
                                {busyId === j.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                <span className="ml-1">Download</span>
                              </Button>
                            )}
                            {(j.status === "failed" ||
                              j.status === "expired" ||
                              (j.status === "succeeded" && expired)) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === j.id}
                                onClick={() => handleRetry(j.id)}
                              >
                                <RefreshCw className="mr-1 h-3 w-3" />
                                Retry
                              </Button>
                            )}
                            {j.status === "queued" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === j.id}
                                onClick={() => handleCancel(j.id)}
                              >
                                <Ban className="mr-1 h-3 w-3" />
                                Cancel
                              </Button>
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
          {isFetching && !isLoading && (
            <div className="mt-2 text-[11px] text-muted-foreground text-right">
              Refreshing…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
