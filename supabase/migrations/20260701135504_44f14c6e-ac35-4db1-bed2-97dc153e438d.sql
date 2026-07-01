-- Enum for reminder job lifecycle
DO $$ BEGIN
  CREATE TYPE public.reminder_status AS ENUM ('pending','sending','sent','failed','cancelled','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reminder_channel AS ENUM ('email','sms');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.payment_reminder_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id UUID NOT NULL REFERENCES public.installments(id) ON DELETE CASCADE,
  membership_id  UUID NOT NULL REFERENCES public.memberships(id)  ON DELETE CASCADE,
  recipient_id   UUID NOT NULL,
  recipient_email TEXT,
  recipient_phone TEXT,
  channel        public.reminder_channel NOT NULL DEFAULT 'email',
  reminder_kind  TEXT NOT NULL DEFAULT 'upcoming',
  status         public.reminder_status  NOT NULL DEFAULT 'pending',
  scheduled_at   TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  attempts       INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  provider       TEXT,
  provider_message_id TEXT,
  error_code     TEXT,
  error_message  TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One reminder per installment+channel+kind to keep the worker idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS payment_reminder_jobs_uniq
  ON public.payment_reminder_jobs (installment_id, channel, reminder_kind);

CREATE INDEX IF NOT EXISTS payment_reminder_jobs_due_idx
  ON public.payment_reminder_jobs (status, scheduled_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS payment_reminder_jobs_recipient_idx
  ON public.payment_reminder_jobs (recipient_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS payment_reminder_jobs_membership_idx
  ON public.payment_reminder_jobs (membership_id, scheduled_at DESC);

GRANT SELECT ON public.payment_reminder_jobs TO authenticated;
GRANT ALL    ON public.payment_reminder_jobs TO service_role;

ALTER TABLE public.payment_reminder_jobs ENABLE ROW LEVEL SECURITY;

-- Admins can see and manage every reminder job.
CREATE POLICY "Admins manage all reminder jobs"
  ON public.payment_reminder_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Customers can see only their own reminders.
CREATE POLICY "Customers read own reminder jobs"
  ON public.payment_reminder_jobs
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

-- Reuse the shared updated_at trigger.
DROP TRIGGER IF EXISTS trg_payment_reminder_jobs_set_updated_at ON public.payment_reminder_jobs;
CREATE TRIGGER trg_payment_reminder_jobs_set_updated_at
BEFORE UPDATE ON public.payment_reminder_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();