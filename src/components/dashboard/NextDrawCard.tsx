import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarClock, Gift, Sparkles, Trophy, ArrowRight, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type DrawRow = {
  id: string;
  name: string;
  prize: string | null;
  prize_value: number | null;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  draw_at: string | null;
  drawn_at: string | null;
  mode: string | null;
};

const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function useCountdown(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return "Now";
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

export function NextDrawCard({ ctaTo }: { ctaTo: "/customer/lucky-draw" | "/promoter/lucky-draw" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "next-draw"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data: upcoming } = await supabase
        .from("draws")
        .select("id,name,prize,prize_value,status,opens_at,closes_at,draw_at,drawn_at,mode")
        .in("status", ["scheduled", "open"])
        .or(`draw_at.gte.${nowIso},closes_at.gte.${nowIso}`)
        .order("draw_at", { ascending: true, nullsFirst: false })
        .limit(1);
      const next = (upcoming?.[0] ?? null) as DrawRow | null;

      const { data: recent } = await supabase
        .from("draws")
        .select("id,name,prize,prize_value,status,opens_at,closes_at,draw_at,drawn_at,mode")
        .eq("status", "completed")
        .order("drawn_at", { ascending: false, nullsFirst: false })
        .limit(1);
      return { next, latest: (recent?.[0] ?? null) as DrawRow | null };
    },
    refetchInterval: 60_000,
  });

  const next = data?.next ?? null;
  const latest = data?.latest ?? null;
  const countdown = useCountdown(next?.draw_at ?? next?.closes_at ?? null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (!next && !latest) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="h-4 w-4 text-primary" /> Lucky draw
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            No draws scheduled right now. Check back soon.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Lucky draw</p>
              <h3 className="text-base font-semibold leading-tight">
                {next ? next.name : latest?.name}
              </h3>
            </div>
          </div>
          {next ? (
            <Badge variant={next.status === "open" ? "default" : "secondary"} className="capitalize">
              {next.status}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Trophy className="h-3 w-3" /> Completed
            </Badge>
          )}
        </div>

        {next ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3 w-3" /> Draw at
              </div>
              <p className="mt-1 text-sm font-medium">{fmt(next.draw_at)}</p>
              {countdown && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  <Clock className="h-3 w-3" /> {countdown}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Gift className="h-3 w-3" /> Prize
              </div>
              <p className="mt-1 text-sm font-medium">{next.prize || "Surprise reward"}</p>
              <p className="text-xs text-muted-foreground">
                Entries close {fmt(next.closes_at)}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Latest winner announced</p>
            <p className="mt-1 text-sm font-medium">
              {latest?.prize || "Surprise reward"} · drawn {fmt(latest?.drawn_at ?? null)}
            </p>
          </div>
        )}

        <div className="mt-4">
          <Button asChild size="sm" variant="secondary" className="gap-1">
            <Link to={ctaTo}>
              {next ? "View & enter draw" : "See results"} <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
