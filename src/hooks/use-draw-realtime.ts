import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "closed"
  | "failed";

/**
 * Subscribes to realtime updates on `draws` and `draw_winners` and invalidates
 * the provided query keys so the UI immediately reflects "winner announced"
 * moments (draw flipping to `completed`, winners inserted).
 *
 * Hardened for websocket drops:
 *   - Tracks connection status (`status`) and last error (`error`).
 *   - Falls back to periodic polling via query invalidation while
 *     disconnected so the UI still reflects fresh data.
 *   - Retries `.subscribe()` with capped exponential backoff.
 *   - Re-subscribes on `online` and tab-visible events.
 *   - Invalidates queries on (re)connect so any events missed while offline
 *     are picked up.
 */
export function useDrawRealtime(opts: {
  queryKeys: Array<readonly unknown[]>;
  enabled?: boolean;
  toastOnComplete?: boolean;
  /** Poll interval (ms) used only while disconnected. Default 20s. */
  fallbackPollMs?: number;
  /** Max backoff between resubscribe attempts (ms). Default 30s. */
  maxBackoffMs?: number;
  /** Max consecutive failed attempts before entering `failed` state. Default 6. */
  maxAttempts?: number;
}) {
  const {
    queryKeys,
    enabled = true,
    toastOnComplete = true,
    fallbackPollMs = 20_000,
    maxBackoffMs = 30_000,
    maxAttempts = 6,
  } = opts;
  const qc = useQueryClient();

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  // Keep latest keys/flags in refs so we don't tear down on every render.
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;
  const toastRef = useRef(toastOnComplete);
  toastRef.current = toastOnComplete;
  const droppedToastShownRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let attempt = 0;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const invalidate = () => {
      for (const key of keysRef.current) {
        qc.invalidateQueries({ queryKey: key });
      }
    };

    const clearBackoff = () => {
      if (backoffTimer) {
        clearTimeout(backoffTimer);
        backoffTimer = null;
      }
    };
    const clearPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const startPolling = () => {
      if (pollTimer || fallbackPollMs <= 0) return;
      pollTimer = setInterval(invalidate, fallbackPollMs);
    };

    const teardownChannel = async () => {
      if (channel) {
        try {
          await supabase.removeChannel(channel);
        } catch {
          /* ignore */
        }
        channel = null;
      }
    };

    const failedToastShownRef = { current: false };

    const scheduleReconnect = () => {
      clearBackoff();
      if (cancelled) return;
      if (attempt >= maxAttempts) {
        setStatus("failed");
        startPolling();
        if (toastRef.current && !failedToastShownRef.current) {
          failedToastShownRef.current = true;
          toast.error("Live updates unavailable", {
            description:
              "We couldn't restore the realtime connection after several attempts. Tap Retry connection to try again.",
            duration: 10_000,
          });
        }
        return;
      }
      const delay = Math.min(1000 * 2 ** attempt, maxBackoffMs);
      attempt += 1;
      backoffTimer = setTimeout(() => {
        if (!cancelled) void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      await teardownChannel();
      setStatus(attempt === 0 ? "connecting" : "reconnecting");

      // Unique channel name per attempt avoids collisions if a stale
      // reference lingers on the client.
      const name = `draws-realtime-${Math.random().toString(36).slice(2, 10)}`;
      channel = supabase
        .channel(name)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "draws" },
          (payload) => {
            const oldStatus = (payload.old as { status?: string } | null)?.status;
            const newStatus = (payload.new as { status?: string } | null)?.status;
            const name = (payload.new as { name?: string } | null)?.name;
            if (toastRef.current && oldStatus !== "completed" && newStatus === "completed") {
              toast.success("Winners announced!", {
                description: name ? `${name} — results are in.` : "A draw just completed.",
              });
            }
            invalidate();
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "draws" },
          (payload) => {
            const name = (payload.new as { name?: string } | null)?.name;
            const status = (payload.new as { status?: string } | null)?.status;
            if (toastRef.current && status !== "completed") {
              toast("New lucky draw available", {
                description: name ? `${name} is now live. Check it out!` : "A new draw was just created.",
              });
            }
            invalidate();
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "draw_winners" },
          (payload) => {
            if (toastRef.current) {
              const pos = (payload.new as { position?: number } | null)?.position;
              toast.success("Winner announced!", {
                description: pos ? `Position #${pos} has been drawn.` : "A winner was just picked.",
              });
            }
            invalidate();
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "draw_winners" },
          () => invalidate(),
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "draw_winners" },
          () => invalidate(),
        )
        .subscribe((subStatus, err) => {
          if (cancelled) return;
          if (subStatus === "SUBSCRIBED") {
            attempt = 0;
            droppedToastShownRef.current = false;
            failedToastShownRef.current = false;
            setError(null);
            setStatus("connected");
            clearPolling();
            // Backfill anything we may have missed while disconnected.
            invalidate();
          } else if (
            subStatus === "CHANNEL_ERROR" ||
            subStatus === "TIMED_OUT" ||
            subStatus === "CLOSED"
          ) {
            const wasConnected = status === "connected";
            setError(err ? (err instanceof Error ? err : new Error(String(err))) : null);
            setStatus(subStatus === "CLOSED" ? "closed" : "error");
            startPolling();
            if (toastRef.current && wasConnected && !droppedToastShownRef.current) {
              droppedToastShownRef.current = true;
              toast.warning("Live updates disconnected", {
                description: "Reconnecting… your data will keep refreshing in the background.",
              });
            }
            scheduleReconnect();
          }
        });
    };

    const handleOnline = () => {
      attempt = 0;
      clearBackoff();
      void connect();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && status !== "connected") {
        attempt = 0;
        clearBackoff();
        void connect();
      }
    };

    void connect();
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearBackoff();
      clearPolling();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
      void teardownChannel();
      setStatus("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, qc, fallbackPollMs, maxBackoffMs, reconnectNonce]);

  const reconnect = () => {
    setError(null);
    setStatus("connecting");
    setReconnectNonce((n) => n + 1);
  };

  return { status, error, isConnected: status === "connected", reconnect };
}
