import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "promoter" | "customer";

/**
 * Server-authoritative role lookup for the currently authenticated user.
 * Uses the `current_user_role` SECURITY DEFINER function, so RLS on
 * user_roles cannot mask a role from its own owner.
 */
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppRole | null> => {
    const { data, error } = await context.supabase.rpc("current_user_role");
    if (error) throw new Error(error.message);
    return (data as AppRole | null) ?? null;
  });
