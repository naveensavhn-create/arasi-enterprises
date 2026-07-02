
DO $$ BEGIN
  CREATE TYPE public.reward_notification_kind AS ENUM ('unlocked','status_change');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.reward_notification_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES public.reward_events(id) ON DELETE CASCADE,
  reward_id           UUID REFERENCES public.customer_rewards(id) ON DELETE CASCADE,
  membership_id       UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  tier_id             UUID REFERENCES public.reward_tiers(id) ON DELETE SET NULL,
  recipient_id        UUID NOT NULL,
  recipient_email     TEXT,
  recipient_phone     TEXT,
  channel             public.reminder_channel NOT NULL,
  notification_kind   public.reward_notification_kind NOT NULL,
  from_status         public.reward_claim_status,
  to_status           public.reward_claim_status,
  status              public.reminder_status NOT NULL DEFAULT 'pending',
  scheduled_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at     TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  attempts            INT NOT NULL DEFAULT 0,
  max_attempts        INT NOT NULL DEFAULT 5,
  last_attempt_at     TIMESTAMPTZ,
  provider            TEXT,
  provider_message_id TEXT,
  error_code          TEXT,
  error_message       TEXT,
  dead_letter_at      TIMESTAMPTZ,
  dead_letter_reason  TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reward_notification_jobs_uniq
  ON public.reward_notification_jobs (event_id, channel);
CREATE INDEX IF NOT EXISTS reward_notification_jobs_due_idx
  ON public.reward_notification_jobs (status, next_attempt_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS reward_notification_jobs_recipient_idx
  ON public.reward_notification_jobs (recipient_id, scheduled_at DESC);

GRANT SELECT ON public.reward_notification_jobs TO authenticated;
GRANT ALL    ON public.reward_notification_jobs TO service_role;

ALTER TABLE public.reward_notification_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all reward notification jobs" ON public.reward_notification_jobs;
CREATE POLICY "Admins manage all reward notification jobs"
  ON public.reward_notification_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Recipients view own reward notifications" ON public.reward_notification_jobs;
CREATE POLICY "Recipients view own reward notifications"
  ON public.reward_notification_jobs
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

DROP TRIGGER IF EXISTS trg_reward_notification_jobs_updated_at ON public.reward_notification_jobs;
CREATE TRIGGER trg_reward_notification_jobs_updated_at
  BEFORE UPDATE ON public.reward_notification_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action = ANY (ARRAY[
  'promote','revoke','role_change','bootstrap_claim',
  'plan_delete_blocked','plan_delete_success',
  'user.revoked','user.restored','user.deleted',
  'user.password_reset_email','user.password_generated',
  'site_settings.updated',
  'reminder.sent','reminder.failed','reminder.retry_scheduled',
  'reminder.dead_lettered','reminder.skipped','reminder.claimed',
  'reward_notification.sent','reward_notification.failed',
  'reward_notification.retry_scheduled','reward_notification.dead_lettered',
  'reward_notification.skipped'
]));

CREATE OR REPLACE FUNCTION public.enqueue_reward_notification_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  IF NEW.event_type NOT IN ('unlocked','status_change') THEN
    RETURN NEW;
  END IF;
  IF NEW.event_type = 'status_change'
     AND NEW.to_status IS NOT DISTINCT FROM NEW.from_status THEN
    RETURN NEW;
  END IF;

  SELECT p.email, p.phone, p.full_name
    INTO v_profile
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  IF v_profile.email IS NOT NULL AND btrim(v_profile.email) <> '' THEN
    INSERT INTO public.reward_notification_jobs (
      event_id, reward_id, membership_id, tier_id,
      recipient_id, recipient_email,
      channel, notification_kind, from_status, to_status,
      metadata
    ) VALUES (
      NEW.id, NEW.reward_id, NEW.membership_id, NEW.tier_id,
      NEW.user_id, v_profile.email,
      'email',
      (CASE WHEN NEW.event_type = 'unlocked' THEN 'unlocked' ELSE 'status_change' END)::public.reward_notification_kind,
      NEW.from_status, NEW.to_status,
      jsonb_build_object('recipient_name', v_profile.full_name, 'event_note', NEW.note)
    )
    ON CONFLICT (event_id, channel) DO NOTHING;
  END IF;

  IF v_profile.phone IS NOT NULL AND btrim(v_profile.phone) <> '' THEN
    INSERT INTO public.reward_notification_jobs (
      event_id, reward_id, membership_id, tier_id,
      recipient_id, recipient_phone,
      channel, notification_kind, from_status, to_status,
      metadata
    ) VALUES (
      NEW.id, NEW.reward_id, NEW.membership_id, NEW.tier_id,
      NEW.user_id, v_profile.phone,
      'sms',
      (CASE WHEN NEW.event_type = 'unlocked' THEN 'unlocked' ELSE 'status_change' END)::public.reward_notification_kind,
      NEW.from_status, NEW.to_status,
      jsonb_build_object('recipient_name', v_profile.full_name, 'event_note', NEW.note)
    )
    ON CONFLICT (event_id, channel) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reward_events_enqueue_notifications ON public.reward_events;
