import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/lib/auth";
import { listOpenDrawsForCustomer, getLatestCompletedDrawForCustomer } from "@/lib/draws.functions";
import { useDrawRealtime } from "@/hooks/use-draw-realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Trophy, CalendarClock, Ticket, Loader2, Gift, Crown, Frown } from "lucide-react";
import { DrawTimeBadge } from "@/components/draws/DrawTimeBadge";
import { DrawTimeline } from "@/components/draws/DrawTimeline";
import { formatDateTime } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/customer/draw-results")({
  head: () => ({
    meta: [
      { title: "My Draw Results — Arasi" },
      {
        name: "description",
        content:
          "See your lucky-draw results: winner status, entry position, prize, and drawn-at timestamp for every completed Arasi draw.",
      },
    ],
  }),
  component: CustomerDrawResultsPage,
});

function fmt(iso: string | null | undefined) {
  return formatDateTime(iso);
}

function CustomerDrawResultsPage() {
  const { session } = useSession();
  const listFn = useServerFn(listOpenDrawsForCustomer);
  const latestCompletedFn = useServerFn(getLatestCompletedDrawForCustomer);

  const q = useQuery({
    queryKey: ["customer-draw-results", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: () => listFn(),
  });

  const latestCompletedQ = useQuery({
    queryKey: ["customer-latest-completed-draw", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: () => latestCompletedFn(),
    staleTime: 30_000,
  });

  useDrawRealtime({
    enabled: !!session?.user.id,
    queryKeys: [
      ["customer-draw-results", session?.user.id],
      ["customer-open-draws", session?.user.id],
      ["customer-latest-completed-draw", session?.user.id],
    ],
  });


  const allDraws = q.data ?? [];
  const results = allDraws
    .filter((d) => d.status === "completed" && (d.myEntry || d.myWin))
    .sort((a, b) => {
      const at = new Date(a.drawn_at ?? 0).getTime();
      const bt = new Date(b.drawn_at ?? 0).getTime();
      return bt - at;
    });

  const wins = results.filter((d) => d.myWin);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" />
            My Draw Results
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Winner status, your entry position, prize, and drawn-at timestamp for every completed draw you entered.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/customer/lucky-draw">
            <Ticket className="h-4 w-4 mr-2" />
            Browse open draws
          </Link>
        </Button>
      </div>

      {latestCompletedQ.data && (
        <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Winners announced!
              <Badge variant="outline" className="ml-1 font-normal">
                {latestCompletedQ.data.draw.name}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <DrawTimeBadge kind="drawn" iso={latestCompletedQ.data.draw.drawn_at} />
              <span>Prize: {latestCompletedQ.data.draw.prize}</span>
            </div>
            {latestCompletedQ.data.myWin && (
              <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 p-2 text-sm">
                <Crown className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  Congratulations! You won position #{latestCompletedQ.data.myWin.position}
                </span>
              </div>
            )}
            {latestCompletedQ.data.winners.length === 0 ? (
              <p className="text-xs text-muted-foreground">No winners recorded for this draw.</p>
            ) : (
              <ol className="space-y-1.5">
                {latestCompletedQ.data.winners.map((w) => (
                  <li
                    key={`${w.position}-${w.name}`}
                    className={
                      "flex items-center justify-between gap-2 rounded-md border p-2 text-sm " +
                      (w.isMe ? "border-primary/40 bg-primary/5" : "bg-muted/20")
                    }
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={w.isMe ? "default" : "secondary"} className="shrink-0">
                        #{w.position}
                      </Badge>
                      <span className="truncate font-medium">{w.isMe ? "You" : w.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{w.prize}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed draws entered</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{results.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Wins</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold flex items-center gap-2">
            {wins.length}
            {wins.length > 0 && <Crown className="h-5 w-5 text-primary" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Latest result</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {results[0] ? fmt(results[0].drawn_at) : "No completed draws yet"}
          </CardContent>
        </Card>
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your results…
        </div>
      )}
      {q.isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load your draw results. Please refresh in a moment.
          </CardContent>
        </Card>
      )}

      {!q.isLoading && results.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Gift className="h-10 w-10 text-muted-foreground mx-auto" />
            <div className="text-base font-medium">No completed draw results yet</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Once a draw you've entered is drawn by our team, your entry position and winner status will appear here.
            </p>
            <Button asChild size="sm">
              <Link to="/customer/lucky-draw">Join a lucky draw</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {results.map((d) => {
          const won = !!d.myWin;
          const entryNo = d.myEntry?.entry_number ?? null;
          return (
            <Card key={d.id} className={won ? "border-primary/60" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {won ? <Crown className="h-5 w-5 text-primary" /> : <Frown className="h-5 w-5 text-muted-foreground" />}
                      {d.name}
                    </CardTitle>
                    {d.description && (
                      <p className="text-sm text-muted-foreground mt-1">{d.description}</p>
                    )}
                  </div>
                  <Badge variant={won ? "default" : "secondary"}>
                    {won ? "Winner" : "Not selected"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <DrawTimeline
                  opensAt={(d as unknown as { opens_at: string | null }).opens_at}
                  closesAt={(d as unknown as { closes_at: string | null }).closes_at}
                  drawAt={(d as unknown as { draw_at: string | null }).draw_at}
                  drawnAt={d.drawn_at ?? d.myWin?.drawn_at ?? null}
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Prize</div>
                    <div className="font-medium mt-0.5">{d.prize}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Your entry #</div>
                    <div className="font-medium mt-0.5">
                      {entryNo != null ? `#${entryNo}` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {won ? "Winning position" : "Position"}
                    </div>
                    <div className="font-medium mt-0.5">
                      {won ? `#${d.myWin!.position}` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" /> Drawn at
                    </div>
                    <div className="mt-0.5">
                      <DrawTimeBadge
                        kind="drawn"
                        iso={d.drawn_at ?? d.myWin?.drawn_at ?? null}
                        showLabel={false}
                      />
                    </div>
                  </div>
                </div>
                {won && (
                  <>
                    <Separator />
                    <div className="text-sm text-primary flex items-center gap-2">
                      <Trophy className="h-4 w-4" />
                      Congratulations! Our team will contact you about prize fulfillment.
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
