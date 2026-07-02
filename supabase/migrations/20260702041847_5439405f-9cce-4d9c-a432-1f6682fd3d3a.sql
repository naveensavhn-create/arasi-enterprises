
-- Per-attempt provider/status/error history for every reminder job.
ALTER TABLE public.payment_reminder_jobs
  ADD COLUMN IF NOT EXISTS attempts_log jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.finalize_reminder_job(
  _job_id uuid,
  _status text,
  _provider text DEFAULT NULL::text,
  _provider_message_id text DEFAULT NULL::text,
  _error_code text DEFAULT NULL::text,
  _error_message text DEFAULT NULL::text,
  _retry_in_seconds integer DEFAULT NULL::integer,
  _metadata jsonb DEFAULT '{}'::jsonb
)
 RETURNS payment_reminder_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.payment_reminder_jobs%ROWTYPE;
  v_action TEXT;
  v_new_status public.reminder_status;
  v_next TIMESTAMPTZ;
  v_dead_at TIMESTAMPTZ := NULL;
  v_dead_reason TEXT := NULL;
  v_attempt_entry JSONB;
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
           provider = COALESCE(_provider, provider),
           provider_message_id = COALESCE(_provider_message_id, provider_message_id),
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
           provider = COALESCE(_provider, provider),
           provider_message_id = COALESCE(_provider_message_id, provider_message_id),
           error_code = _error_code,
           error_message = _error_message,
           dead_letter_at = v_dead_at,
           dead_letter_reason = v_dead_reason,
           next_attempt_at = NULL,
           updated_at = now()
     WHERE id = _job_id
     RETURNING * INTO v_job;

  ELSIF _status = 'failed' THEN
    IF v_job.attempts >= v_job.max_attempts THEN
      v_new_status := 'failed';
      v_action := 'reminder.dead_lettered';
      v_dead_at := now();
      v_dead_reason := COALESCE(_error_message, 'max attempts exceeded');
      UPDATE public.payment_reminder_jobs
         SET status = v_new_status,
             provider = COALESCE(_provider, provider),
             provider_message_id = COALESCE(_provider_message_id, provider_message_id),
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
             provider = COALESCE(_provider, provider),
             provider_message_id = COALESCE(_provider_message_id, provider_message_id),
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

  -- Append this attempt to the per-job attempts_log for full history.
  v_attempt_entry := jsonb_build_object(
    'at', now(),
    'attempt', v_job.attempts,
    'status', v_new_status,
    'channel', v_job.channel,
    'provider', COALESCE(_provider, v_job.provider),
    'provider_message_id', COALESCE(_provider_message_id, v_job.provider_message_id),
    'error_code', _error_code,
    'error_message', _error_message,
    'next_attempt_at', v_next,
    'dead_letter_at', v_dead_at,
    'dead_letter_reason', v_dead_reason,
    'metadata', COALESCE(_metadata, '{}'::jsonb)
  );

  UPDATE public.payment_reminder_jobs
     SET attempts_log = COALESCE(attempts_log, '[]'::jsonb) || jsonb_build_array(v_attempt_entry)
   WHERE id = _job_id
   RETURNING * INTO v_job;

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
$function$;
