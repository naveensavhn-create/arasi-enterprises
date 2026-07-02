
-- 1) Tighten draw_entries RLS: promoters may only see entries for their referred customers
DROP POLICY IF EXISTS "Customers view their own entries" ON public.draw_entries;

CREATE POLICY "Customers view their own entries"
ON public.draw_entries
FOR SELECT
TO authenticated
USING (
  customer_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Promoters view entries for their referrals"
ON public.draw_entries
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'promoter')
  AND EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.id = draw_entries.membership_id
      AND m.promoter_id = auth.uid()
  )
);

-- 2) Revoke EXECUTE from authenticated on backend-only worker/cron routines.
-- These are invoked exclusively via service_role (supabaseAdmin) from server routes.
REVOKE EXECUTE ON FUNCTION public.claim_due_kyc_email_jobs(integer)              FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_reward_notification_jobs(integer)    FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_reminder_jobs(integer)               FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_kyc_email_job(uuid, text, text, text, text, text, integer, jsonb)          FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_reminder_job(uuid, text, text, text, text, text, integer, jsonb)           FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_reward_notification_job(uuid, text, text, text, text, text, integer, jsonb) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.requeue_kyc_email_job(uuid)                    FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_reconciliation()                           FROM authenticated, anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_due_kyc_email_jobs(integer)              TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_reward_notification_jobs(integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_reminder_jobs(integer)               TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_kyc_email_job(uuid, text, text, text, text, text, integer, jsonb)          TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_reminder_job(uuid, text, text, text, text, text, integer, jsonb)           TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_reward_notification_job(uuid, text, text, text, text, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_kyc_email_job(uuid)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.run_reconciliation()                           TO service_role;
