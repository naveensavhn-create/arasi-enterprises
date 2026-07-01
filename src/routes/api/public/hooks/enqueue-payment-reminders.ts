import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

/**
 * Enqueue monthly payment reminder jobs for installments that are coming due,
 * due today, or overdue. Idempotent: the unique index
 * (installment_id, channel, reminder_kind) means re-runs never create
 * duplicates — conflicting rows are skipped and reported separately.
 *
 * Trigger: pg_cron POSTs here daily with the Supabase publishable key as
 * `apikey`. The companion worker `process-payment-reminders` sends them.
 *
 * Body (all optional):
 *   {
 *     kinds?: Array<"upcoming"|"due_today"|"overdue">   // default: all three
 *     channels?: Array<"email"|"sms">                    // default: ["email"]
 *     upcomingDays?: number                              // default: 3 (T-3)
 *     overdueMaxDays?: number                            // default: 30
 *     installmentIds?: string[]                          // manual re-queue
 *   }
 */

const bodySchema = z
  .object({
    kinds: z
      .array(z.enum(["upcoming", "due_today", "overdue"]))
      .min(1)
      .optional(),
    channels: z.array(z.enum(["email", "sms"])).min(1).optional(),
    upcomingDays: z.number().int().min(0).max(30).optional(),
    overdueMaxDays: z.number().int().min(0).max(365).optional(),
    installmentIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict()
  .default({});

type ReminderKind = "upcoming" | "due_today" | "overdue";
type Channel = "email" | "sms";

interface CandidateRow {
  installment_id: string;
  membership_id: string;
  recipient_id: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  due_date: string;
  amount: number;
  sequence: number;
  status: string;
}

function scheduledAtFor(kind: ReminderKind, dueDate: string): string {
  // Send window: 09:00 UTC (~14:30 IST) on the target day.
  const base = new Date(`${dueDate}T09:00:00.000Z`);
  if (kind === "upcoming") base.setUTCDate(base.getUTCDate() - 3);
  return base.toISOString();
}

export const Route = createFileRoute(
  "/api/public/hooks/enqueue-payment-reminders",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ??
          request.headers
            .get("Authorization")
            ?.replace(/^Bearer\s+/i, "");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          process.env.SUPABASE_ANON_KEY ??
          "";
        if (!expected || apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let parsedBody: z.infer<typeof bodySchema>;
        try {
          const raw = await request.json().catch(() => ({}));
          parsedBody = bodySchema.parse(raw ?? {});
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: "invalid_body",
              details:
                err instanceof z.ZodError ? err.issues : String(err),
            },
            { status: 400 },
          );
        }

        const kinds: ReminderKind[] = parsedBody.kinds ?? [
          "upcoming",
          "due_today",
          "overdue",
        ];
        const channels: Channel[] = parsedBody.channels ?? ["email"];
        const upcomingDays = parsedBody.upcomingDays ?? 3;
        const overdueMaxDays = parsedBody.overdueMaxDays ?? 30;

        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        // Compute date windows in UTC (installment.due_date is a DATE).
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const iso = (d: Date) => d.toISOString().slice(0, 10);
        const todayStr = iso(today);
        const upcomingTarget = new Date(today);
        upcomingTarget.setUTCDate(upcomingTarget.getUTCDate() + upcomingDays);
        const overdueFloor = new Date(today);
        overdueFloor.setUTCDate(overdueFloor.getUTCDate() - overdueMaxDays);

        // Select the union of candidate installments in one query. We intentionally
        // let the DB filter by dates so we're not paging thousands of rows client-side.
        const query = supabase
          .from("installments")
          .select(
            `id, membership_id, sequence, due_date, amount, status,
             memberships!inner(user_id,
               profiles:profiles!memberships_user_id_fkey(email, phone))`,
          )
          .in("status", ["pending", "overdue"])
          .gte("due_date", iso(overdueFloor))
          .lte("due_date", iso(upcomingTarget));

        if (parsedBody.installmentIds?.length) {
          query.in("id", parsedBody.installmentIds);
        }

        const { data: rows, error: fetchErr } = await query.limit(2000);
        if (fetchErr) {
          return Response.json(
            { ok: false, error: `fetch failed: ${fetchErr.message}` },
            { status: 500 },
          );
        }

        // Flatten + classify each installment into its applicable reminder kind(s).
        const candidates: Array<CandidateRow & { kind: ReminderKind }> = [];
        for (const row of rows ?? []) {
          const membership = (row as unknown as {
            memberships: {
              user_id: string;
              profiles: { email: string | null; phone: string | null } | null;
            };
          }).memberships;
          const recipientId = membership?.user_id;
          if (!recipientId) continue;

          const dueDate = row.due_date as string;
          const applicable: ReminderKind[] = [];
          if (kinds.includes("upcoming")) {
            const dt = new Date(`${dueDate}T00:00:00.000Z`).getTime();
            const target = upcomingTarget.getTime();
            if (dt === target) applicable.push("upcoming");
          }
          if (kinds.includes("due_today") && dueDate === todayStr) {
            applicable.push("due_today");
          }
          if (
            kinds.includes("overdue") &&
            dueDate < todayStr &&
            row.status !== "paid"
          ) {
            applicable.push("overdue");
          }

          for (const kind of applicable) {
            candidates.push({
              installment_id: row.id,
              membership_id: row.membership_id,
              recipient_id: recipientId,
              recipient_email: membership.profiles?.email ?? null,
              recipient_phone: membership.profiles?.phone ?? null,
              due_date: dueDate,
              amount: Number(row.amount),
              sequence: row.sequence,
              status: row.status,
              kind,
            });
          }
        }

        // Build one insert row per (installment × kind × channel), pinning
        // recipient info at enqueue time so later profile edits don't move
        // the reminder to a new address after it was queued.
        const inserts: Database["public"]["Tables"]["payment_reminder_jobs"]["Insert"][] =
          [];
        for (const c of candidates) {
          for (const ch of channels) {
            const recipient =
              ch === "email" ? c.recipient_email : c.recipient_phone;
            if (!recipient) continue; // no address for this channel — skip silently
            inserts.push({
              installment_id: c.installment_id,
              membership_id: c.membership_id,
              recipient_id: c.recipient_id,
              recipient_email: ch === "email" ? recipient : c.recipient_email,
              recipient_phone: ch === "sms" ? recipient : c.recipient_phone,
              channel: ch,
              reminder_kind: c.kind,
              status: "pending",
              scheduled_at: scheduledAtFor(c.kind, c.due_date),
              metadata: {
                source: "enqueue-payment-reminders",
                installment_sequence: c.sequence,
                installment_amount: c.amount,
                installment_status: c.status,
              },
            });
          }
        }

        if (inserts.length === 0) {
          return Response.json({
            ok: true,
            candidates: candidates.length,
            inserted: 0,
            skipped_duplicates: 0,
            kinds,
            channels,
          });
        }

        // Chunk to keep payloads sane; unique index handles idempotency so we
        // can rely on ignoreDuplicates instead of pre-checking existence.
        const CHUNK = 200;
        let inserted = 0;
        for (let i = 0; i < inserts.length; i += CHUNK) {
          const slice = inserts.slice(i, i + CHUNK);
          const { data, error } = await supabase
            .from("payment_reminder_jobs")
            .upsert(slice, {
              onConflict: "installment_id,channel,reminder_kind",
              ignoreDuplicates: true,
            })
            .select("id");
          if (error) {
            return Response.json(
              {
                ok: false,
                error: `insert failed at chunk ${i}: ${error.message}`,
                inserted_so_far: inserted,
              },
              { status: 500 },
            );
          }
          inserted += data?.length ?? 0;
        }

        return Response.json({
          ok: true,
          candidates: candidates.length,
          attempted: inserts.length,
          inserted,
          skipped_duplicates: inserts.length - inserted,
          kinds,
          channels,
        });
      },
    },
  },
});
