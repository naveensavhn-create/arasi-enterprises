import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trophy, Ticket, CalendarClock, Plus, Play, Ban, Trash2, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  createDraw,
  deleteDraw,
  listDrawEntries,
  listDrawWinners,
  listDraws,
  pickDrawWinners,
  setDrawStatus,
} from "@/lib/draws.functions";

export const Route = createFileRoute("/_authenticated/admin/lucky-draw")({
  head: () => ({ meta: [{ title: "Lucky Draw — Admin" }] }),
  component: AdminLuckyDrawPage,
});

type Draw = {
  id: string;
  name: string;
  prize: string;
  prize_value: number | null;
  status: "scheduled" | "open" | "closed" | "completed" | "cancelled";
  opens_at: string | null;
  closes_at: string | null;
  drawn_at: string | null;
  winners_count: number;
  requires_active_membership: boolean;
  description: string | null;
};

const statusVariant: Record<Draw["status"], "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "secondary",
  open: "default",
  closed: "outline",
  completed: "default",
  cancelled: "destructive",
};

function AdminLuckyDrawPage() {
  const qc = useQueryClient();
  const list = useServerFn(listDraws);
  const create = useServerFn(createDraw);
  const setStatus = useServerFn(setDrawStatus);
  const remove = useServerFn(deleteDraw);
  const pick = useServerFn(pickDrawWinners);

  const { data: draws = [], isLoading } = useQuery({
    queryKey: ["admin", "draws"],
    queryFn: () => list() as Promise<Draw[]>,
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<Draw | null>(null);

  const createMut = useMutation({
    mutationFn: (input: Parameters<typeof create>[0]["data"]) => create({ data: input }),
    onSuccess: () => {
      toast.success("Draw created");
      setOpenCreate(false);
      qc.invalidateQueries({ queryKey: ["admin", "draws"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: Draw["status"] }) => setStatus({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "draws"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Draw removed");
      qc.invalidateQueries({ queryKey: ["admin", "draws"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pickMut = useMutation({
    mutationFn: (id: string) => pick({ data: { drawId: id } }),
    onSuccess: (rows: unknown[]) => {
      toast.success(`Picked ${rows.length} winner${rows.length === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["admin", "draws"] });
      qc.invalidateQueries({ queryKey: ["admin", "draw-detail"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCount = draws.filter((d) => d.status === "open").length;
  const completedCount = draws.filter((d) => d.status === "completed").length;
  const upcoming = draws.find((d) => d.status === "scheduled" || d.status === "open");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lucky Draw</h1>
          <p className="text-sm text-muted-foreground">
            Create draws, review entries, and pick winners at random from eligible customers.
          </p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New draw
            </Button>
          </DialogTrigger>
          <CreateDrawDialog onSubmit={(v) => createMut.mutate(v)} pending={createMut.isPending} />
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Next draw
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {upcoming ? (
              <div>
                <div className="font-medium">{upcoming.name}</div>
                <div className="text-muted-foreground">Prize: {upcoming.prize}</div>
              </div>
            ) : (
              <span className="text-muted-foreground">No draws scheduled.</span>
            )}
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-primary" /> Open now
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{openCount}</CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Completed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{completedCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All draws</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : draws.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No draws yet. Click "New draw" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prize</TableHead>
                  <TableHead>Winners</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draws.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.prize}</TableCell>
                    <TableCell>{d.winners_count}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[d.status]} className="capitalize">
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelected(d)}>
                        <Users className="mr-1 h-3.5 w-3.5" /> Entries
                      </Button>
                      {d.status !== "completed" && d.status !== "cancelled" && (
                        <>
                          {d.status === "scheduled" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => statusMut.mutate({ id: d.id, status: "open" })}
                            >
                              Open
                            </Button>
                          )}
                          {d.status === "open" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => statusMut.mutate({ id: d.id, status: "closed" })}
                            >
                              Close
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm">
                                <Play className="mr-1 h-3.5 w-3.5" /> Pick winners
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Pick winners now?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will randomly select {d.winners_count} winner
                                  {d.winners_count === 1 ? "" : "s"} from eligible entries
                                  and mark the draw as completed.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => pickMut.mutate(d.id)}>
                                  Pick winners
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => statusMut.mutate({ id: d.id, status: "cancelled" })}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete draw?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the draw, its entries, and winners.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeMut.mutate(d.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DrawDetailDialog draw={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CreateDrawDialog({
  onSubmit,
  pending,
}: {
  onSubmit: (v: {
    name: string;
    description?: string | null;
    prize: string;
    prizeValue?: number | null;
    winnersCount: number;
    requiresActiveMembership: boolean;
  }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prize, setPrize] = useState("");
  const [prizeValue, setPrizeValue] = useState<string>("");
  const [winnersCount, setWinnersCount] = useState(1);
  const [requiresActive, setRequiresActive] = useState(true);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create a draw</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="d-name">Name</Label>
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-prize">Prize</Label>
          <Input id="d-prize" value={prize} onChange={(e) => setPrize(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-val">Prize value (₹)</Label>
            <Input
              id="d-val"
              type="number"
              min="0"
              value={prizeValue}
              onChange={(e) => setPrizeValue(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-count">Winners</Label>
            <Input
              id="d-count"
              type="number"
              min="1"
              value={winnersCount}
              onChange={(e) => setWinnersCount(Number(e.target.value) || 1)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-desc">Description</Label>
          <Textarea
            id="d-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Require active membership</div>
            <div className="text-xs text-muted-foreground">
              Only customers with an active membership can win.
            </div>
          </div>
          <Switch checked={requiresActive} onCheckedChange={setRequiresActive} />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={pending || !name || !prize}
          onClick={() =>
            onSubmit({
              name,
              description: description || null,
              prize,
              prizeValue: prizeValue ? Number(prizeValue) : null,
              winnersCount,
              requiresActiveMembership: requiresActive,
            })
          }
        >
          {pending ? "Creating…" : "Create draw"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DrawDetailDialog({ draw, onClose }: { draw: Draw | null; onClose: () => void }) {
  const entriesFn = useServerFn(listDrawEntries);
  const winnersFn = useServerFn(listDrawWinners);

  const entries = useQuery({
    queryKey: ["admin", "draw-detail", draw?.id, "entries"],
    queryFn: () => entriesFn({ data: { drawId: draw!.id } }),
    enabled: !!draw,
  });
  const winners = useQuery({
    queryKey: ["admin", "draw-detail", draw?.id, "winners"],
    queryFn: () => winnersFn({ data: { drawId: draw!.id } }),
    enabled: !!draw,
  });

  return (
    <Dialog open={!!draw} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draw?.name}</DialogTitle>
        </DialogHeader>
        {draw && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Prize: <span className="font-medium text-foreground">{draw.prize}</span> · Winners:{" "}
              {draw.winners_count} · Status:{" "}
              <Badge variant={statusVariant[draw.status]} className="capitalize">
                {draw.status}
              </Badge>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Winners</div>
              {(winners.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">Not drawn yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Drawn at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(winners.data as any[]).map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>{w.position}</TableCell>
                        <TableCell className="font-mono text-xs">{w.customer_id}</TableCell>
                        <TableCell>{new Date(w.drawn_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">
                Entries ({(entries.data ?? []).length})
              </div>
              {(entries.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No entries yet.</div>
              ) : (
                <div className="max-h-64 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Eligible</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(entries.data as any[]).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>{e.entry_number}</TableCell>
                          <TableCell className="font-mono text-xs">{e.customer_id}</TableCell>
                          <TableCell>
                            {e.eligible ? (
                              <Badge variant="default">Yes</Badge>
                            ) : (
                              <Badge variant="destructive">No</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
