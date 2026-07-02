
-- =========================================================================
-- Verification Settings Module
-- =========================================================================

-- 1. verification_settings ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_type TEXT NOT NULL UNIQUE
    CHECK (verification_type IN ('mobile_otp','email')),
  provider TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  requirement TEXT NOT NULL DEFAULT 'optional'
    CHECK (requirement IN ('mandatory','optional','disabled')),
  sandbox_mode BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials BYTEA,
  last_test_at TIMESTAMPTZ,
  last_test_status TEXT
    CHECK (last_test_status IS NULL OR last_test_status IN ('success','failure')),
  last_test_message TEXT,
  last_test_latency_ms INTEGER,
  last_success_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_settings TO authenticated;
GRANT ALL ON public.verification_settings TO service_role;

ALTER TABLE public.verification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view verification settings"
  ON public.verification_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert verification settings"
  ON public.verification_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update verification settings"
  ON public.verification_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete verification settings"
  ON public.verification_settings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_verification_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_verification_settings_updated_at
  BEFORE UPDATE ON public.verification_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_verification_settings_updated_at();

-- Seed defaults (idempotent).
INSERT INTO public.verification_settings (verification_type, provider, enabled, requirement)
VALUES
  ('mobile_otp', 'msg91', false, 'optional'),
  ('email',      'resend', false, 'optional')
ON CONFLICT (verification_type) DO NOTHING;

-- 2. verification_flow_steps -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_flow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_flow_steps TO authenticated;
GRANT ALL ON public.verification_flow_steps TO service_role;

ALTER TABLE public.verification_flow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view flow steps"
  ON public.verification_flow_steps FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can modify flow steps"
  ON public.verification_flow_steps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_flow_steps_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_flow_steps_updated_at
  BEFORE UPDATE ON public.verification_flow_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_flow_steps_updated_at();

INSERT INTO public.verification_flow_steps (step_key, label, position, enabled, is_system)
VALUES
  ('customer_registration', 'Customer Registration', 10, true,  true),
  ('mobile_otp',            'Mobile OTP Verification', 20, true,  false),
  ('email_verification',    'Email Verification',      30, true,  false),
  ('admin_approval',        'Admin Approval',          40, true,  true),
  ('membership_activated',  'Membership Activated',    50, true,  true)
ON CONFLICT (step_key) DO NOTHING;

-- 3. profiles verification stamps -------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_verification_provider TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_provider TEXT,
  ADD COLUMN IF NOT EXISTS mobile_verification_ref TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_ref TEXT;
