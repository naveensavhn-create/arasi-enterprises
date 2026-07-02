import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listIncentivesAdmin,
  generateRankIncentives,
  updateIncentiveStatus,
} from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/incentives")({
  head: () => ({ meta: [{ title: "Rank Incentives — Admin" }] }),
  component: Page,
});

type IncentiveRow = {
  id: string;
  promoter_id: string;
  rank_id: string;
  amount: number;
  status: string;
  paid_reference: string | null;
  created_at: string;
};

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listIncentivesAdmin);
  const gen = useServerFn(generateRankIncentives);
  const upd = useServerFn(updateIncentiveStatus);
  const { data, isLoading } = useQuery({ queryKey: ["admin-incentives"], queryFn: () => list() });

  const genMut = useMutation({
    mutationFn: () => gen(),
    onSuccess: (res: { generated: number }) => {
      toast.success(
        res.generated > 0
          ? `Awarded ${res.generated} one-time rank incentive${res.generated === 1 ? "" : "s"}`
          : "No new rank incentives to award — everyone is up to date.",
      );
      qc.invalidateQueries({ queryKey: ["admin-incentives"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updMut = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "paid" | "rejected"; reference?: string }) => upd({ data: v }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["admin-incentives"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (data ?? []) as IncentiveRow[];

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rank Incentives</h1>
          <p className="text-sm text-muted-foreground">
            Each promoter earns their rank incentive one time, when they reach that rank. Use “Award missing”
            to backfill any promoter who is already at a rank but hasn’t received the entry yet.
          </p>
        </div>
        <Button variant="success" onClick={() => genMut.mutate()} disabled={genMut.isPending}>
          {genMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Award missing
        </Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Incentive entries</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No one-time rank incentives have been awarded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Promoter</TableHead>
                  <TableHead>Awarded on</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.promoter_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString()}</TableCell>
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
