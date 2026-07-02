
DO $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_jobid BIGINT;
BEGIN
  -- Copy URL + apikey from the existing payment reminder cron so both
  -- workers stay in sync when secrets rotate.
  SELECT
    (command::text)
  INTO v_url
  FROM cron.job
  WHERE jobname = 'process-payment-reminders'
  LIMIT 1;

  IF v_url IS NULL THEN
    RAISE NOTICE 'process-payment-reminders cron job not found — skipping reward notification cron setup';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'process-reward-notifications';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  -- Derive worker URL by swapping the path in the existing reminder call.
  v_url := regexp_replace(
    v_url,
    'process-payment-reminders',
    'process-reward-notifications',
    'g'
  );

  PERFORM cron.schedule(
    'process-reward-notifications',
    '* * * * *',
    v_url
  );
END $$;
