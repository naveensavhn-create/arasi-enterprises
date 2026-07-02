import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { createDrawEntry, listOpenDrawsForCustomer, getLatestCompletedDrawForCustomer } from "@/lib/draws.functions";
import { useDrawRealtime } from "@/hooks/use-draw-realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DrawTimeBadge } from "@/components/draws/DrawTimeBadge";
import { DrawTimeline } from "@/components/draws/DrawTimeline";
import { formatDateTime } from "@/lib/format-datetime";
import {
  Ticket,
  Trophy,
  CalendarClock,
  Loader2,
  Gift,
  CheckCircle2,
  AlertCircle,
  Crown,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customer/lucky-draw")({
  head: () => ({
    meta: [
      { title: "Lucky Draw — Arasi" },
      { name: "description", content: "Join active Arasi lucky draws and track your entries and wins." },
    ],
  }),
  component: CustomerLuckyDrawPage,
});

function fmtDate(iso: string | null | undefined) {
  return formatDateTime(iso);
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "open") return "default";
  if (status === "completed") return "outline";
  return "secondary";
}

function CustomerLuckyDrawPage() {
  const { session } = useSession();
  const qc = useQueryClient();

  const listDrawsFn = useServerFn(listOpenDrawsForCustomer);
  const createDrawEntryFn = useServerFn(createDrawEntry);
  const latestCompletedFn = useServerFn(getLatestCompletedDrawForCustomer);

  const drawsQ = useQuery({
    queryKey: ["customer-open-draws", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: () => listDrawsFn(),
  });

  const latestCompletedQ = useQuery({
    queryKey: ["customer-latest-completed-draw", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: () => latestCompletedFn(),
    staleTime: 30_000,
  });

  const realtime = useDrawRealtime({
    enabled: !!session?.user.id,
    queryKeys: [
      ["customer-open-draws", session?.user.id],
      ["customer-draw-results", session?.user.id],
      ["customer-latest-completed-draw", session?.user.id],
    ],
  });


  // Monthly on-time payment eligibility (kept from prior version)
  const eligQ = useQuery({
    queryKey: ["my-draw-eligibility", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      const { data, error } = await supabase
        .from("installments")
        .select("status, due_date, memberships!inner(user_id)")
        .eq("memberships.user_id", session!.user.id)
        .gte("due_date", monthStart)
        .lt("due_date", monthEnd);
      if (error) throw error;
      const monthly = data ?? [];
      const dueThisMonth = monthly.length;
      const paidThisMonth = monthly.filter((i) => i.status === "paid").length;
      return {
        eligible: dueThisMonth > 0 && paidThisMonth === dueThisMonth,
        dueThisMonth,
        paidThisMonth,
      };
    },
  });

  function friendlyEntryError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? "");
    const m = raw.toLowerCase();
    if (m.includes("already entered")) return "You've already joined this draw.";
    if (m.includes("not found")) return "This draw is no longer available.";
    if (m.includes("not allowed") || m.includes("permission")) {
      return "You're not eligible to enter this draw.";
    }
    if (m.includes("active membership")) return "An active membership is required to enter.";
    if (m.includes("closed") || m.includes("window")) return "Entries for this draw are closed.";
    if (m.includes("not open") || m.includes("opens")) return "This draw isn't open yet.";
    if (m.includes("plan")) return "Your membership plan isn't eligible for this draw.";
    return raw || "Could not join the draw. Please try again.";
  }

  const enterMut = useMutation({
    mutationFn: (drawId: string) => createDrawEntryFn({ data: { drawId } }),
    onSuccess: async (row) => {
      const entryNo = (row as { entry_number: number | null }).entry_number;
      const createdAt = (row as { created_at: string | null }).created_at;
      toast.success(
        entryNo != null ? `You're in! Entry #${entryNo}` : "You're in!",
        { description: createdAt ? `Joined ${fmtDate(createdAt)}` : undefined },
      );
      await qc.invalidateQueries({ queryKey: ["customer-open-draws"] });
    },
    onError: (err) => toast.error(friendlyEntryError(err)),
  });

  const draws = drawsQ.data ?? [];
  const wins = draws.filter((d) => d.myWin);
  const entries = draws.filter((d) => d.myEntry);

  const liveDot =
    realtime.status === "connected"
      ? "bg-green-500"
      : realtime.status === "connecting" || realtime.status === "reconnecting"
        ? "bg-amber-500 animate-pulse"
        : realtime.status === "error" || realtime.status === "closed"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  const liveLabel =
    realtime.status === "connected"
      ? "Live"
      : realtime.status === "connecting"
        ? "Connecting…"
        : realtime.status === "reconnecting"
          ? "Reconnecting…"
          : realtime.status === "error"
            ? "Offline — auto-refreshing"
            : realtime.status === "closed"
              ? "Disconnected"
              : "Idle";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lucky Draw</h1>
          <p className="text-sm text-muted-foreground">
            Join open draws and track your entries and wins.
          </p>
        </div>
        <div
          className="flex items-center gap-2 rounded-full border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          title={realtime.error?.message ?? liveLabel}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${liveDot}`} />
          <span>{liveLabel}</span>
        </div>
      </div>


      {/* Monthly eligibility summary */}
      <Card className="glass">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-4 w-4 text-primary" /> Monthly on-time status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {eligQ.isLoading || !eligQ.data ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking your installments…
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={eligQ.data.eligible ? "default" : "secondary"}>
                {eligQ.data.eligible ? "On track this month" : "Keep paying on time"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {eligQ.data.paidThisMonth} / {eligQ.data.dueThisMonth} installments paid this month
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Pay every installment on time to stay eligible for month-end draws.
          </p>
        </CardContent>
      </Card>

      {/* Persistent "Winners announced" banner for the latest completed draw */}
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
                      <span className="truncate font-medium">
                        {w.isMe ? "You" : w.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{w.prize}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* Wins */}

      {wins.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Crown className="h-4 w-4 text-primary" /> You won!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {wins.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-primary/5 p-3">
                <div>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Position #{d.myWin!.position} · Prize: {d.myWin!.prize}
                  </div>
                </div>
                <Badge variant="default">Winner · {fmtDate(d.myWin!.drawn_at)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Draws list */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Available draws</h2>
        {drawsQ.isLoading ? (
          <div className="flex items-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading draws…
          </div>
        ) : drawsQ.error ? (
          <Card><CardContent className="py-6 text-sm text-destructive">
            {drawsQ.error instanceof Error ? drawsQ.error.message : "Failed to load draws"}
          </CardContent></Card>
        ) : draws.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            <Gift className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            No draws are available right now. Check back soon.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {draws.map((d) => {
              const entry = d.myEntry;
              const win = d.myWin;
              const now = Date.now();
              const closed =
                d.status === "closed" ||
                d.status === "completed" ||
                d.status === "cancelled" ||
                (d.closes_at ? new Date(d.closes_at).getTime() < now : false);
              const notYetOpen = d.opens_at ? new Date(d.opens_at).getTime() > now : false;
              const canJoin = !entry && !closed && !notYetOpen && (d.status === "open" || d.status === "scheduled");
              return (
                <Card key={d.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{d.name}</CardTitle>
                      <Badge variant={statusVariant(d.status)} className="capitalize">
                        {d.status}
                      </Badge>
                    </div>
                    {d.description && (
                      <p className="text-xs text-muted-foreground">{d.description}</p>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
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
                      drawAt={(d as unknown as { draw_at: string | null }).draw_at}
                      drawnAt={
                        d.status === "completed"
                          ? (d as unknown as { drawn_at: string | null }).drawn_at
                          : null
                      }
                    />


                    <Separator />

                    {win ? (
                      <div className="flex items-center gap-2 rounded-md bg-primary/10 p-2 text-sm">
                        <Crown className="h-4 w-4 text-primary" />
                        <span className="font-medium">You won position #{win.position}</span>
                      </div>
                    ) : entry ? (
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          {entry.eligible ? (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <span>Entered · <span className="font-mono">#{entry.entry_number}</span></span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-4 w-4 text-destructive" />
                              <span>Disqualified</span>
                            </>
                          )}
                        </div>
                        {(entry.entry_code || entry.coupon_code) && (
                          <div className="grid gap-1 rounded-md border bg-muted/30 p-2 text-xs">
                            {entry.entry_code && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Entry ID</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(entry.entry_code!);
                                    toast.success("Entry ID copied");
                                  }}
                                  className="font-mono font-medium tracking-tight hover:text-primary"
                                >
                                  {entry.entry_code}
                                </button>
                              </div>
                            )}
                            {entry.coupon_code && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Coupon</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(entry.coupon_code!);
                                    toast.success("Coupon code copied");
                                  }}
                                  className="font-mono font-semibold tracking-wider text-primary hover:underline"
                                >
                                  {entry.coupon_code}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {!entry.eligible && entry.disqualified_reason && (
                          <p className="text-xs text-muted-foreground">
                            Reason: {entry.disqualified_reason}
                          </p>
                        )}
                        {d.status === "completed" && entry.eligible && !win && (
                          <p className="text-xs text-muted-foreground">
                            Draw completed. Better luck next time!
                          </p>
                        )}
                      </div>

                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {closed
                            ? "Entries closed"
                            : notYetOpen
                              ? "Opens soon"
                              : "You haven't entered yet"}
                        </span>
                        <Button
                          size="sm"
                          disabled={!canJoin || enterMut.isPending}
                          onClick={() => enterMut.mutate(d.id)}
                        >
                          {enterMut.isPending && enterMut.variables === d.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Join draw"
                          )}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Entries summary */}
      {entries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-primary" /> My entries
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {entries.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Entry <span className="font-mono">#{d.myEntry!.entry_number}</span> · {fmtDate(d.myEntry!.created_at)}
                  </div>
                  {(d.myEntry!.entry_code || d.myEntry!.coupon_code) && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {d.myEntry!.entry_code && (
                        <span>ID: <span className="font-mono text-foreground">{d.myEntry!.entry_code}</span></span>
                      )}
                      {d.myEntry!.coupon_code && (
                        <span>Coupon: <span className="font-mono font-semibold text-primary">{d.myEntry!.coupon_code}</span></span>
                      )}
                    </div>
                  )}
                </div>
                <Badge variant={d.myEntry!.eligible ? "secondary" : "destructive"}>
                  {d.myEntry!.eligible ? "Eligible" : "Disqualified"}
                </Badge>
              </div>
            ))}

          </CardContent>
        </Card>
      )}
    </div>
  );
}
