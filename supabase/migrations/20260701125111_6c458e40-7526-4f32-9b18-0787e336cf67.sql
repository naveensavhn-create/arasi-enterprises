-- Site settings singleton
CREATE TABLE public.site_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  brand_name TEXT NOT NULL DEFAULT 'ARASI Enterprises',
  tagline TEXT DEFAULT 'Advance Booking & Monthly Installment Membership',
  support_email TEXT,
  support_phone TEXT,
  primary_color TEXT NOT NULL DEFAULT '220 70% 25%',
  secondary_color TEXT NOT NULL DEFAULT '45 80% 55%',
  accent_color TEXT NOT NULL DEFAULT '45 80% 55%',
  heading_font TEXT NOT NULL DEFAULT 'Playfair Display',
  body_font TEXT NOT NULL DEFAULT 'Inter',
  logo_url TEXT,
  favicon_url TEXT,
  footer_text TEXT DEFAULT '© ARASI Enterprises. All rights reserved.',
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site settings public read" ON public.site_settings
  FOR SELECT USING (true);
CREATE POLICY "Admins manage site settings" ON public.site_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_site_settings_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the singleton row
INSERT INTO public.site_settings (id) VALUES ('00000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (id) DO NOTHING;

-- Admin user listing RPC
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  id UUID,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  role app_role,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  banned_until TIMESTAMPTZ,
  membership_number TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    u.phone::text,
    COALESCE(p.full_name, '')::text AS full_name,
    (SELECT ur.role FROM public.user_roles ur
       WHERE ur.user_id = u.id
       ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'promoter' THEN 2 WHEN 'customer' THEN 3 END
       LIMIT 1) AS role,
    u.created_at,
    u.last_sign_in_at,
    u.banned_until,
    (SELECT m.membership_number FROM public.memberships m
       WHERE m.customer_id = u.id
       ORDER BY m.created_at DESC LIMIT 1) AS membership_number
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- Count active admins (used by last-admin protection)
CREATE OR REPLACE FUNCTION public.count_active_admins()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role = 'admin'
    AND (u.banned_until IS NULL OR u.banned_until < now());
$$;

REVOKE ALL ON FUNCTION public.count_active_admins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_active_admins() TO authenticated;