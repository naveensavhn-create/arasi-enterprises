
CREATE TABLE public.role_email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID REFERENCES public.admin_audit_log(id) ON DELETE SET NULL,
  target_user_id UUID,
  recipient_email TEXT NOT NULL,
  template_name TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  error_message TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  triggered_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX role_email_notifications_created_at_idx
  ON public.role_email_notifications(created_at DESC);
CREATE INDEX role_email_notifications_target_idx
  ON public.role_email_notifications(target_user_id);

GRANT SELECT ON public.role_email_notifications TO authenticated;
GRANT ALL ON public.role_email_notifications TO service_role;

ALTER TABLE public.role_email_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read role email notifications"
  ON public.role_email_notifications
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER role_email_notifications_set_updated_at
  BEFORE UPDATE ON public.role_email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
