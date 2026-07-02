import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAdminAuditLog, exportAdminAuditLog, type AuditLogRow } from "@/lib/audit-log.functions";
import { getMyRole } from "@/lib/roles.functions";
import { toast } from "sonner";
import { Download, Filter, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PollingControls, useListRefetchInterval } from "@/components/admin/PollingControls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Forbidden, ForbiddenError } from "@/components/access/Forbidden";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/audit-log")({
  beforeLoad: async () => {
    const role = await getMyRole();
    if (role !== "admin") throw new ForbiddenError("admin", role);
    return { role };
  },
  errorComponent: ({ error }) => {
    const msg = error instanceof Error ? error.message : String(error);
    if (error instanceof ForbiddenError) {
      return <Forbidden required={error.required} actual={error.actual} />;
    }
    if (/forbidden|unauthorized|admin role required/i.test(msg)) {
      return <Forbidden required="admin" actual={null} />;
    }
    return (
      <div className="p-6 text-sm text-destructive">{msg || "Something went wrong."}</div>
    );
  },
  component: AuditLogPage,
});

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.endsWith(".approved") || action.endsWith(".success") || action === "user.restored") return "default";
  if (action.endsWith(".rejected") || action.endsWith(".blocked") || action.endsWith(".deleted") || action.endsWith(".revoked")) return "destructive";
  if (action.startsWith("role.")) return "secondary";
  return "outline";
}

function AuditLogPage() {
  const fetchList = useServerFn(listAdminAuditLog);
  const runExport = useServerFn(exportAdminAuditLog);
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState<string>("all");
  const [reviewedField, setReviewedField] = useState<string>("all");
  const [paymentId, setPaymentId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    () => ({
      q,
      actor,
      actions: action === "all" ? [] : [action],
      reviewedField: reviewedField === "all" ? "" : reviewedField,
      paymentId,
      customerId,
      promoterId,
      from,
      to,
      page,
      pageSize,
    }),
    [q, actor, action, reviewedField, paymentId, customerId, promoterId, from, to, page],
  );

  const refetchInterval = useListRefetchInterval();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "audit-log", filters],
    queryFn: () => fetchList({ data: filters }),
    refetchInterval,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const actionOptions = data?.actionOptions ?? [];
  const reviewedFieldOptions = data?.reviewedFieldOptions ?? [];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const reset = () => {
    setQ(""); setActor(""); setAction("all"); setReviewedField("all");
    setPaymentId(""); setCustomerId(""); setPromoterId("");
    setFrom(""); setTo(""); setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { csv, count } = await runExport({
        data: {
          q,
          actor,
          actions: action === "all" ? [] : [action],
          reviewedField: reviewedField === "all" ? "" : reviewedField,
          paymentId,
          customerId,
          promoterId,
          from,
          to,
        },
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `admin-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${count} entries`, {
        description: count >= 10000 ? "Result capped at 10,000 rows — narrow filters for a smaller set." : undefined,
      });
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin Audit Log</h1>
          <p className="text-sm text-muted-foreground">Every privileged action — role changes, KYC decisions, deletions, and more.</p>
        </div>
        <div className="flex items-center gap-2">
          <PollingControls />
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <Label htmlFor="q" className="text-xs">Search</Label>
              <Input id="q" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Actor, target, action, reason…" />
            </div>
            <div>
              <Label htmlFor="actor" className="text-xs">Actor email</Label>
              <Input id="actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} placeholder="admin@…" />
            </div>
            <div>
              <Label className="text-xs">Action</Label>
              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All actions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reviewed KYC field</Label>
              <Select value={reviewedField} onValueChange={(v) => { setReviewedField(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Any field" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any field</SelectItem>
                  {reviewedFieldOptions.length === 0 && (
                    <SelectItem value="__none" disabled>No fields in current results</SelectItem>
                  )}
                  {reviewedFieldOptions.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="from" className="text-xs">From</Label>
                <Input id="from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
              </div>
              <div className="flex-1">
                <Label htmlFor="to" className="text-xs">To</Label>
                <Input id="to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="mr-1 h-4 w-4" /> Reset filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Role change</TableHead>
                <TableHead>Reviewed fields</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No audit entries match these filters.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm">{format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                    <TableCell><Badge variant={actionVariant(r.action)}>{r.action}</Badge></TableCell>
                    <TableCell className="text-sm">{r.actor_email ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{r.target_email ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">
                      {r.role_before || r.role_after ? (
                        <span>
                          <span className="text-muted-foreground">{r.role_before ?? "∅"}</span>
                          {" → "}
                          <span>{r.role_after ?? "∅"}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.reviewed_fields.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.reviewed_fields.map((f) => (
                            <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>View</Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{total} total • page {page} of {pageCount}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit entry</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <Row label="Action"><Badge variant={actionVariant(selected.action)}>{selected.action}</Badge></Row>
              <Row label="When">{format(new Date(selected.created_at), "PPpp")}</Row>
              <Row label="Actor">{selected.actor_email ?? "—"}<div className="text-xs text-muted-foreground">{selected.actor_id ?? ""}</div></Row>
              <Row label="Target">{selected.target_email ?? "—"}<div className="text-xs text-muted-foreground">{selected.target_user_id ?? ""}</div></Row>
              <Row label="Role change">{(selected.role_before ?? "∅") + " → " + (selected.role_after ?? "∅")}</Row>
              <Row label="Reason">{selected.reason ?? "—"}</Row>
              <Row label="Reviewed fields">{selected.reviewed_fields.join(", ") || "—"}</Row>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Metadata</div>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selected.metadata, null, 2)}</pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