CREATE TRIGGER trg_reward_events_enqueue_notifications
  AFTER INSERT ON public.reward_events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_reward_notification_jobs();

CREATE OR REPLACE FUNCTION public.claim_due_reward_notification_jobs(_limit INTEGER DEFAULT 25)
RETURNS SETOF public.reward_notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT id
      FROM public.reward_notification_jobs
     WHERE status IN ('pending','failed')
       AND COALESCE(next_attempt_at, scheduled_at) <= now()
       AND attempts < max_attempts
     ORDER BY COALESCE(next_attempt_at, scheduled_at) ASC
     LIMIT GREATEST(_limit, 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.reward_notification_jobs j
     SET status = 'sending',
         attempts = j.attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
    FROM due
   WHERE j.id = due.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_reward_notification_jobs(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_reward_notification_jobs(INTEGER) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_reward_notification_job(
  _job_id UUID,
  _status TEXT,
  _provider TEXT DEFAULT NULL,
  _provider_message_id TEXT DEFAULT NULL,
  _error_code TEXT DEFAULT NULL,
  _error_message TEXT DEFAULT NULL,
  _retry_in_seconds INTEGER DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.reward_notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.reward_notification_jobs%ROWTYPE;
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

  SELECT * INTO v_job FROM public.reward_notification_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward notification job % not found', _job_id;
  END IF;

  IF _status = 'sent' THEN
    v_new_status := 'sent';
    v_action := 'reward_notification.sent';
    UPDATE public.reward_notification_jobs
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
    v_action := 'reward_notification.skipped';
    UPDATE public.reward_notification_jobs
       SET status = v_new_status,
           error_code = _error_code,
           error_message = _error_message,
           next_attempt_at = NULL,
           updated_at = now()
     WHERE id = _job_id
     RETURNING * INTO v_job;

  ELSIF _status = 'dead_letter' THEN
    v_new_status := 'failed';
    v_action := 'reward_notification.dead_lettered';
    v_dead_at := now();
    v_dead_reason := COALESCE(_error_message, 'max attempts exceeded');
    UPDATE public.reward_notification_jobs
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
    IF v_job.attempts >= v_job.max_attempts THEN
      v_new_status := 'failed';
      v_action := 'reward_notification.dead_lettered';
      v_dead_at := now();
      v_dead_reason := COALESCE(_error_message, 'max attempts exceeded');
      UPDATE public.reward_notification_jobs
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
      v_action := 'reward_notification.retry_scheduled';
      v_next := now() + make_interval(secs => GREATEST(COALESCE(_retry_in_seconds, 60), 30));
      UPDATE public.reward_notification_jobs
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

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, metadata)
  VALUES (
    auth.uid(), NULL, v_action, v_job.recipient_id, v_job.recipient_email,
    jsonb_build_object(
      'job_id', v_job.id,
      'event_id', v_job.event_id,
      'reward_id', v_job.reward_id,
      'membership_id', v_job.membership_id,
      'channel', v_job.channel,
      'notification_kind', v_job.notification_kind,
      'from_status', v_job.from_status,
      'to_status', v_job.to_status,
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
      'source', 'reward_notification_worker'
    ) || COALESCE(_metadata, '{}'::jsonb)
  );

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_reward_notification_job(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_reward_notification_job(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB)
  TO service_role, authenticated;
