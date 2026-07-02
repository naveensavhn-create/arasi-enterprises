import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to realtime updates on `draws` and `draw_winners` and invalidates
 * the provided query keys so the UI immediately reflects "winner announced"
 * moments (draw flipping to `completed`, winners inserted).
 */
export function useDrawRealtime(opts: {
  queryKeys: Array<readonly unknown[]>;
  enabled?: boolean;
  toastOnComplete?: boolean;
}) {
  const { queryKeys, enabled = true, toastOnComplete = true } = opts;
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const invalidate = () => {
      for (const key of queryKeys) {
        qc.invalidateQueries({ queryKey: key });
      }
    };

    const channel = supabase
      .channel("draws-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "draws" },
        (payload) => {
          const oldStatus = (payload.old as { status?: string } | null)?.status;
          const newStatus = (payload.new as { status?: string } | null)?.status;
          const name = (payload.new as { name?: string } | null)?.name;
          if (toastOnComplete && oldStatus !== "completed" && newStatus === "completed") {
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
          if (toastOnComplete && status !== "completed") {
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
          if (toastOnComplete) {
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, qc]);
}
