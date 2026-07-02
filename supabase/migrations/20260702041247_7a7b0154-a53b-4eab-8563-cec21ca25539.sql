
CREATE TABLE public.reminder_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel public.reminder_channel NOT NULL,
  reminder_kind TEXT NOT NULL CHECK (reminder_kind IN ('upcoming','overdue')),
  subject TEXT,
  heading TEXT,
  intro TEXT,
  outro TEXT,
  sms_greeting TEXT,
  sms_signature TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reminder_templates_active_uniq
  ON public.reminder_templates (channel, reminder_kind)
  WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_templates TO authenticated;
GRANT ALL ON public.reminder_templates TO service_role;

ALTER TABLE public.reminder_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage reminder templates"
  ON public.reminder_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_reminder_templates_set_updated_at
  BEFORE UPDATE ON public.reminder_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Security-definer reader for the background worker & test-send helper.
CREATE OR REPLACE FUNCTION public.get_active_reminder_template(
  _channel public.reminder_channel,
  _kind TEXT
) RETURNS public.reminder_templates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT *
    FROM public.reminder_templates
   WHERE channel = _channel
     AND reminder_kind = _kind
     AND is_active
   ORDER BY updated_at DESC
   LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_reminder_template(public.reminder_channel, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_reminder_template(public.reminder_channel, TEXT) TO authenticated, service_role;

-- Seed defaults matching current hardcoded copy.
INSERT INTO public.reminder_templates
  (channel, reminder_kind, subject, heading, intro, outro, sms_greeting, sms_signature)
VALUES
  ('email','upcoming',
   '[Arasi Enterprises] Gentle reminder — your monthly installment is coming up',
   'A gentle reminder about your upcoming payment',
   'This is a friendly reminder that your {{plan_name}} membership installment is coming up. No action is needed if you''ve already paid — otherwise, you can settle it in a couple of taps from your dashboard.',
   'Already paid in the last day or two? Please ignore this note — our records update shortly after your bank confirms. For anything else, reply to this email or write to {{support_email}}.',
   NULL, NULL),
  ('email','overdue',
   '[Arasi Enterprises] Your monthly installment is overdue',
   'Your installment is past due',
   'Our records show that your {{plan_name}} installment of {{amount}} was due on {{due_date}} and hasn''t been received yet. If you''ve already paid, please ignore this note — banks sometimes take a day or two to confirm.',
   'Need help or a payment link? Reply to this email or write to {{support_email}} and we''ll sort it out with you.',
   NULL, NULL),
  ('sms','upcoming',
   NULL, NULL, NULL, NULL,
   'Dear',
   'Team Arasi'),
  ('sms','overdue',
   NULL, NULL, NULL, NULL,
   'Dear',
   'Team Arasi');
