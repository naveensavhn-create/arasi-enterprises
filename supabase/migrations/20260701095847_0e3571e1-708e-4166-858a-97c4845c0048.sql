
CREATE TABLE public.membership_email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  template_name TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  error_message TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.membership_email_notifications TO authenticated;
GRANT ALL ON public.membership_email_notifications TO service_role;

ALTER TABLE public.membership_email_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read membership email notifications"
  ON public.membership_email_notifications
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_mem_email_notif_created_at
  ON public.membership_email_notifications (created_at DESC);

CREATE INDEX idx_mem_email_notif_membership
  ON public.membership_email_notifications (membership_id);

CREATE TRIGGER trg_mem_email_notif_updated_at
  BEFORE UPDATE ON public.membership_email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
