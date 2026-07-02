import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { endImpersonation } from "@/lib/impersonation.functions";
import { useActiveImpersonation } from "./ImpersonationBanner";

/**
 * Hard cap on how long a single impersonation session may remain active
 * on the client. Matches the server-side expectation that view-as is a
 * short, purposeful action — after this window the client force-ends the
 * session so a stale banner cannot linger indefinitely.
 */
const MAX_SESSION_MS = 30 * 60 * 1000; // 30 minutes
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const IMPERSONATION_QUERY_KEY = ["impersonation", "active"] as const;

/**
 * Client-side session guard that keeps the impersonation banner in sync
 * with real session state. It:
 *  - clears the cached active session immediately on Supabase sign-out
 *    so the banner and FAB vanish without a stale render;
 *  - re-checks the server session on tab focus / visibility change and
 *    on a low-frequency interval to detect server-side termination;
 *  - enforces a client-side maximum session lifetime and force-ends
 *    stale sessions with a user-visible toast.
 *
 * Mounted once inside the authenticated shell. Renders nothing.
 */
export function ImpersonationSessionGuard() {
  const { data } = useActiveImpersonation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const endFn = useServerFn(endImpersonation);
  const prevDataRef = useRef(data);
  const endingRef = useRef(false);

  // 1. Sign-out → drop cached impersonation state immediately.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        qc.setQueryData(IMPERSONATION_QUERY_KEY, null);
        qc.removeQueries({ queryKey: ["impersonation"] });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  // 2. Refetch on focus / visibility and on interval, so the banner
  //    reflects server-side termination without waiting for a nav.
  useEffect(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: IMPERSONATION_QUERY_KEY });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    window.addEventListener("focus", invalidate);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(invalidate, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", invalidate);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [qc]);

  // 3. Detect server-side termination (was active, now null) and notify.
  useEffect(() => {
    const prev = prevDataRef.current;
    if (prev && !data) {
      toast.message("Impersonation session ended", {
        description: "Returned to your admin account.",
      });
    }
    prevDataRef.current = data;
  }, [data]);

  // 4. Enforce max session lifetime. If exceeded, force-end and clear.
  useEffect(() => {
    if (!data?.started_at) return;
    const started = new Date(data.started_at).getTime();
    if (Number.isNaN(started)) return;
    const remaining = started + MAX_SESSION_MS - Date.now();

    const expire = async () => {
      if (endingRef.current) return;
      endingRef.current = true;
      try {
        await endFn();
      } catch {
        /* server may already have ended it — proceed to clear locally */
      }
      qc.setQueryData(IMPERSONATION_QUERY_KEY, null);
      qc.invalidateQueries({ queryKey: ["impersonation"] });
      toast.warning("Impersonation session expired", {
        description: "For security, view-as sessions are limited to 30 minutes.",
      });
      navigate({ to: "/admin" });
      endingRef.current = false;
    };

    if (remaining <= 0) {
      void expire();
      return;
    }
    const timer = window.setTimeout(() => void expire(), remaining);
    return () => window.clearTimeout(timer);
  }, [data?.id, data?.started_at, endFn, qc, navigate]);

  return null;
}
