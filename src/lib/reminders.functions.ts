import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

async function assertAdmin(context: {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  userId: string;
}) {
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
