import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy, Search, Users, CalendarClock, Download, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { listAllDrawWinners, type DrawResultRow } from "@/lib/draws.functions";

export const Route = createFileRoute("/_authenticated/admin/draw-results")({
  head: () => ({
    meta: [
      { title: "Draw Results — Admin" },
      { name: "description", content: "Every lucky-draw winner with prize, timestamp, and draw context." },
    ],
  }),
  component: DrawResultsPage,
});

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadWinnersCsv(rows: DrawResultRow[]) {
  const headers = [
    "draw_name", "draw_status", "position", "prize", "drawn_at",
    "customer_name", "customer_email", "customer_phone", "customer_id",
    "entry_id", "draw_id",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.draw_name, r.draw_status, r.position, r.prize, r.drawn_at,
      r.customer_name ?? "", r.customer_email ?? "", r.customer_phone ?? "", r.customer_id,
      r.entry_id, r.draw_id,
    ].map(csvEscape).join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `draw-winners-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DrawResultsPage() {
  const fn = useServerFn(listAllDrawWinners);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin", "draw-results"],
    queryFn: () => fn() as Promise<DrawResultRow[]>,
  });

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [drawFilter, setDrawFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounce search input so keystrokes don't re-filter thousands of rows synchronously.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [q]);

  // Precompute a lowercased haystack per row once — avoids re-lowercasing on every keystroke.
  const indexed = useMemo(
    () =>
      data.map((r) => ({
        row: r,
        haystack: [
          r.customer_name,
          r.customer_email,
          r.customer_phone,
          r.draw_name,
          r.prize,
          r.customer_id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [data],
  );

  // Group rows by draw_id so the per-draw filter is an O(1) map lookup instead of
  // a full-table scan. Also gives us the sorted (draw_id, name) list for the <select>.
  const byDraw = useMemo(() => {
    const groups = new Map<string, typeof indexed>();
    for (const item of indexed) {
      const list = groups.get(item.row.draw_id);
      if (list) list.push(item);
      else groups.set(item.row.draw_id, [item]);
    }
    return groups;
  }, [indexed]);

  const draws = useMemo(
    () =>
      Array.from(byDraw, ([id, list]) => ({ id, name: list[0].row.draw_name })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [byDraw],
  );

  const filtered = useMemo(() => {
    const source = drawFilter ? byDraw.get(drawFilter) ?? [] : indexed;
    if (!debouncedQ) return source.map((i) => i.row);
    const out: DrawResultRow[] = [];
    for (const item of source) {
      if (item.haystack.includes(debouncedQ)) out.push(item.row);
    }
    return out;
  }, [indexed, byDraw, drawFilter, debouncedQ]);

  // Reset to first page whenever the filter set changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, drawFilter, pageSize]);

  const totalWinners = data.length;
  const drawsCount = draws.length;
  const latest = data[0];

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageStart + pageSize),
    [filtered, pageStart, pageSize],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Draw Results</h1>
          <p className="text-sm text-muted-foreground">
            Every recorded winner across all draws — sorted by most recent. Each customer can win a
            given draw at most once (enforced by the database).
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/lucky-draw">
            <Plus className="mr-2 h-4 w-4" /> New draw
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Total winners
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{totalWinners}</CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" /> Draws completed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{drawsCount}</CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Latest draw
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {latest ? (
              <div>
                <div className="font-medium">{latest.draw_name}</div>
                <div className="text-muted-foreground">{fmt(latest.drawn_at)}</div>
              </div>
            ) : (
              <span className="text-muted-foreground">No draws completed yet.</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>Winners</CardTitle>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, email, prize…"
                className="pl-8 md:w-72"
              />
            </div>
            <select
              className="rounded-md border bg-background px-2 py-2 text-sm"
              value={drawFilter}
              onChange={(e) => setDrawFilter(e.target.value)}
            >
              <option value="">All draws</option>
              {draws.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (filtered.length === 0) {
                  toast.error("Nothing to export");
                  return;
                }
                downloadWinnersCsv(filtered);
                toast.success(`Exported ${filtered.length} winner${filtered.length === 1 ? "" : "s"}`);
              }}
              disabled={isLoading || filtered.length === 0}
            >
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="text-sm text-destructive">{(error as Error).message}</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {data.length === 0
                ? "No winners have been drawn yet."
                : "No winners match the current filters."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">#</TableHead>
                    <TableHead>Draw</TableHead>
                    <TableHead>Winner</TableHead>
                    <TableHead>Prize</TableHead>
                    <TableHead>Drawn at</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant="secondary">#{r.position}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.draw_name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{r.draw_status}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {r.customer_name || <span className="text-muted-foreground">Unnamed</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.customer_email || r.customer_phone || r.customer_id}
                        </div>
                      </TableCell>
                      <TableCell>{r.prize}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmt(r.drawn_at)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {r.entry_id.slice(0, 8)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  Showing {filtered.length === 0 ? 0 : pageStart + 1}–
                  {Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
                  {filtered.length !== totalWinners ? ` (filtered from ${totalWinners})` : ""}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor="page-size">
                    Rows
                  </label>
                  <select
                    id="page-size"
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    {[25, 50, 100, 200].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    Page {safePage} / {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
