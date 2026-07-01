ALTER TABLE public.admin_audit_log ALTER COLUMN target_user_id DROP NOT NULL;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action = ANY (ARRAY[
  'promote','revoke','role_change','bootstrap_claim',
  'plan_delete_blocked','plan_delete_success',
  'user.revoked','user.restored','user.deleted',
  'user.password_reset_email','user.password_generated',
  'site_settings.updated'
]));