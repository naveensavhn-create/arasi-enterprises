import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const startSchema = z.object({
  target_user_id: z.string().uuid(),
  mode: z.enum(["read_only", "full_access"]).default("read_only"),
  reason: z.string().max(500).optional().nullable(),
});

export type ImpersonationSession = {
  id: string;
  admin_id: string;
  target_user_id: string;
  target_role: string;
  mode: string;
  reason: string | null;
  session_token: string;
  ip_address: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
};

export type ActiveImpersonation = {
  id: string;
  target_user_id: string;
  target_role: string;
  mode: string;
  reason: string | null;
  started_at: string;
  target_full_name: string;
  target_email: string | null;
  target_customer_display_id: number | null;
  target_promoter_display_id: string | null;
  target_membership_number: string | null;
};

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => startSchema.parse(d))
  .handler(async ({ data, context }): Promise<ImpersonationSession> => {
    const ip =
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ||
      getRequestHeader("cf-connecting-ip") ||
      undefined;
    const ua = getRequestHeader("user-agent") || undefined;
    const { data: row, error } = await context.supabase.rpc("start_impersonation", {
      _target_user_id: data.target_user_id,
      _mode: data.mode,
      _reason: data.reason ?? undefined,
      _ip: ip,
      _user_agent: ua,
    });
    if (error) throw new Error(error.message);
    return row as unknown as ImpersonationSession;
  });

export const endImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ImpersonationSession | null> => {
    const { data, error } = await context.supabase.rpc("end_impersonation");
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as ImpersonationSession | null;
  });

export const getActiveImpersonation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ActiveImpersonation | null> => {
    const { data, error } = await context.supabase.rpc("get_active_impersonation");
    if (error) throw new Error(error.message);
    const rows = data as unknown as ActiveImpersonation[] | null;
    return rows && rows.length ? rows[0] : null;
  });

export const listImpersonationHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_impersonation_history", {
      _limit: data.limit,
      _offset: data.offset,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as Array<{
      id: string;
      admin_id: string;
      admin_email: string | null;
      target_user_id: string;
      target_email: string | null;
      target_role: string;
      mode: string;
      reason: string | null;
      ip_address: string | null;
      user_agent: string | null;
      started_at: string;
      ended_at: string | null;
    }>;
  });

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

export type AdminUserSnapshot = {
  profile: JsonValue | null;
  role: string | null;
  customer_display_id: number | null;
  promoter_display_id: string | null;
  promoter_referral_code: string | null;
  memberships: JsonValue[];
  installments: JsonValue[];
  payments: JsonValue[];
  receipts: JsonValue[];
  rewards: JsonValue[];
  draw_entries: JsonValue[];
  draw_wins: JsonValue[];
  notifications: JsonValue[];
  referred_by: JsonValue | null;
  referrals: JsonValue[];
  commissions: JsonValue[];
  rank_state: JsonValue | null;
  auth: JsonValue | null;
};

export const getAdminUserSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AdminUserSnapshot | null> => {
    const { data: snap, error } = await context.supabase.rpc("admin_user_snapshot", {
      _user_id: data.user_id,
    });
    if (error) throw new Error(error.message);
    return (snap ?? null) as unknown as AdminUserSnapshot | null;
  });
