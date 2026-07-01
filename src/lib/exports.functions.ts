import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  coercePaymentStatus,
  type PaymentStatus,
} from "@/lib/payments/status-filter";

const SORT_COLUMNS = [
  "created_at",
  "paid_at",
  "amount",
  "status",
  "provider_order_id",
  "provider_payment_id",
  "customer_name",
] as const;

const DATE_FIELDS = ["created", "webhook_processed"] as const;

export const exportFiltersSchema = z
  .object({
    sortBy: z.enum(SORT_COLUMNS).default("created_at"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
    // Untrusted status input funneled through `coercePaymentStatus` so
    // ONLY valid `payment_status` enum members reach `applyPaymentStatusEq`
    // in `buildExportRows`. "", "all", unknown values → undefined (no-op).
    status: z
      .unknown()
      .transform((v): PaymentStatus | undefined => coercePaymentStatus(v) ?? undefined),
    from: z.string().optional(),
    to: z.string().optional(),
    dateField: z.enum(DATE_FIELDS).default("created"),
    q: z.string().optional(),
    orderId: z.string().optional(),
    paymentId: z.string().optional(),
    customer: z.string().optional(),
  })
  .strip();

export type ExportFilters = z.infer<typeof exportFiltersSchema>;

export type ExportJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export type ExportJob = {
  id: string;
  requested_by: string;
  kind: string;
  status: ExportJobStatus;
  filters: ExportFilters;
  row_count: number | null;
  byte_size: number | null;
  storage_path: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  notified_at: string | null;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/** Enqueue a new async export. */
export const createExportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ filters: exportFiltersSchema }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ jobId: string }> => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("export_jobs")
      .insert({
        requested_by: context.userId,
        kind: "payments_csv",
        status: "queued",
        filters: data.filters,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { jobId: row.id as string };
  });

/** List the calling admin's own export jobs. */
export const listMyExportJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(100).default(50) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ExportJob[]> => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("export_jobs")
      .select("*")
      .eq("requested_by", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ExportJob[];
  });

/** Signed URL for the file behind a succeeded job. */
export const getExportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid() }).parse(d),
  )
  .handler(
    async ({ data, context }): Promise<{ url: string; filename: string }> => {
      await assertAdmin(context);
      const { data: job, error } = await context.supabase
        .from("export_jobs")
        .select("id, requested_by, status, storage_path, expires_at, filters")
        .eq("id", data.jobId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!job) throw new Error("Export job not found");
      if (job.requested_by !== context.userId) throw new Error("Forbidden");
      if (job.status !== "succeeded" || !job.storage_path) {
        throw new Error("Export file is not ready");
      }
      if (job.expires_at && new Date(job.expires_at).getTime() < Date.now()) {
        throw new Error("Export file has expired — re-run the export");
      }
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `payments-export-${stamp}-${job.id.slice(0, 8)}.csv`;
      const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from("payment-exports")
        .createSignedUrl(job.storage_path, 300, { download: filename });
      if (sErr) throw new Error(sErr.message);
      return { url: signed.signedUrl, filename };
    },
  );

/** Re-queue a failed or expired job (uses the original filters snapshot). */
export const retryExportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ jobId: string }> => {
    await assertAdmin(context);
    const { data: job, error } = await context.supabase
      .from("export_jobs")
      .select("id, requested_by, filters")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Export job not found");
    if (job.requested_by !== context.userId) throw new Error("Forbidden");
    const { data: row, error: iErr } = await context.supabase
      .from("export_jobs")
      .insert({
        requested_by: context.userId,
        kind: "payments_csv",
        status: "queued",
        filters: job.filters,
      })
      .select("id")
      .single();
    if (iErr) throw new Error(iErr.message);
    return { jobId: row.id as string };
  });

/** Mark a job as notified so the header bell doesn't re-toast it. */
export const markExportJobNotified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobIds: z.array(z.string().uuid()).min(1).max(50) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ updated: number }> => {
    await assertAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("export_jobs")
      .update({ notified_at: new Date().toISOString() })
      .in("id", data.jobIds)
      .eq("requested_by", context.userId)
      .is("notified_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return { updated: (rows ?? []).length };
  });

/** Cancel a queued job (running/finished jobs can't be cancelled). */
export const cancelExportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("export_jobs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", data.jobId)
      .eq("requested_by", context.userId)
      .eq("status", "queued");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
