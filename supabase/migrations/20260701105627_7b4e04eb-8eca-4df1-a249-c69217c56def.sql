ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action = ANY (ARRAY['promote','revoke','role_change','bootstrap_claim','plan_delete_blocked','plan_delete_success']));
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON public.admin_audit_log (action, created_at DESC);