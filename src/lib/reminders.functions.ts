import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SupabaseClientType = SupabaseClient<Database>;

export interface DueInstallmentRow {
  installment_id: string;
  membership_id: string;
  sequence: number;
  due_date: string;
  amount: number;
  status: string;
  customer_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  membership_number: string | null;
  member_display_id: string | null;
}

async function assertAdmin(context: { supabase: SupabaseClientType; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required.");
}

/**
 * Lists installments that are still owed (pending or overdue), joined with
 * the customer's profile so the admin can preview recipients before sending.
 */
export const listDueInstallmentsForReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DueInstallmentRow[]> => {
    await assertAdmin(context);

    const { data, error } = await context.supabase
      .from("installments")
      .select(
        `id, membership_id, sequence, due_date, amount, status,
         memberships!inner (
           membership_number, member_display_id, user_id,
           profiles:user_id ( full_name, email, phone )
         )`,
      )
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(500);

    if (error) throw new Error(error.message);

    type Row = {
      id: string;
      membership_id: string;
      sequence: number;
      due_date: string;
      amount: number | string;
      status: string;
      memberships: {
        membership_number: string | null;
        member_display_id: string | null;
        user_id: string;
        profiles: {
          full_name: string | null;
          email: string | null;
          phone: string | null;
        } | null;
      };
    };

    return ((data ?? []) as unknown as Row[]).map((r) => ({
      installment_id: r.id,
      membership_id: r.membership_id,
      sequence: r.sequence,
      due_date: r.due_date,
      amount: Number(r.amount),
      status: r.status,
      customer_id: r.memberships.user_id,
      customer_name: r.memberships.profiles?.full_name ?? null,
      customer_email: r.memberships.profiles?.email ?? null,
      customer_phone: r.memberships.profiles?.phone ?? null,
      membership_number: r.memberships.membership_number,
      member_display_id: r.memberships.member_display_id,
    }));
  });

