import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPlanDeletionAudit, type PlanDeletionRow } from "@/lib/plan-deletions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/plan-deletions")({
  component: PlanDeletionsPage,
});

function PlanDeletionsPage() {
  const fetchList = useServerFn(listPlanDeletionAudit);
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState<"all" | "blocked" | "success">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [selected, setSelected] = useState<PlanDeletionRow | null>(null);

  const filters = useMemo(
    () => ({ q, actor, plan, status, from, to, page, pageSize }),
    [q, actor, plan, status, from, to, page],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "plan-deletions", filters],
    queryFn: () => fetchList({ data: filters }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const reset = () => {
    setQ(""); setActor(""); setPlan(""); setStatus("all"); setFrom(""); setTo(""); setPage(1);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Plan Deletion Audit</h1>
        <p className="text-sm text-muted-foreground">
          Every blocked and successful plan-deletion attempt, from admin_audit_log.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <Label>Search</Label>
            <Input placeholder="actor / plan / error…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div>
            <Label>Actor email</Label>
            <Input value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} />
          </div>
          <div>
            <Label>Plan (name or id)</Label>
            <Input value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <div className="lg:col-span-6 flex justify-end">
            <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Blocking</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No entries.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="whitespace-nowrap">{format(new Date(r.created_at), "PPp")}</TableCell>
                  <TableCell>
                    {r.action === "plan_delete_success" ? (
                      <Badge variant="default">Success</Badge>
                    ) : (
                      <Badge variant="destructive">Blocked</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.actor_email ?? r.actor_id}</TableCell>
                  <TableCell className="text-sm">{r.plan_name ?? r.plan_id ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.counts.blocking}</TableCell>
                  <TableCell className="text-right">{r.counts.total}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{r.error_message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between p-3 border-t text-sm">
            <div className="text-muted-foreground">{total} entries</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>Page {page} of {pageCount}</span>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Deletion attempt</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="text-muted-foreground">Status</div>
                <div>{selected.action === "plan_delete_success" ? "Success" : "Blocked"}</div>
                <div className="text-muted-foreground">When</div>
                <div>{format(new Date(selected.created_at), "PPpp")}</div>
                <div className="text-muted-foreground">Actor</div>
                <div>{selected.actor_email ?? selected.actor_id}</div>
                <div className="text-muted-foreground">Plan</div>
                <div>{selected.plan_name ?? "—"}</div>
                <div className="text-muted-foreground">Plan ID</div>
                <div className="break-all text-xs">{selected.plan_id ?? "—"}</div>
              </div>
              <div>
                <div className="font-medium mb-1">Enrollment counts</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>Pending: {selected.counts.pending}</div>
                  <div>Active: {selected.counts.active}</div>
                  <div>Cancelled: {selected.counts.cancelled}</div>
                  <div>Completed: {selected.counts.completed}</div>
                  <div>Blocking: {selected.counts.blocking}</div>
                  <div>Total: {selected.counts.total}</div>
                </div>
              </div>
              {selected.error_message && (
                <div>
                  <div className="font-medium mb-1">Error</div>
                  <div className="text-destructive text-xs">{selected.error_message}</div>
                </div>
              )}
              <div>
                <div className="font-medium mb-1">Metadata</div>
                <pre className="bg-muted rounded p-2 text-xs overflow-x-auto">{JSON.stringify(selected.metadata, null, 2)}</pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
