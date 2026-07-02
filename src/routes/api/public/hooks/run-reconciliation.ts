import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/run-reconciliation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("x-api-key") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!anon || provided !== anon) {
          return new Response("Unauthorized", { status: 401 });
        }

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
