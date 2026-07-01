import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const prefsSchema = z
  .object({
    sidebarMode: z.enum(["expanded", "collapsed"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    paymentsPollingMs: z.union([
      z.literal(0),
      z.literal(30_000),
      z.literal(60_000),
      z.literal(120_000),
    ]).optional(),
  })
  .strict();

export const getMyUiPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_ui_prefs")
      .select("prefs, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      prefs: (data?.prefs ?? {}) as z.infer<typeof prefsSchema>,
      updatedAt: data?.updated_at ?? null,
    };
  });

export const saveMyUiPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => prefsSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Merge with existing so partial patches don't wipe other keys.
    const { data: existing, error: readErr } = await context.supabase
      .from("user_ui_prefs")
      .select("prefs")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const merged = { ...((existing?.prefs ?? {}) as Record<string, unknown>), ...data };

    const { error } = await context.supabase
      .from("user_ui_prefs")
      .upsert({ user_id: context.userId, prefs: merged }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { prefs: merged };
  });
