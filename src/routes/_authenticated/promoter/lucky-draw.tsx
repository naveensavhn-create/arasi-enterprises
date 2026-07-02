import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Crown, Loader2, Sparkles, Trophy } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { listDrawsForPromoter } from "@/lib/draws.functions";
import { useDrawRealtime } from "@/hooks/use-draw-realtime";
import { DrawTimeBadge } from "@/components/draws/DrawTimeBadge";
import { DrawTimeline } from "@/components/draws/DrawTimeline";
import { formatDateTime } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/promoter/lucky-draw")({
  head: () => ({
    meta: [
      { title: "Lucky Draw — Promoter" },
      { name: "description", content: "Upcoming Arasi lucky draws and announced winners." },
    ],
  }),
  component: PromoterLuckyDrawPage,
});

type DrawRow = {
  id: string;
  name: string;
  description: string | null;
  prize: string;
  prize_value: number | null;
  status: "scheduled" | "open" | "closed" | "completed" | "cancelled";
  mode: "manual" | "automated";
  opens_at: string | null;
  closes_at: string | null;
  draw_at: string | null;
  drawn_at: string | null;
  winners_count: number;
  requires_active_membership: boolean;
  winners: Array<{ position: number; name: string; prize: string; drawn_at: string }>;
};

function fmt(iso: string | null | undefined) {
  return formatDateTime(iso);
}

function statusVariant(status: DrawRow["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "open") return "default";
  if (status === "completed") return "outline";
  if (status === "cancelled") return "destructive";
  return "secondary";
}

function PromoterLuckyDrawPage() {
  const listFn = useServerFn(listDrawsForPromoter);
  const q = useQuery({
    queryKey: ["promoter", "draws"],
    queryFn: () => listFn() as Promise<DrawRow[]>,
  });

  useDrawRealtime({
    queryKeys: [["promoter", "draws"]],
  });



  const draws = q.data ?? [];
  const upcoming = draws.filter((d) => d.status === "scheduled" || d.status === "open");
  const completed = draws.filter((d) => d.status === "completed");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lucky Draw</h1>
        <p className="text-sm text-muted-foreground">
          Upcoming Arasi draws and announced winners. Share these with your customers.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="h-4 w-4 text-primary" /> Upcoming draws
        </h2>
        {q.isLoading ? (
          <div className="flex items-center py-6 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : upcoming.length === 0 ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">No draws scheduled yet.</CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {upcoming.map((d) => (
              <Card key={d.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{d.name}</CardTitle>
                    <div className="flex gap-1">
                      <Badge variant={statusVariant(d.status)} className="capitalize">{d.status}</Badge>
                      <Badge variant="outline" className="capitalize">
                        <Sparkles className="mr-1 h-3 w-3" /> {d.mode}
                      </Badge>
                    </div>
                  </div>
                  {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="flex items-center gap-2 font-medium">
                      <Trophy className="h-4 w-4 text-primary" /> {d.prize}
                    </div>
                    {d.prize_value != null && (
                      <div className="text-xs text-muted-foreground">
                        Value: ₹{Number(d.prize_value).toLocaleString("en-IN")}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.winners_count} winner{d.winners_count > 1 ? "s" : ""}
                      {d.requires_active_membership ? " · Active membership required" : ""}
                    </div>
                  </div>
                  <DrawTimeline
                    opensAt={d.opens_at}
                    closesAt={d.closes_at}
                    drawAt={d.draw_at}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Crown className="h-4 w-4 text-primary" /> Announced winners
        </h2>
        {completed.length === 0 ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">No winners announced yet.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {completed.map((d) => (
              <Card key={d.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{d.name}</CardTitle>
                    <DrawTimeline
                      opensAt={d.opens_at}
                      closesAt={d.closes_at}
                      drawAt={d.draw_at}
                      drawnAt={d.drawn_at}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {d.winners.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No eligible entries — no winners.</div>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.winners.map((w) => (
                        <li key={w.position} className="flex items-center justify-between rounded-md border bg-primary/5 p-2">
                          <span className="font-medium">#{w.position} · {w.name}</span>
                          <span className="text-xs text-muted-foreground">{w.prize}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
