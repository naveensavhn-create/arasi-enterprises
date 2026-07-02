import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trophy, Ticket, CalendarClock, Plus, Play, Ban, Trash2, Users, X, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DrawTimeBadge } from "@/components/draws/DrawTimeBadge";
import { DrawTimeline } from "@/components/draws/DrawTimeline";
import { formatDateTime } from "@/lib/format-datetime";
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
  pickDrawWinnersManual,
  setDrawStatus,
  setDrawMode,
} from "@/lib/draws.functions";
import { Checkbox } from "@/components/ui/checkbox";

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
  draw_at: string | null;
  drawn_at: string | null;
  winners_count: number;
  requires_active_membership: boolean;
  description: string | null;
  mode: "manual" | "automated";
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
  const setMode = useServerFn(setDrawMode);


  const { data: draws = [], isLoading } = useQuery({
    queryKey: ["admin", "draws"],
    queryFn: () => list() as Promise<Draw[]>,
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [selected, setSelected] = useState<Draw | null>(null);
  const [focusManual, setFocusManual] = useState(false);

  const createMut = useMutation({
    mutationFn: (input: {
      name: string;
      description?: string | null;
      prize: string;
      prizeValue?: number | null;
      winnersCount: number;
      requiresActiveMembership: boolean;
      opensAt?: string | null;
      closesAt?: string | null;
      drawAt?: string | null;
      mode: "manual" | "automated";
    }) => create({ data: input }),
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

  const modeMut = useMutation({
    mutationFn: (v: { id: string; mode: "manual" | "automated" }) => setMode({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(`Switched to ${v.mode} mode`);
      qc.invalidateQueries({ queryKey: ["admin", "draws"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const [statusFilter, setStatusFilter] = useState<Set<Draw["status"]>>(new Set());
  const [dateField, setDateField] = useState<"opens_at" | "closes_at" | "draw_at" | "drawn_at">("opens_at");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const openCount = draws.filter((d) => d.status === "open").length;
  const completedCount = draws.filter((d) => d.status === "completed").length;
  const upcoming = draws.find((d) => d.status === "scheduled" || d.status === "open");

  const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
  const toMs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
  const filtered = draws.filter((d) => {
    if (statusFilter.size > 0 && !statusFilter.has(d.status)) return false;
    if (fromMs !== null || toMs !== null) {
      const raw = d[dateField];
      if (!raw) return false;
      const ms = new Date(raw).getTime();
      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;
    }
    return true;
  });

  const toggleStatus = (s: Draw["status"]) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };
  const clearFilters = () => {
    setStatusFilter(new Set());
    setDateFrom("");
    setDateTo("");
    setDateField("opens_at");
  };
  const hasFilters = statusFilter.size > 0 || dateFrom || dateTo;
  const STATUSES: Draw["status"][] = ["scheduled", "open", "closed", "completed", "cancelled"];

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
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>All draws</CardTitle>
            <div className="text-xs text-muted-foreground">
              {filtered.length} of {draws.length}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => {
                  const active = statusFilter.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatus(s)}
                      aria-pressed={active}
                      className="focus:outline-none focus:ring-2 focus:ring-ring rounded-full"
                    >
                      <Badge
                        variant={active ? statusVariant[s] : "outline"}
                        className="cursor-pointer capitalize"
                      >
                        {s}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="f-field">Date field</Label>
              <select
                id="f-field"
                value={dateField}
                onChange={(e) => setDateField(e.target.value as typeof dateField)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="opens_at">Opens at</option>
                <option value="closes_at">Closes at</option>
                <option value="draw_at">Draw at</option>
                <option value="drawn_at">Drawn at</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="f-from">From</Label>
              <Input
                id="f-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-[10.5rem]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="f-to">To</Label>
              <Input
                id="f-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-[10.5rem]"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
                <X className="mr-1 h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : draws.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No draws yet. Click "New draw" to create one.
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No draws match the current filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prize</TableHead>
                  <TableHead>Winners</TableHead>
                  <TableHead>Opens</TableHead>
                  <TableHead>Closes</TableHead>
                  <TableHead>Draw at</TableHead>
                  <TableHead>Drawn at</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.prize}</TableCell>
                    <TableCell>{d.winners_count}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DrawTimeBadge kind="opens" iso={d.opens_at} showLabel={false} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DrawTimeBadge kind="closes" iso={d.closes_at} showLabel={false} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DrawTimeBadge
                        kind="draw"
                        iso={(d as unknown as { draw_at: string | null }).draw_at}
                        showLabel={false}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {d.status === "completed" ? (
                        <DrawTimeBadge kind="drawn" iso={d.drawn_at} showLabel={false} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[d.status]} className="capitalize">
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={d.mode === "automated"}
                          disabled={
                            d.status === "completed" ||
                            d.status === "cancelled" ||
                            (modeMut.isPending && modeMut.variables?.id === d.id)
                          }
                          onCheckedChange={(v) =>
                            modeMut.mutate({ id: d.id, mode: v ? "automated" : "manual" })
                          }
                          aria-label={`Toggle mode for ${d.name}`}
                        />
                        <span className="text-xs capitalize text-muted-foreground">{d.mode}</span>
                      </div>
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setFocusManual(false); setSelected(d); }}>
                        <Users className="mr-1 h-3.5 w-3.5" /> Entries
                      </Button>
                      {d.status !== "completed" && d.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setFocusManual(true); setSelected(d); }}
                          title="Open manual winner pick"
                        >
                          <Sparkles className="mr-1 h-3.5 w-3.5" /> Manual
                        </Button>
                      )}
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

      <DrawDetailDialog
        draw={selected}
        focusManual={focusManual}
        onClose={() => { setSelected(null); setFocusManual(false); }}
      />
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
    opensAt?: string | null;
    closesAt?: string | null;
    drawAt?: string | null;
    mode: "manual" | "automated";
  }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prize, setPrize] = useState("");
  const [prizeValue, setPrizeValue] = useState<string>("");
  const [winnersCount, setWinnersCount] = useState(1);
  const [requiresActive, setRequiresActive] = useState(true);
  const [opensAt, setOpensAt] = useState<string>("");
  const [closesAt, setClosesAt] = useState<string>("");
  const [drawAt, setDrawAt] = useState<string>("");
  const [mode, setMode] = useState<"manual" | "automated">("manual");

  const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Create a draw</DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
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

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-opens">Opens at</Label>
            <Input id="d-opens" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-closes">Closes at</Label>
            <Input id="d-closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-drawat">Draw date & time</Label>
          <Input id="d-drawat" type="datetime-local" value={drawAt} onChange={(e) => setDrawAt(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Shown to customers and promoters. For automated draws, winners are picked at this time.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="d-desc">Description</Label>
          <Textarea id="d-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Automated draw</div>
            <div className="text-xs text-muted-foreground">
              Randomly picks winners at the scheduled draw time. Turn off to pick winners manually.
            </div>
          </div>
          <Switch checked={mode === "automated"} onCheckedChange={(v) => setMode(v ? "automated" : "manual")} />
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
              opensAt: toIso(opensAt),
              closesAt: toIso(closesAt),
              drawAt: toIso(drawAt),
              mode,
            })
          }
        >
          {pending ? "Creating…" : "Create draw"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}


function DrawDetailDialog({ draw, onClose, focusManual = false }: { draw: Draw | null; onClose: () => void; focusManual?: boolean }) {
  const qc = useQueryClient();
  const entriesFn = useServerFn(listDrawEntries);
  const winnersFn = useServerFn(listDrawWinners);
  const pick = useServerFn(pickDrawWinners);
  const pickManual = useServerFn(pickDrawWinnersManual);

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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [countOverride, setCountOverride] = useState<string>("");

  const invalidateAfterPick = (rows: unknown) => {
    const count = Array.isArray(rows) ? rows.length : 0;
    toast.success(`Picked ${count} winner${count === 1 ? "" : "s"}`);
    qc.invalidateQueries({ queryKey: ["admin", "draws"] });
    qc.invalidateQueries({ queryKey: ["admin", "draw-detail", draw!.id, "winners"] });
    setSelectedIds(new Set());
    setCountOverride("");
  };

  const pickMut = useMutation({
    mutationFn: () => pick({ data: { drawId: draw!.id } }),
    onSuccess: invalidateAfterPick,
    onError: (e: Error) => toast.error(e.message),
  });

  const pickSelectedMut = useMutation({
    mutationFn: () =>
      pickManual({ data: { drawId: draw!.id, entryIds: Array.from(selectedIds) } }),
    onSuccess: invalidateAfterPick,
    onError: (e: Error) => toast.error(e.message),
  });

  const pickByCountMut = useMutation({
    mutationFn: () =>
      pickManual({ data: { drawId: draw!.id, count: Number(countOverride) } }),
    onSuccess: invalidateAfterPick,
    onError: (e: Error) => toast.error(e.message),
  });

  const canPick = !!draw && draw.status !== "completed" && draw.status !== "cancelled";
  const eligibleEntries = ((entries.data as any[]) ?? []).filter((e) => e.eligible);
  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const manualRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (draw && focusManual && manualRef.current) {
      const el = manualRef.current;
      const t = setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [draw, focusManual]);

  return (
    <Dialog open={!!draw} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{draw?.name}</DialogTitle>
        </DialogHeader>
        {draw && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm text-muted-foreground">
                Prize: <span className="font-medium text-foreground">{draw.prize}</span> · Winners:{" "}
                {draw.winners_count} · Status:{" "}
                <Badge variant={statusVariant[draw.status]} className="capitalize">
                  {draw.status}
                </Badge>
              </div>
            </div>
            <DrawTimeline
              opensAt={draw.opens_at}
              closesAt={draw.closes_at}
              drawAt={draw.draw_at}
              drawnAt={draw.drawn_at}
              showLabels
            />
            <div className="flex justify-end">
              {canPick && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="secondary" disabled={pickMut.isPending}>
                      <Play className="mr-1 h-3.5 w-3.5" />
                      {pickMut.isPending ? "Picking…" : `Random pick ${draw.winners_count}`}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Random pick for "{draw.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Randomly picks {draw.winners_count} winner
                        {draw.winners_count === 1 ? "" : "s"} from eligible entries and marks the
                        draw completed. Customers and promoters are notified in real time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => pickMut.mutate()}>
                        Pick winners
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {canPick && (
              <Card ref={manualRef} className={`border-dashed ${focusManual ? "ring-2 ring-primary/50" : ""}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Manual pick</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Random count</Label>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-24"
                      value={countOverride}
                      onChange={(e) => setCountOverride(e.target.value)}
                      placeholder={String(draw.winners_count)}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !countOverride ||
                            Number(countOverride) < 1 ||
                            pickByCountMut.isPending
                          }
                        >
                          Pick N randomly
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Pick {countOverride} winners?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Randomly selects {countOverride} eligible entries and marks the draw
                            completed. Winners are broadcast to customers and promoters.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => pickByCountMut.mutate()}>
                            Pick
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Or tick specific eligible entries below and click "Award selected".
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={selectedIds.size === 0 || pickSelectedMut.isPending}
                      >
                        <Trophy className="mr-1 h-3.5 w-3.5" />
                        Award selected ({selectedIds.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Award {selectedIds.size} selected entries?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The chosen entries become winners in the order shown, and the draw is
                          marked completed. Customers and promoters are notified in real time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => pickSelectedMut.mutate()}>
                          Award winners
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            )}

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
                        <TableCell>{formatDateTime(w.drawn_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">
                Entries ({(entries.data ?? []).length}) · Eligible: {eligibleEntries.length}
              </div>
              {(entries.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No entries yet.</div>
              ) : (
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {canPick && <TableHead className="w-10"></TableHead>}
                        <TableHead>#</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Eligible</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(entries.data as any[]).map((e) => (
                        <TableRow key={e.id}>
                          {canPick && (
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(e.id)}
                                disabled={!e.eligible}
                                onCheckedChange={() => toggle(e.id)}
                              />
                            </TableCell>
                          )}
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

