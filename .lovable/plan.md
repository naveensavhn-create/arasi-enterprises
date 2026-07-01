# Async "Export All" for the Payments Ledger

Today's server-side CSV caps at 10,000 rows. This adds a background-job pipeline so admins can request an unlimited "Export All" (still bounded, but far higher), see progress, and download the finished file — with an in-app toast/badge when it's ready. Email delivery is optional and gated on the project having email infrastructure configured (it currently does not); if you want email too, we'd add it as a follow-up after email setup.

## What the admin sees

1. In the Export dropdown on `/admin/payments`, a new item **"Export all (async)"** appears whenever the filtered `total` exceeds 10,000 (also selectable manually below that threshold).
2. Clicking it creates an export job with the current filters + sort snapshot and shows a toast: *"Export queued. We'll notify you when it's ready."*
3. A new **Exports** entry appears in the admin sidebar → `/admin/exports`:
   - Table of my recent jobs: created_at, filter summary chip list, row count, status (`queued` / `running` / `succeeded` / `failed`), size, download button, expiry.
   - Failed jobs show the error and a **Retry** button that re-queues with the same snapshot.
4. A header bell/badge on `/admin/payments` polls `list_my_export_jobs` and toasts when a job flips to `succeeded` — with a **Download** action that opens a signed URL.
5. Files auto-expire after 7 days; the job row keeps the metadata but the download button becomes disabled with a "File expired — re-run export" hint.

## Backend design

- **`public.export_jobs`** table — one row per request:
  - `id`, `requested_by` (uuid → auth.users), `kind` ('payments_csv'), `status` (`queued|running|succeeded|failed|expired`), `filters` (jsonb — the same shape passed to `exportAdminPaymentsCsv`), `row_count`, `byte_size`, `storage_path`, `error`, `created_at`, `started_at`, `finished_at`, `expires_at`, `attempts`.
  - RLS: admins can read/insert their own; service_role bypasses. GRANT block per house rules.
- **`payment-exports` Storage bucket** (private). Files stored at `exports/{user_id}/{job_id}.csv`. Signed URLs minted server-side on demand.
- **`createExportJob` server fn** (`requireSupabaseAuth` + admin check): validates filters with the existing `baseFilterSchema`, inserts a `queued` row, returns the job id.
- **`listMyExportJobs` / `getMyExportJob` server fns**: return the admin's own jobs; used for the Exports page and the header polling badge.
- **`getExportDownloadUrl` server fn**: verifies ownership, mints a 5-minute signed URL from Storage.
- **`retryExportJob` / `cancelExportJob` server fns**: guarded lifecycle actions.
- **Worker route** at `src/routes/api/public/hooks/process-export-jobs.ts`:
  - Reads `apikey` header (Supabase publishable key) per the cron auth pattern.
  - Atomically claims the oldest `queued` job (`UPDATE ... SET status='running', started_at=now() WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`).
  - Streams rows via the existing `buildExportRows` helper in **50k-row pages** to a raised hard cap of **250,000 rows**, writing CSV chunks into a single Storage upload.
  - On success: uploads final CSV, sets `status='succeeded'`, `byte_size`, `storage_path`, `expires_at = now() + 7 days`.
  - On error: increments `attempts`, sets `status='failed'` after 3 attempts with the error message.
- **pg_cron job** (`process-export-jobs`) runs every minute and POSTs to the worker route. Single row-at-a-time processing keeps memory bounded; a job typically finishes in one tick.
- A daily cron sweeps `succeeded` rows past `expires_at`, deletes the storage object, and marks them `expired`.

## UI details

- Reuse `PollingControls` on `/admin/exports` for the same-scope refetch UX.
- The Payments header gains a small **Exports** bell (badge = count of jobs finished since last visit). Clicking navigates to `/admin/exports`.
- Toasts use `sonner` (already project-standard). No email until email infra is wired.

## Notification scope for this change

- **In-app**: implemented (toast + badge + Exports page).
- **Email**: not implemented in this change. The project has no email domain / infrastructure configured yet. Once you say "yes, add email too", I'll run the email setup flow and add an `export-ready` transactional template that fires from the worker on success.

## Files touched

- Migration: create `public.export_jobs` (+ GRANTs, RLS, indexes), create `payment-exports` bucket, schedule the two cron jobs.
- `src/lib/exports.functions.ts` — new server functions (create/list/get/retry/download-url).
- `src/routes/api/public/hooks/process-export-jobs.ts` — worker.
- `src/routes/_authenticated/admin/exports.tsx` — new page + sidebar entry.
- `src/routes/_authenticated/admin/payments.tsx` — add async option to Export dropdown, add Exports bell.
- `src/components/layout/AppSidebar.tsx` — add "Exports" nav item under Admin.

## Confirm before I build

1. **Email delivery**: skip for now (in-app only) — or set up email infra as part of this change?
2. **Hard cap**: OK with 250,000 rows per async job, or higher/lower?
3. **File retention**: OK with 7 days before expiry?
