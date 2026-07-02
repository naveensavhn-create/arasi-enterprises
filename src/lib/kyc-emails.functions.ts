import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KycEmailStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "dead_letter"
  | "skipped";

export type KycEmailNotification = {
  id: string;
  audit_id: string | null;
  target_user_id: string | null;
  recipient_email: string;
  decision: "approved" | "rejected";
  template_name: string;
  subject: string | null;
  status: KycEmailStatus;
  provider: string | null;
  message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  dead_letter_at: string | null;
  dead_letter_reason: string | null;
  reviewer_name: string | null;
  reviewer_email: string | null;
  review_notes: string | null;
  assigned_role: string | null;
  attempts_log: string;
  metadata: string;
  is_test: boolean;
  created_at: string;
  updated_at: string;
};

async function requireAdmin(context: {
  supabase: ReturnType<typeof Object>;
  userId: string;
}) {
  // context.supabase is the request-scoped client
  const supabase = context.supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
  };
  const { data } = await supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Forbidden");
}

export const listKycEmailNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        status: z
          .enum(["pending", "sending", "sent", "failed", "dead_letter", "skipped"])
          .optional(),
        decision: z.enum(["approved", "rejected"]).optional(),
        limit: z.number().int().min(1).max(200).optional().default(100),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<KycEmailNotification[]> => {
    await requireAdmin(context);
    let q = context.supabase
      .from("kyc_email_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    if (data.decision) q = q.eq("decision", data.decision);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as KycEmailNotification[];
  });

export const retryKycEmailNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { retryKycEmailJob } = await import("@/lib/email/send-kyc-decision.server");
    return retryKycEmailJob(data.id);
  });

export const processKycEmailQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).optional().default(25) }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { processDueKycEmailJobs } = await import(
      "@/lib/email/send-kyc-decision.server"
    );
    return processDueKycEmailJobs(data.limit);
  });
