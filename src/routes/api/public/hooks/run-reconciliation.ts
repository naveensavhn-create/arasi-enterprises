import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/run-reconciliation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest } = await import("@/lib/cron-auth.server");
        const denied = await verifyCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const startedAt = Date.now();
        const { data, error } = await supabaseAdmin.rpc("run_reconciliation");
        if (error) {
          console.error("run-reconciliation cron failed", error);
          return new Response(
            JSON.stringify({ ok: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        const summary = {
          ok: true,
          result: data,
          durationMs: Date.now() - startedAt,
          finishedAt: new Date().toISOString(),
        };
        console.log("run-reconciliation cron finished", summary);
        return new Response(JSON.stringify(summary), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
