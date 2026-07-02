import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const startSchema = z.object({
  target_user_id: z.string().uuid(),
  mode: z.enum(["read_only", "full_access"]).default("read_only"),
  reason: z.string().max(500).optional().nullable(),
});

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => startSchema.parse(d))
  .handler(async ({ data, context }) => {
    const ip =
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ||
      getRequestHeader("cf-connecting-ip") ||
      null;
    const ua = getRequestHeader("user-agent") || null;
    const { data: row, error } = await context.supabase.rpc("start_impersonation", {
      _target_user_id: data.target_user_id,
      _mode: data.mode,
      _reason: data.reason ?? null,
      _ip: ip,
      _user_agent: ua,
    });
    if (error) throw new Error(error.message);
    return row;
  });

export const endImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("end_impersonation");
    if (error) throw new Error(error.message);
    return data;
  });

export const getActiveImpersonation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_active_impersonation");
    if (error) throw new Error(error.message);
    return Array.isArray(data) && data.length ? data[0] : null;
  });

export const listImpersonationHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_impersonation_history", {
      _limit: data.limit,
      _offset: data.offset,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getAdminUserSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: snap, error } = await context.supabase.rpc("admin_user_snapshot", {
      _user_id: data.user_id,
    });
    if (error) throw new Error(error.message);
    return snap as Record<string, unknown> | null;
  });
