import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { buildExportRows, rowsToCsv } from "@/lib/payments.functions";
import { exportFiltersSchema } from "@/lib/exports.functions";

/**
 * Background worker for admin CSV exports. Triggered by pg_cron every minute.
 *
 * Auth: the cron caller MUST pass the Supabase publishable/anon key as the
 * `apikey` header (matches the shared cron auth pattern for /api/public/*).
 * A missing or mismatched key returns 401 without touching the queue.
 *
 * Each invocation claims at most one queued job with a transactional
 * `UPDATE ... WHERE status = 'queued'` guard so concurrent ticks can't
 * double-process the same row. The job then runs to completion inline.
 */
const HARD_CAP = 250_000;
const PAGE_SIZE = 5_000;
const RETENTION_DAYS = 7;
const MAX_ATTEMPTS = 3;

async function processOne(supabaseAdmin: any): Promise<{
  processed: boolean;
  jobId?: string;
  status?: string;
  error?: string;
}> {
  // Claim the oldest queued job atomically. The RLS-bypassing service role
  // is required here because the RLS policy scopes reads/updates to the
  // requester and we're running as a system worker.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("export_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .select("*");
  if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
  const job = (claimed ?? [])[0];
  if (!job) return { processed: false };

  const jobId = job.id as string;
  try {
    // Validate filters snapshot before we spend time on it.
    const filters = exportFiltersSchema.parse(job.filters ?? {});

    // Stream rows page-by-page into a single CSV buffer.
    const parts: string[] = [];
    let totalRows = 0;
    let capped = false;

    let offset = 0;
    while (offset < HARD_CAP) {
      const remaining = HARD_CAP - offset;
      const take = Math.min(PAGE_SIZE, remaining);
      const rows = await buildExportRows(supabaseAdmin, filters, offset, take);
      if (rows.length === 0) break;

      // First page includes the header row; subsequent pages append data
      // rows only. rowsToCsv() emits BOM + header + rows + trailing CRLF.
      const chunk = rowsToCsv(rows);
      if (offset === 0) {
        parts.push(chunk);
      } else {
        // Strip the leading BOM + header + first CRLF from subsequent chunks
        // so the concatenated file has exactly one header.
        const headerEnd = chunk.indexOf("\r\n");
        parts.push(chunk.slice(headerEnd + 2));
      }
      totalRows += rows.length;
      if (rows.length < take) break;
      offset += rows.length;
      if (offset >= HARD_CAP) {
        capped = true;
        break;
      }
    }

    const csv = parts.join("");
    const bytes = new TextEncoder().encode(csv);
    const storagePath = `exports/${job.requested_by}/${jobId}.csv`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("payment-exports")
      .upload(storagePath, bytes, {
        contentType: "text/csv; charset=utf-8",
        upsert: true,
      });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    const expiresAt = new Date(
      Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: doneErr } = await supabaseAdmin
      .from("export_jobs")
      .update({
        status: "succeeded",
        row_count: totalRows,
        byte_size: bytes.byteLength,
        storage_path: storagePath,
        finished_at: new Date().toISOString(),
        expires_at: expiresAt,
        error: capped
          ? `Capped at ${HARD_CAP.toLocaleString()} rows — narrow filters to export the rest.`
          : null,
      })
      .eq("id", jobId);
    if (doneErr) throw new Error(`finalize failed: ${doneErr.message}`);

    return { processed: true, jobId, status: "succeeded" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const attempts = (job.attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await supabaseAdmin
      .from("export_jobs")
      .update({
        status: failed ? "failed" : "queued",
        attempts,
        error: message.slice(0, 1000),
        finished_at: failed ? new Date().toISOString() : null,
        started_at: null,
      })
      .eq("id", jobId);
    return {
      processed: true,
      jobId,
      status: failed ? "failed" : "queued",
      error: message,
    };
  }
}

export const Route = createFileRoute("/api/public/hooks/process-export-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          process.env.SUPABASE_ANON_KEY ??
          "";
        if (!expected || apiKey !== expected) {
          return new Response(
            JSON.stringify({ error: "Unauthorized" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }

        const supabaseAdmin = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        // Process up to 3 jobs per tick to catch up on small backlogs
        // without holding the worker open for very long.
        const results: Array<Awaited<ReturnType<typeof processOne>>> = [];
        for (let i = 0; i < 3; i += 1) {
          const res = await processOne(supabaseAdmin);
          if (!res.processed) break;
          results.push(res);
        }

        // Sweep expired files so storage doesn't grow unbounded.
        const { data: expired } = await supabaseAdmin
          .from("export_jobs")
          .select("id, storage_path")
          .eq("status", "succeeded")
          .not("storage_path", "is", null)
          .lt("expires_at", new Date().toISOString())
          .limit(20);
        for (const row of expired ?? []) {
          if (row.storage_path) {
            await supabaseAdmin.storage
              .from("payment-exports")
              .remove([row.storage_path]);
          }
          await supabaseAdmin
            .from("export_jobs")
            .update({ status: "expired", storage_path: null })
            .eq("id", row.id);
        }

        return Response.json({
          ok: true,
          processed: results.length,
          expired_swept: (expired ?? []).length,
          results,
        });
      },
    },
  },
});
