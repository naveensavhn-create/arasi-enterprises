
-- 1. Add columns with safe defaults
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS reminder_cron_schedule text NOT NULL DEFAULT '* * * * *',
  ADD COLUMN IF NOT EXISTS reminder_cron_timezone text NOT NULL DEFAULT 'Asia/Kolkata';

-- 2. Validation function + trigger (cron shape + IANA tz)
CREATE OR REPLACE FUNCTION public.validate_reminder_cron_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  parts int;
BEGIN
  -- Cron: exactly 5 whitespace-separated fields, each matching a permissive charset.
  IF NEW.reminder_cron_schedule IS NULL
     OR btrim(NEW.reminder_cron_schedule) = '' THEN
    RAISE EXCEPTION 'reminder_cron_schedule cannot be empty';
  END IF;

  parts := array_length(regexp_split_to_array(btrim(NEW.reminder_cron_schedule), '\s+'), 1);
  IF parts <> 5 THEN
    RAISE EXCEPTION 'reminder_cron_schedule must be a 5-field cron expression (got % fields)', parts;
  END IF;

  IF NEW.reminder_cron_schedule !~ '^[0-9\*\-\,\/\s]+$' THEN
    RAISE EXCEPTION 'reminder_cron_schedule contains invalid characters (allowed: digits, * , - / and spaces)';
  END IF;

  -- Timezone: must resolve against pg_timezone_names.
  IF NEW.reminder_cron_timezone IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.reminder_cron_timezone) THEN
    RAISE EXCEPTION 'reminder_cron_timezone "%" is not a recognized IANA timezone', NEW.reminder_cron_timezone;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reminder_cron ON public.site_settings;
CREATE TRIGGER trg_validate_reminder_cron
BEFORE INSERT OR UPDATE OF reminder_cron_schedule, reminder_cron_timezone
ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_reminder_cron_settings();

-- 3. Admin-only RPC that applies the schedule to the pg_cron job.
CREATE OR REPLACE FUNCTION public.apply_reminder_cron_settings(
  _schedule text,
  _timezone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  -- Reuse the same validation as the trigger.
  IF array_length(regexp_split_to_array(btrim(_schedule), '\s+'), 1) <> 5
     OR _schedule !~ '^[0-9\*\-\,\/\s]+$' THEN
    RAISE EXCEPTION 'Invalid cron schedule: %', _schedule;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _timezone) THEN
    RAISE EXCEPTION 'Unknown timezone: %', _timezone;
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'process-payment-reminders';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'process-payment-reminders cron job not found';
  END IF;

  PERFORM cron.alter_job(
    job_id   => v_jobid,
    schedule => btrim(_schedule),
    timezone => _timezone
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_reminder_cron_settings(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_reminder_cron_settings(text, text) TO authenticated;
