import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listIncentivesAdmin,
  generateMonthlyIncentives,
  updateIncentiveStatus,
} from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/incentives")({
  head: () => ({ meta: [{ title: "Monthly Incentives — Admin" }] }),
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listIncentivesAdmin);
  const gen = useServerFn(generateMonthlyIncentives);
  const upd = useServerFn(updateIncentiveStatus);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data, isLoading } = useQuery({ queryKey: ["admin-incentives"], queryFn: () => list() });

  const genMut = useMutation({
    mutationFn: () => gen({ data: { year, month } }),
    onSuccess: (res) => {
      toast.success(`Generated ${res.generated} incentive entries`);
      qc.invalidateQueries({ queryKey: ["admin-incentives"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updMut = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "paid" | "rejected"; reference?: string }) => upd({ data: v }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["admin-incentives"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly Incentives</h1>
          <p className="text-sm text-muted-foreground">Generate incentives by current rank, then approve or pay.</p>
        </div>
        <div className="flex items-end gap-2">
          <div><label className="text-xs">Year</label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24" /></div>
          <div><label className="text-xs">Month</label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-20" /></div>
          <Button variant="success" onClick={() => genMut.mutate()} disabled={genMut.isPending}>
            {genMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Generate
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Incentive entries</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Promoter</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.promoter_id.slice(0, 8)}</TableCell>
                    <TableCell>{r.period_year}-{String(r.period_month).padStart(2, "0")}</TableCell>
                    <TableCell className="text-right">₹{Number(r.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell><Badge>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs">{r.paid_reference ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {r.status === "pending" && (
                          <>
                            <Button size="sm" variant="success" onClick={() => updMut.mutate({ id: r.id, status: "approved" })}>Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => updMut.mutate({ id: r.id, status: "rejected" })}>Reject</Button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" variant="success" onClick={() => updMut.mutate({ id: r.id, status: "paid" })}>Mark Paid</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
