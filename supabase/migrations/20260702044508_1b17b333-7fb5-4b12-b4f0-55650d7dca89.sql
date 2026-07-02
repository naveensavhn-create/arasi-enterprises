
CREATE TABLE IF NOT EXISTS public.kyc_email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.admin_audit_log(id) ON DELETE SET NULL,
  target_user_id uuid,
  recipient_email text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  template_name text NOT NULL DEFAULT 'kyc-decision',
  subject text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','dead_letter','skipped')),
  provider text,
  message_id text,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  dead_letter_at timestamptz,
  dead_letter_reason text,
  is_test boolean NOT NULL DEFAULT false,
  triggered_by uuid,
  reviewer_name text,
  reviewer_email text,
  review_notes text,
  assigned_role text,
  attempts_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_email_notifications_created_at_idx
  ON public.kyc_email_notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_email_notifications_target_idx
  ON public.kyc_email_notifications (target_user_id);
CREATE INDEX IF NOT EXISTS kyc_email_notifications_due_idx
  ON public.kyc_email_notifications (status, next_attempt_at)
  WHERE status IN ('pending','failed');

GRANT SELECT, INSERT, UPDATE ON public.kyc_email_notifications TO authenticated;
GRANT ALL ON public.kyc_email_notifications TO service_role;

ALTER TABLE public.kyc_email_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read kyc email notifications"
  ON public.kyc_email_notifications;
CREATE POLICY "Admins can read kyc email notifications"
  ON public.kyc_email_notifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update kyc email notifications"
  ON public.kyc_email_notifications;
CREATE POLICY "Admins can update kyc email notifications"
  ON public.kyc_email_notifications
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can insert kyc email notifications"
  ON public.kyc_email_notifications;
CREATE POLICY "Admins can insert kyc email notifications"
  ON public.kyc_email_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS kyc_email_notifications_set_updated_at
  ON public.kyc_email_notifications;
CREATE TRIGGER kyc_email_notifications_set_updated_at
  BEFORE UPDATE ON public.kyc_email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Claim jobs eligible for a (re)try: pending or previously failed with a due next_attempt_at.
CREATE OR REPLACE FUNCTION public.claim_due_kyc_email_jobs(_limit integer DEFAULT 25)
RETURNS SETOF public.kyc_email_notifications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.kyc_email_notifications
     WHERE status IN ('pending','failed')
       AND attempts < max_attempts
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY COALESCE(next_attempt_at, created_at) ASC
     LIMIT GREATEST(_limit, 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.kyc_email_notifications j
     SET status = 'sending',
         attempts = j.attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
    FROM due
   WHERE j.id = due.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_kyc_email_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_kyc_email_jobs(integer) TO authenticated, service_role;

-- Finalize an attempt: 'sent', 'failed' (with backoff), or 'dead_letter'.
CREATE OR REPLACE FUNCTION public.finalize_kyc_email_job(
  _job_id uuid,
  _status text,
  _provider text DEFAULT NULL,
  _message_id text DEFAULT NULL,
  _error_code text DEFAULT NULL,
  _error_message text DEFAULT NULL,
  _retry_in_seconds integer DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS public.kyc_email_notifications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.kyc_email_notifications%ROWTYPE;
  v_next timestamptz;
  v_dead_at timestamptz;
  v_dead_reason text;
  v_new_status text;
  v_entry jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.kyc_email_notifications WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KYC email job % not found', _job_id; END IF;

  IF _status = 'sent' THEN
    v_new_status := 'sent';
    UPDATE public.kyc_email_notifications
       SET status = v_new_status, sent_at = now(),
           provider = COALESCE(_provider, provider),
           message_id = COALESCE(_message_id, message_id),
           error_code = NULL, error_message = NULL, next_attempt_at = NULL,
           updated_at = now()
     WHERE id = _job_id RETURNING * INTO v_job;

  ELSIF _status = 'skipped' THEN
    v_new_status := 'skipped';
    UPDATE public.kyc_email_notifications
       SET status = v_new_status, error_code = _error_code, error_message = _error_message,
           next_attempt_at = NULL, updated_at = now()
     WHERE id = _job_id RETURNING * INTO v_job;

  ELSIF _status = 'dead_letter' OR (_status = 'failed' AND v_job.attempts >= v_job.max_attempts) THEN
    v_new_status := 'dead_letter';
    v_dead_at := now();
    v_dead_reason := COALESCE(_error_message, 'max attempts exceeded');
    UPDATE public.kyc_email_notifications
       SET status = v_new_status, error_code = _error_code, error_message = _error_message,
           dead_letter_at = v_dead_at, dead_letter_reason = v_dead_reason,
           next_attempt_at = NULL, updated_at = now()
     WHERE id = _job_id RETURNING * INTO v_job;

  ELSIF _status = 'failed' THEN
    v_new_status := 'failed';
    -- exponential-ish backoff: 60s * 2^(attempts-1), capped at 30m
    v_next := now() + make_interval(
      secs => LEAST(1800, GREATEST(COALESCE(_retry_in_seconds, 60 * (2 ^ GREATEST(v_job.attempts - 1, 0))::int), 30))
    );
    UPDATE public.kyc_email_notifications
       SET status = v_new_status, error_code = _error_code, error_message = _error_message,
           next_attempt_at = v_next, updated_at = now()
     WHERE id = _job_id RETURNING * INTO v_job;

  ELSE
    RAISE EXCEPTION 'Unknown finalize status: %', _status;
  END IF;

  v_entry := jsonb_build_object(
    'at', now(), 'attempt', v_job.attempts, 'status', v_new_status,
    'provider', COALESCE(_provider, v_job.provider),
    'message_id', COALESCE(_message_id, v_job.message_id),
    'error_code', _error_code, 'error_message', _error_message,
    'next_attempt_at', v_next, 'dead_letter_at', v_dead_at,
    'dead_letter_reason', v_dead_reason,
    'metadata', COALESCE(_metadata, '{}'::jsonb)
  );

  UPDATE public.kyc_email_notifications
     SET attempts_log = COALESCE(attempts_log, '[]'::jsonb) || jsonb_build_array(v_entry)
   WHERE id = _job_id RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_kyc_email_job(uuid, text, text, text, text, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_kyc_email_job(uuid, text, text, text, text, text, integer, jsonb) TO authenticated, service_role;

-- Requeue a job: admin action to reset backoff and mark it due immediately.
CREATE OR REPLACE FUNCTION public.requeue_kyc_email_job(_job_id uuid)
RETURNS public.kyc_email_notifications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_job public.kyc_email_notifications%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.kyc_email_notifications
     SET status = 'pending', next_attempt_at = now(),
         error_code = NULL, error_message = NULL,
         dead_letter_at = NULL, dead_letter_reason = NULL,
         updated_at = now()
   WHERE id = _job_id
   RETURNING * INTO v_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'KYC email job % not found', _job_id; END IF;
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_kyc_email_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_kyc_email_job(uuid) TO authenticated;
