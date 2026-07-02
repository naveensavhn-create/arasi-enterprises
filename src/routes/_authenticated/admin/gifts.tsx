import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listGiftsAdmin, updateGiftStatus } from "@/lib/commissions.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/gifts")({
  head: () => ({ meta: [{ title: "Rank Gifts — Admin" }] }),
  component: Page,
});

type Gift = {
  id: string;
  promoter_id: string;
  gift_name: string;
  status: "eligible" | "approved" | "dispatched" | "delivered" | "completed" | "rejected";
  courier_name: string | null;
  tracking_number: string | null;
  serial_number: string | null;
  delivery_proof_url: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  remarks: string | null;
};

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listGiftsAdmin);
  const upd = useServerFn(updateGiftStatus);
  const { data, isLoading } = useQuery({ queryKey: ["admin-gifts"], queryFn: () => list() });
  const [editing, setEditing] = useState<Gift | null>(null);
  const [status, setStatus] = useState<Gift["status"]>("approved");

  const updMut = useMutation({
    mutationFn: (v: Parameters<typeof upd>[0]["data"]) => upd({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-gifts"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Rank Gifts</h1>
        <p className="text-sm text-muted-foreground">Approve, dispatch, and track rank-based gifts.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Gift deliveries</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Promoter</TableHead>
                  <TableHead>Gift</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Serial</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {((data as Gift[]) ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.promoter_id.slice(0, 8)}</TableCell>
                    <TableCell>{r.gift_name}</TableCell>
                    <TableCell><Badge>{r.status}</Badge></TableCell>
                    <TableCell>{r.courier_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.tracking_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.serial_number ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.delivered_at ? new Date(r.delivered_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Dialog open={editing?.id === r.id} onOpenChange={(o) => !o && setEditing(null)}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" onClick={() => { setEditing(r); setStatus(r.status); }}>Manage</Button>
                        </DialogTrigger>
                        {editing?.id === r.id && (
                          <GiftDialog gift={editing} status={status} setStatus={setStatus} onSave={(v) => updMut.mutate({ id: r.id, ...v })} saving={updMut.isPending} />
                        )}
                      </Dialog>
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

function GiftDialog({
  gift,
  status,
  setStatus,
  onSave,
  saving,
}: {
  gift: Gift;
  status: Gift["status"];
  setStatus: (s: Gift["status"]) => void;
  onSave: (v: {
    status: Gift["status"];
    courier?: string;
    tracking?: string;
    serial?: string;
    proof_url?: string;
    remarks?: string;
  }) => void;
  saving: boolean;
}) {
  const [courier, setCourier] = useState(gift.courier_name ?? "");
  const [tracking, setTracking] = useState(gift.tracking_number ?? "");
  const [serial, setSerial] = useState(gift.serial_number ?? "");
  const [proof, setProof] = useState(gift.delivery_proof_url ?? "");
  const [remarks, setRemarks] = useState(gift.remarks ?? "");
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Manage: {gift.gift_name}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as Gift["status"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["eligible", "approved", "dispatched", "delivered", "completed", "rejected"] as const).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Courier</Label><Input value={courier} onChange={(e) => setCourier(e.target.value)} /></div>
          <div><Label>Tracking #</Label><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Serial #</Label><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
          <div><Label>Proof URL</Label><Input value={proof} onChange={(e) => setProof(e.target.value)} /></div>
        </div>
        <div><Label>Remarks</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button
          variant="success"
          disabled={saving}
          onClick={() => onSave({ status, courier: courier || undefined, tracking: tracking || undefined, serial: serial || undefined, proof_url: proof || undefined, remarks: remarks || undefined })}
        >
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