const enqueueSchema = z
  .object({
    installmentIds: z.array(z.string().uuid()).min(1).max(500),
    channel: z.enum(["email", "sms"]).default("email"),
    reminderKind: z.string().trim().min(1).max(40).default("manual"),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine(
    (v) => !v.scheduledAt || new Date(v.scheduledAt).getTime() > Date.now() - 60_000,
    { message: "scheduledAt must be in the future", path: ["scheduledAt"] },
  );

export interface EnqueueReminderResult {
  requested: number;
  created: number;
  skipped_existing: number;
  skipped_missing_contact: number;
  scheduled_at: string;
}

/**
 * Queues reminder jobs for the selected installments. `scheduledAt` omitted =>
 * send now (scheduled at the current timestamp so the worker picks it up on
 * its next tick).
 */
export const enqueueInstallmentReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => enqueueSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnqueueReminderResult> => {
    await assertAdmin(context);

    const scheduledAtIso = data.scheduledAt ?? new Date().toISOString();

    // Pull recipient details for each installment via the same join used above.
    const { data: rows, error: fetchErr } = await context.supabase
      .from("installments")
      .select(
        `id, membership_id, status,
         memberships!inner (
           user_id,
           profiles:user_id ( email, phone )
         )`,
      )
      .in("id", data.installmentIds)
      .in("status", ["pending", "overdue"]);

    if (fetchErr) throw new Error(fetchErr.message);

    type R = {
      id: string;
      membership_id: string;
      memberships: {
        user_id: string;
        profiles: { email: string | null; phone: string | null } | null;
      };
    };
    const eligible = ((rows ?? []) as unknown as R[]).filter((r) => {
      const p = r.memberships.profiles;
      if (data.channel === "email") return !!p?.email;
      return !!p?.phone;
    });

    const missingContact = (rows?.length ?? 0) - eligible.length;

    if (eligible.length === 0) {
      return {
        requested: data.installmentIds.length,
        created: 0,
        skipped_existing: 0,
        skipped_missing_contact: missingContact + (data.installmentIds.length - (rows?.length ?? 0)),
        scheduled_at: scheduledAtIso,
      };
    }

    const payload = eligible.map((r) => ({
      installment_id: r.id,
      membership_id: r.membership_id,
      recipient_id: r.memberships.user_id,
      recipient_email: r.memberships.profiles?.email ?? null,
      recipient_phone: r.memberships.profiles?.phone ?? null,
      channel: data.channel,
      reminder_kind: data.reminderKind,
      status: "pending" as const,
      scheduled_at: scheduledAtIso,
      metadata: { queued_by: context.userId, queued_at: new Date().toISOString() },
    }));

    // ON CONFLICT (installment_id, channel, reminder_kind) DO NOTHING via upsert.
    const { data: inserted, error: insertErr } = await context.supabase
      .from("payment_reminder_jobs")
      .upsert(payload, {
        onConflict: "installment_id,channel,reminder_kind",
        ignoreDuplicates: true,
      })
      .select("id");

    if (insertErr) throw new Error(insertErr.message);

    const created = inserted?.length ?? 0;
    return {
      requested: data.installmentIds.length,
      created,
      skipped_existing: eligible.length - created,
      skipped_missing_contact: missingContact,
      scheduled_at: scheduledAtIso,
    };
  });

// ---------------------------------------------------------------------------
// Admin reminder-job management: list / filter / retry / cancel
// ---------------------------------------------------------------------------

export type ReminderJobStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled"
  | "skipped";

export type ReminderJobChannel = "email" | "sms";

export interface ReminderJobRow {
  id: string;
  installment_id: string;
  membership_id: string;
  recipient_id: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  channel: ReminderJobChannel;
  reminder_kind: string;
  status: ReminderJobStatus;
  scheduled_at: string;
  next_attempt_at: string | null;
  sent_at: string | null;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  provider: string | null;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  dead_letter_at: string | null;
  dead_letter_reason: string | null;
  created_at: string;
  updated_at: string;
  metadata: JsonValue;
  membership_number: string | null;
  member_display_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  installment_sequence: number | null;
  installment_due_date: string | null;
  installment_amount: number | null;
}

export interface ListReminderJobsResult {
  rows: ReminderJobRow[];
  total: number;
  page: number;
  pageSize: number;
}

const listSchema = z.object({
  status: z
    .enum(["pending", "sending", "sent", "failed", "cancelled", "skipped", "all"])
    .default("all"),
  channel: z.enum(["email", "sms", "all"]).default("all"),
  q: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const listReminderJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input))
  .handler(async ({ data, context }): Promise<ListReminderJobsResult> => {
    await assertAdmin(context);

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let query = context.supabase
      .from("payment_reminder_jobs")
      .select(
        `id, installment_id, membership_id, recipient_id, recipient_email, recipient_phone,
         channel, reminder_kind, status, scheduled_at, next_attempt_at, sent_at,
         attempts, max_attempts, last_attempt_at, provider, provider_message_id,
         error_code, error_message, dead_letter_at, dead_letter_reason,
         created_at, updated_at, metadata,
         memberships:membership_id (
           membership_number, member_display_id,
           profiles:user_id ( full_name, email, phone )
         ),
         installments:installment_id ( sequence, due_date, amount )`,
        { count: "exact" },
      )
      .order("scheduled_at", { ascending: false })
      .range(from, to);

    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.channel !== "all") query = query.eq("channel", data.channel);
    if (data.q) {
      const like = `%${data.q}%`;
      query = query.or(
        `recipient_email.ilike.${like},recipient_phone.ilike.${like},provider_message_id.ilike.${like},error_code.ilike.${like},error_message.ilike.${like}`,
      );
    }

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);

    type Raw = ReminderJobRow & {
      memberships: {
        membership_number: string | null;
        member_display_id: string | null;
        profiles: { full_name: string | null; email: string | null; phone: string | null } | null;
      } | null;
      installments: { sequence: number | null; due_date: string | null; amount: number | string | null } | null;
    };

    const mapped: ReminderJobRow[] = ((rows ?? []) as unknown as Raw[]).map((r) => ({
      id: r.id,
      installment_id: r.installment_id,
      membership_id: r.membership_id,
      recipient_id: r.recipient_id,
      recipient_email: r.recipient_email,
      recipient_phone: r.recipient_phone,
      channel: r.channel,
      reminder_kind: r.reminder_kind,
      status: r.status,
      scheduled_at: r.scheduled_at,
      next_attempt_at: r.next_attempt_at,
      sent_at: r.sent_at,
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      last_attempt_at: r.last_attempt_at,
      provider: r.provider,
      provider_message_id: r.provider_message_id,
      error_code: r.error_code,
      error_message: r.error_message,
      dead_letter_at: r.dead_letter_at,
      dead_letter_reason: r.dead_letter_reason,
      created_at: r.created_at,
      updated_at: r.updated_at,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      membership_number: r.memberships?.membership_number ?? null,
      member_display_id: r.memberships?.member_display_id ?? null,
      customer_name: r.memberships?.profiles?.full_name ?? null,
      customer_email: r.memberships?.profiles?.email ?? null,
      customer_phone: r.memberships?.profiles?.phone ?? null,
      installment_sequence: r.installments?.sequence ?? null,
      installment_due_date: r.installments?.due_date ?? null,
      installment_amount: r.installments?.amount == null ? null : Number(r.installments.amount),
    }));

    return {
      rows: mapped,
      total: count ?? mapped.length,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

const idsSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(200),
});

export interface JobActionResult {
  updated: number;
  skipped: number;
}

/**
 * Retry: resets `failed` / `cancelled` / `skipped` jobs back to `pending`,
 * clears error/next_attempt fields, and schedules them for immediate pickup.
 * Jobs already `sent` or currently `sending` are skipped.
 */
export const retryReminderJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idsSchema.parse(input))
  .handler(async ({ data, context }): Promise<JobActionResult> => {
    await assertAdmin(context);

    const nowIso = new Date().toISOString();

    const { data: updated, error } = await context.supabase
      .from("payment_reminder_jobs")
      .update({
        status: "pending",
        error_code: null,
        error_message: null,
        next_attempt_at: nowIso,
        scheduled_at: nowIso,
        dead_letter_at: null,
        dead_letter_reason: null,
      })
      .in("id", data.jobIds)
      .in("status", ["failed", "cancelled", "skipped"])
      .select("id");

    if (error) throw new Error(error.message);

    const count = updated?.length ?? 0;
    return { updated: count, skipped: data.jobIds.length - count };
  });

/**
 * Cancel: marks pending/failed jobs as `cancelled` so the worker skips them.
 * Already-sent or in-flight `sending` jobs are skipped.
 */
export const cancelReminderJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idsSchema.parse(input))
  .handler(async ({ data, context }): Promise<JobActionResult> => {
    await assertAdmin(context);

    const { data: updated, error } = await context.supabase
      .from("payment_reminder_jobs")
      .update({
        status: "cancelled",
        next_attempt_at: null,
      })
      .in("id", data.jobIds)
      .in("status", ["pending", "failed", "skipped"])
      .select("id");

    if (error) throw new Error(error.message);

    const count = updated?.length ?? 0;
    return { updated: count, skipped: data.jobIds.length - count };
  });
