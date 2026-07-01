
-- 1) Retry / DLQ columns on payment_reminder_jobs
ALTER TABLE public.payment_reminder_jobs
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_letter_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;

-- Backfill next_attempt_at from scheduled_at for existing rows.
UPDATE public.payment_reminder_jobs
   SET next_attempt_at = scheduled_at
 WHERE next_attempt_at IS NULL;

CREATE INDEX IF NOT EXISTS payment_reminder_jobs_due_idx
  ON public.payment_reminder_jobs (status, next_attempt_at)
  WHERE status IN ('pending','failed');

-- 2) Extend admin_audit_log action check + allow system (null) actor.
ALTER TABLE public.admin_audit_log ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action = ANY (ARRAY[
  'promote','revoke','role_change','bootstrap_claim',
  'plan_delete_blocked','plan_delete_success',
  'user.revoked','user.restored','user.deleted',
  'user.password_reset_email','user.password_generated',
  'site_settings.updated',
  'reminder.sent','reminder.failed','reminder.retry_scheduled',
  'reminder.dead_lettered','reminder.skipped','reminder.claimed'
]));

-- 3) Worker RPC: atomically claim a batch of due jobs.
CREATE OR REPLACE FUNCTION public.claim_due_reminder_jobs(_limit INTEGER DEFAULT 25)
RETURNS SETOF public.payment_reminder_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins (used from server routes / cron via service role) may claim.
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT id
      FROM public.payment_reminder_jobs
     WHERE status IN ('pending','failed')
       AND COALESCE(next_attempt_at, scheduled_at) <= now()
       AND attempts < max_attempts
     ORDER BY COALESCE(next_attempt_at, scheduled_at) ASC
     LIMIT GREATEST(_limit, 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.payment_reminder_jobs j
     SET status = 'sending',
         attempts = j.attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
    FROM due
   WHERE j.id = due.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_reminder_jobs(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_reminder_jobs(INTEGER) TO service_role, authenticated;

-- 4) Worker RPC: finalize a job and write an audit log row for every attempt.
CREATE OR REPLACE FUNCTION public.finalize_reminder_job(
  _job_id UUID,
  _status TEXT,                          -- 'sent' | 'failed' | 'dead_letter' | 'skipped'
  _provider TEXT DEFAULT NULL,
  _provider_message_id TEXT DEFAULT NULL,
  _error_code TEXT DEFAULT NULL,
  _error_message TEXT DEFAULT NULL,
  _retry_in_seconds INTEGER DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.payment_reminder_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.payment_reminder_jobs%ROWTYPE;
  v_action TEXT;
  v_new_status public.reminder_status;
  v_next TIMESTAMPTZ;
  v_dead_at TIMESTAMPTZ := NULL;
  v_dead_reason TEXT := NULL;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.payment_reminder_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reminder job % not found', _job_id;
  END IF;

  IF _status = 'sent' THEN
    v_new_status := 'sent';
    v_action := 'reminder.sent';
    v_next := NULL;
    UPDATE public.payment_reminder_jobs
       SET status = v_new_status,
           sent_at = now(),
           provider = COALESCE(_provider, provider),
           provider_message_id = COALESCE(_provider_message_id, provider_message_id),
           error_code = NULL,
           error_message = NULL,
           next_attempt_at = NULL,
           updated_at = now()
     WHERE id = _job_id
     RETURNING * INTO v_job;

  ELSIF _status = 'skipped' THEN
    v_new_status := 'skipped';
    v_action := 'reminder.skipped';
    UPDATE public.payment_reminder_jobs
       SET status = v_new_status,
           error_code = _error_code,
           error_message = _error_message,
           next_attempt_at = NULL,
           updated_at = now()
     WHERE id = _job_id
     RETURNING * INTO v_job;

  ELSIF _status = 'dead_letter' THEN
    v_new_status := 'failed';
    v_action := 'reminder.dead_lettered';
    v_dead_at := now();
    v_dead_reason := COALESCE(_error_message, 'max attempts exceeded');
    UPDATE public.payment_reminder_jobs
       SET status = v_new_status,
           error_code = _error_code,
           error_message = _error_message,
           dead_letter_at = v_dead_at,
           dead_letter_reason = v_dead_reason,
           next_attempt_at = NULL,
           updated_at = now()
     WHERE id = _job_id
     RETURNING * INTO v_job;

  ELSIF _status = 'failed' THEN
    -- Decide retry vs dead-letter based on remaining attempts.
    IF v_job.attempts >= v_job.max_attempts THEN
      v_new_status := 'failed';
      v_action := 'reminder.dead_lettered';
      v_dead_at := now();
      v_dead_reason := COALESCE(_error_message, 'max attempts exceeded');
      UPDATE public.payment_reminder_jobs
         SET status = v_new_status,
             error_code = _error_code,
             error_message = _error_message,
             dead_letter_at = v_dead_at,
             dead_letter_reason = v_dead_reason,
             next_attempt_at = NULL,
             updated_at = now()
       WHERE id = _job_id
       RETURNING * INTO v_job;
    ELSE
      v_new_status := 'failed';
      v_action := 'reminder.retry_scheduled';
      v_next := now() + make_interval(secs => GREATEST(COALESCE(_retry_in_seconds, 60), 30));
      UPDATE public.payment_reminder_jobs
         SET status = v_new_status,
             error_code = _error_code,
             error_message = _error_message,
             next_attempt_at = v_next,
             updated_at = now()
       WHERE id = _job_id
       RETURNING * INTO v_job;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown finalize status: %', _status;
  END IF;

  -- Audit every attempt.
  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, metadata)
  VALUES (
    auth.uid(),
    NULL,
    v_action,
    v_job.recipient_id,
    v_job.recipient_email,
    jsonb_build_object(
      'job_id', v_job.id,
      'installment_id', v_job.installment_id,
      'membership_id', v_job.membership_id,
      'channel', v_job.channel,
      'reminder_kind', v_job.reminder_kind,
      'attempts', v_job.attempts,
      'max_attempts', v_job.max_attempts,
      'status', v_new_status,
      'provider', v_job.provider,
      'provider_message_id', v_job.provider_message_id,
      'error_code', _error_code,
      'error_message', _error_message,
      'next_attempt_at', v_next,
      'dead_letter_at', v_dead_at,
      'dead_letter_reason', v_dead_reason,
      'source', 'reminder_worker'
    ) || COALESCE(_metadata, '{}'::jsonb)
  );

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_reminder_job(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_reminder_job(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB) TO service_role, authenticated;
