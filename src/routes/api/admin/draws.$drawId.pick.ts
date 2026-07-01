/**
 * POST /api/admin/draws/:drawId/pick
 *
 * Admin-only HTTP endpoint that picks winners for a draw in a single
 * database transaction and is safe to retry (idempotent) — repeat calls
 * for the same draw return the existing winners instead of re-drawing.
 *
 * Auth model
 *   1. Requires a Supabase bearer token in the `Authorization` header.
 *   2. The underlying `public.pick_draw_winners` RPC re-checks
 *      `has_role(admin)` server-side. Non-admin JWTs receive 403.
 *
 * Duplicate-selection prevention
 *   - `SELECT … FOR UPDATE` on the draw row serializes concurrent callers.
 *   - Status guard: after the row lock, an already-`completed` draw
 *     short-circuits and returns the recorded winners.
 *   - Storage layer: `draw_winners_draw_customer_unique` and
 *     `draw_winners_draw_id_position_key` reject duplicate rows even under
 *     unexpected races.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const bodySchema = z
  .object({ seed: z.string().min(1).max(200).optional().nullable() })
  .partial()
  .default({});

const paramsSchema = z.object({ drawId: z.string().uuid() });

function jsonError(status: number, error: string, message: string, details?: unknown) {
  return Response.json(
    { ok: false, error, message, ...(details ? { details } : {}) },
    { status },
  );
}

export const Route = createFileRoute("/api/admin/draws/$drawId/pick")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const parsedParams = paramsSchema.safeParse(params);
        if (!parsedParams.success) {
          return jsonError(400, "INVALID_INPUT", "Invalid draw id", {
            issues: parsedParams.error.issues,
          });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const bearer = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length).trim()
          : "";
        if (!bearer) {
          return jsonError(401, "UNAUTHENTICATED", "Missing bearer token");
        }

        let body: unknown = {};
        const raw = await request.text();
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            return jsonError(400, "INVALID_INPUT", "Body must be JSON");
          }
        }
        const parsedBody = bodySchema.safeParse(body);
        if (!parsedBody.success) {
          return jsonError(400, "INVALID_INPUT", "Invalid body", {
            issues: parsedBody.error.issues,
          });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !publishableKey) {
          return jsonError(500, "SERVER_MISCONFIGURED", "Supabase env not set");
        }

        // Act as the caller: RLS and the RPC's has_role(admin) check run
        // against this identity. No service-role client is used here.
        const supabase = createClient<Database>(supabaseUrl, publishableKey, {
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
          global: { headers: { Authorization: `Bearer ${bearer}` } },
        });

        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData?.user) {
          return jsonError(401, "UNAUTHENTICATED", "Invalid or expired token");
        }
        const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "admin",
        });
        if (roleErr) {
          return jsonError(500, "ROLE_CHECK_FAILED", roleErr.message);
        }
        if (!isAdmin) {
          return jsonError(403, "FORBIDDEN", "Admin role required");
        }

        // Single transactional RPC — winner selection, status update, and
        // audit-safe seed capture all commit atomically. Idempotent on retry.
        const { data: winners, error } = await supabase.rpc("pick_draw_winners", {
          _draw_id: parsedParams.data.drawId,
          _seed: parsedBody.data.seed ?? undefined,
        });
        if (error) {
          const code = (error as { code?: string }).code;
          if (code === "42501") return jsonError(403, "FORBIDDEN", error.message);
          if (/not found/i.test(error.message))
            return jsonError(404, "DRAW_NOT_FOUND", error.message);
          if (/cancelled/i.test(error.message))
            return jsonError(409, "DRAW_CANCELLED", error.message);
          return jsonError(500, "PICK_FAILED", error.message);
        }

        return Response.json({ ok: true, winners: winners ?? [] });
      },
    },
  },
});
