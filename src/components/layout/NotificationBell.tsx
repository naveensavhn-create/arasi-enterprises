import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Bell, Check, CheckCheck, Trophy, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import {
  listMyNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications.functions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function fmt(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

function iconFor(type: string) {
  if (type === "draw_winner" || type === "referred_customer_won") {
    return <Trophy className="h-4 w-4 text-primary" />;
  }
  return <Bell className="h-4 w-4 text-muted-foreground" />;
}

export function NotificationBell() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const qc = useQueryClient();

  const listFn = useServerFn(listMyNotifications);
  const countFn = useServerFn(getUnreadNotificationCount);
  const markReadFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);

  const countQ = useQuery({
    queryKey: ["notifications-unread", uid],
    enabled: !!uid,
    queryFn: () => countFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const listQ = useQuery({
    queryKey: ["notifications-list", uid],
    enabled: !!uid,
    queryFn: () => listFn(),
    staleTime: 15_000,
  });

  // Realtime: refresh on new notifications for this user
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`notifications:${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications-unread", uid] });
          qc.invalidateQueries({ queryKey: ["notifications-list", uid] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [uid, qc]);

  const markOne = useMutation({
    mutationFn: (id: string) => markReadFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread", uid] });
      qc.invalidateQueries({ queryKey: ["notifications-list", uid] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread", uid] });
      qc.invalidateQueries({ queryKey: ["notifications-list", uid] });
    },
  });

  const unread = countQ.data?.count ?? 0;
  const items = listQ.data ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bell className="h-4 w-4" /> Notifications
            {unread > 0 && <Badge variant="secondary">{unread} new</Badge>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
            className="h-7 gap-1 text-xs"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-[70vh]">
          {listQ.isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const unreadItem = !n.read_at;
                const content = (
                  <div className="flex gap-3 px-3 py-2.5">
                    <div className="mt-0.5 shrink-0">{iconFor(n.type)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className={cn("text-sm truncate", unreadItem && "font-semibold")}>
                          {n.title}
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {fmt(n.created_at)}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {n.body}
                        </p>
                      )}
                    </div>
                    {unreadItem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          markOne.mutate(n.id);
                        }}
                        className="ml-1 self-start rounded p-1 text-muted-foreground hover:bg-accent"
                        aria-label="Mark as read"
                        title="Mark as read"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "cursor-default transition-colors hover:bg-accent/40",
                      unreadItem && "bg-primary/5",
                    )}
                  >
                    {n.link ? (
                      <Link
                        to={n.link}
                        onClick={() => unreadItem && markOne.mutate(n.id)}
                        className="block"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
