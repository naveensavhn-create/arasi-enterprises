
-- 1) Fix search_path on the one function missing it
CREATE OR REPLACE FUNCTION public.reward_events_block_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'reward_events is append-only; % not allowed', TG_OP;
END;
$$;

-- 2) Remove public exposure on draws + draw_winners
DROP POLICY IF EXISTS "Draws readable by anyone" ON public.draws;
DROP POLICY IF EXISTS "Winners publicly viewable" ON public.draw_winners;

CREATE POLICY "Draws readable by authenticated"
  ON public.draws FOR SELECT TO authenticated USING (true);

CREATE POLICY "Winners readable by authenticated"
  ON public.draw_winners FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.draws FROM anon;
REVOKE SELECT ON public.draw_winners FROM anon;

-- 3) Revoke EXECUTE from PUBLIC/anon/authenticated on every SECURITY DEFINER
--    function in public, then re-grant only the RPCs the client calls.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname, r.args
    );
  END LOOP;
END $$;

-- Re-grant EXECUTE to authenticated on RPCs called from the client
DO $$
DECLARE
  r record;
  fn_names text[] := ARRAY[
    'admin_generate_rank_incentives','admin_list_kyc','admin_list_promoters',
    'admin_list_users','admin_payments_totals','admin_pick_draw_winners_manual',
    'admin_set_customer_promoter','admin_set_kyc_decision',
    'admin_update_commission_status','admin_update_gift',
    'admin_update_incentive_status','admin_update_profile',
    'admin_update_reward_status','admin_user_snapshot','admin_void_receipt',
    'apply_referral_code','apply_reminder_cron_settings','count_active_admins',
    'current_user_role','end_impersonation','finalize_kyc_email_job',
    'finalize_reminder_job','finalize_reward_notification_job',
    'get_active_impersonation','get_active_reminder_template','has_role',
    'list_impersonation_history','mark_all_notifications_read',
    'mark_notification_read','pick_draw_winners','recompute_customer_rewards',
    'request_customer_reward','requeue_kyc_email_job','start_impersonation',
    'log_reward_recompute','mark_installment_paid','run_reconciliation',
    'try_consume_rate_limit','resolve_reconciliation_finding',
    'promoter_list_my_customers','promoter_register_referred_customer',
    'promoter_submit_referral_for_review','recompute_promoter_rank',
    'eligible_draw_entries','generate_receipt_number','current_impersonation',
    'claim_due_kyc_email_jobs','claim_due_reward_notification_jobs',
    'plan_is_deletable'
  ];
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true AND p.proname = ANY(fn_names)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
                   r.proname, r.args);
  END LOOP;
END $$;

-- 4) Cron secret storage for authenticated cron hook calls
CREATE TABLE IF NOT EXISTS public.system_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.system_config TO service_role;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
-- No policies = no anon/authenticated access; only service_role bypasses RLS.

INSERT INTO public.system_config(key, value)
VALUES ('cron_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- 5) Rewire pg_cron http_post jobs to send Authorization: Bearer <cron_secret>
--    instead of the publishable apikey.
DO $$
DECLARE
  base_url text := 'https://project--2ace29a4-9bbe-4253-b885-8813918965ea.lovable.app';
BEGIN
  PERFORM cron.unschedule('process-export-jobs');
  PERFORM cron.schedule('process-export-jobs', '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(SELECT value FROM public.system_config WHERE key='cron_secret')
        ),
        body := '{}'::jsonb
      );
    $cmd$, base_url || '/api/public/hooks/process-export-jobs'));

  PERFORM cron.unschedule('process-payment-reminders');
  PERFORM cron.schedule('process-payment-reminders', '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(SELECT value FROM public.system_config WHERE key='cron_secret')
        ),
        body := '{}'::jsonb
      );
    $cmd$, base_url || '/api/public/hooks/process-payment-reminders'));

  PERFORM cron.unschedule('process-reward-notifications');
  PERFORM cron.schedule('process-reward-notifications', '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(SELECT value FROM public.system_config WHERE key='cron_secret')
        ),
        body := '{}'::jsonb
      );
    $cmd$, base_url || '/api/public/hooks/process-reward-notifications'));

  PERFORM cron.unschedule('reconcile-payments-daily');
  PERFORM cron.schedule('reconcile-payments-daily', '15 3 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(SELECT value FROM public.system_config WHERE key='cron_secret')
        ),
        body := jsonb_build_object('lookbackDays', 7, 'maxPayments', 200)
      );
    $cmd$, base_url || '/api/public/hooks/reconcile-payments'));

  PERFORM cron.unschedule('run-reconciliation-6h');
  PERFORM cron.schedule('run-reconciliation-6h', '0 */6 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(SELECT value FROM public.system_config WHERE key='cron_secret')
        ),
        body := '{}'::jsonb
      );
    $cmd$, base_url || '/api/public/hooks/run-reconciliation'));
END $$;
