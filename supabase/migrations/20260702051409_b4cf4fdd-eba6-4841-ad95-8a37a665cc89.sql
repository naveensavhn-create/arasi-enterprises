
-- 1. Customer sequential display IDs
CREATE SEQUENCE IF NOT EXISTS public.customer_display_id_seq
  START WITH 1001 INCREMENT BY 1 MINVALUE 1001 NO CYCLE;

CREATE TABLE IF NOT EXISTS public.customer_ids (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_id  INTEGER NOT NULL UNIQUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.customer_ids TO authenticated;
GRANT ALL   ON public.customer_ids TO service_role;
ALTER TABLE public.customer_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own customer id" ON public.customer_ids;
CREATE POLICY "Users read own customer id" ON public.customer_ids
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'customer'
       AND NOT EXISTS (SELECT 1 FROM public.customer_ids c WHERE c.user_id = ur.user_id)
     ORDER BY p.created_at ASC, ur.user_id ASC
  LOOP
    INSERT INTO public.customer_ids (user_id, display_id)
    VALUES (r.user_id, nextval('public.customer_display_id_seq'));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.assign_customer_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'customer' AND NOT EXISTS (
    SELECT 1 FROM public.customer_ids WHERE user_id = NEW.user_id
  ) THEN
    INSERT INTO public.customer_ids (user_id, display_id)
    VALUES (NEW.user_id, nextval('public.customer_display_id_seq'))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assign_customer_display_id ON public.user_roles;
CREATE TRIGGER trg_assign_customer_display_id
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.assign_customer_display_id();

-- 2. Promoter IDs + referral codes
CREATE TABLE IF NOT EXISTS public.promoter_ids (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_id    CHAR(5) NOT NULL UNIQUE,
  referral_code TEXT    NOT NULL UNIQUE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promoter_display_id_digits CHECK (display_id ~ '^[0-9]{5}$'),
  CONSTRAINT promoter_referral_code_format CHECK (referral_code ~ '^[A-Za-z0-9]{8,16}$')
);
GRANT SELECT ON public.promoter_ids TO authenticated;
GRANT ALL   ON public.promoter_ids TO service_role;
ALTER TABLE public.promoter_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own promoter id" ON public.promoter_ids;
CREATE POLICY "Users read own promoter id" ON public.promoter_ids
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.allocate_promoter_credentials(_user_id UUID)
RETURNS public.promoter_ids
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row  public.promoter_ids%ROWTYPE;
  v_try  INT;
  v_did  CHAR(5);
  v_code TEXT;
BEGIN
  SELECT * INTO v_row FROM public.promoter_ids WHERE user_id = _user_id;
  IF FOUND THEN RETURN v_row; END IF;

  FOR v_try IN 1..25 LOOP
    v_did := lpad((10000 + floor(random() * 90000))::int::text, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.promoter_ids WHERE display_id = v_did);
  END LOOP;

  FOR v_try IN 1..25 LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || _user_id::text), 1, 10));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.promoter_ids WHERE referral_code = v_code);
  END LOOP;

  INSERT INTO public.promoter_ids (user_id, display_id, referral_code)
  VALUES (_user_id, v_did, v_code)
  ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE EXECUTE ON FUNCTION public.allocate_promoter_credentials(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allocate_promoter_credentials(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.assign_promoter_credentials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'promoter' THEN
    PERFORM public.allocate_promoter_credentials(NEW.user_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assign_promoter_credentials ON public.user_roles;
CREATE TRIGGER trg_assign_promoter_credentials
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.assign_promoter_credentials();

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
     WHERE ur.role = 'promoter'
       AND NOT EXISTS (SELECT 1 FROM public.promoter_ids pi WHERE pi.user_id = ur.user_id)
  LOOP
    PERFORM public.allocate_promoter_credentials(r.user_id);
  END LOOP;
END $$;

-- 3. apply_referral_code
CREATE OR REPLACE FUNCTION public.apply_referral_code(_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_promoter UUID;
  v_current  UUID;
  v_email    TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _code IS NULL OR length(btrim(_code)) = 0 THEN RETURN NULL; END IF;

  SELECT user_id INTO v_promoter FROM public.promoter_ids
   WHERE referral_code = btrim(_code) LIMIT 1;
  IF v_promoter IS NULL OR v_promoter = v_uid THEN RETURN NULL; END IF;

  SELECT referred_by_promoter_id, email INTO v_current, v_email
    FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_current IS NOT NULL THEN RETURN v_current; END IF;

  UPDATE public.profiles SET referred_by_promoter_id = v_promoter WHERE id = v_uid;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_uid, v_email, 'customer.referral_applied', v_uid, v_email,
    'Referral code applied at signup',
    jsonb_build_object('promoter_id', v_promoter, 'source', 'link', 'code', btrim(_code))
  );
  RETURN v_promoter;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_referral_code(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated;

-- 4. plan_is_deletable
CREATE OR REPLACE FUNCTION public.plan_is_deletable(_plan_id UUID)
RETURNS TABLE(deletable BOOLEAN, blocking_count INTEGER, active_count INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_blocking INTEGER; v_active INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_blocking FROM public.memberships WHERE plan_id = _plan_id;
  SELECT count(*) INTO v_active   FROM public.memberships WHERE plan_id = _plan_id AND status IN ('pending','active');
  RETURN QUERY SELECT (v_active = 0), v_blocking, v_active;
END $$;
REVOKE EXECUTE ON FUNCTION public.plan_is_deletable(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plan_is_deletable(UUID) TO authenticated;

-- 5. admin_update_profile
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  _user_id UUID,
  _full_name TEXT DEFAULT NULL, _email TEXT DEFAULT NULL, _phone TEXT DEFAULT NULL,
  _address_line1 TEXT DEFAULT NULL, _address_line2 TEXT DEFAULT NULL,
  _city TEXT DEFAULT NULL, _state TEXT DEFAULT NULL,
  _postal_code TEXT DEFAULT NULL, _country TEXT DEFAULT NULL,
  _aadhaar_number TEXT DEFAULT NULL, _aadhaar_address TEXT DEFAULT NULL,
  _referred_by UUID DEFAULT NULL, _clear_referrer BOOLEAN DEFAULT FALSE,
  _reason TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_email TEXT;
  v_before public.profiles%ROWTYPE;
  v_changed TEXT[] := ARRAY[]::TEXT[];
  v_before_j JSONB; v_after_j JSONB;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_before FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF _full_name       IS NOT NULL AND _full_name       IS DISTINCT FROM v_before.full_name       THEN v_changed := v_changed || 'full_name'; END IF;
  IF _email           IS NOT NULL AND _email           IS DISTINCT FROM v_before.email           THEN v_changed := v_changed || 'email'; END IF;
  IF _phone           IS NOT NULL AND _phone           IS DISTINCT FROM v_before.phone           THEN v_changed := v_changed || 'phone'; END IF;
  IF _address_line1   IS NOT NULL AND _address_line1   IS DISTINCT FROM v_before.address_line1   THEN v_changed := v_changed || 'address_line1'; END IF;
  IF _address_line2   IS NOT NULL AND _address_line2   IS DISTINCT FROM v_before.address_line2   THEN v_changed := v_changed || 'address_line2'; END IF;
  IF _city            IS NOT NULL AND _city            IS DISTINCT FROM v_before.city            THEN v_changed := v_changed || 'city'; END IF;
  IF _state           IS NOT NULL AND _state           IS DISTINCT FROM v_before.state           THEN v_changed := v_changed || 'state'; END IF;
  IF _postal_code     IS NOT NULL AND _postal_code     IS DISTINCT FROM v_before.postal_code     THEN v_changed := v_changed || 'postal_code'; END IF;
  IF _country         IS NOT NULL AND _country         IS DISTINCT FROM v_before.country         THEN v_changed := v_changed || 'country'; END IF;
  IF _aadhaar_number  IS NOT NULL AND _aadhaar_number  IS DISTINCT FROM v_before.aadhaar_number  THEN v_changed := v_changed || 'aadhaar_number'; END IF;
  IF _aadhaar_address IS NOT NULL AND _aadhaar_address IS DISTINCT FROM v_before.aadhaar_address THEN v_changed := v_changed || 'aadhaar_address'; END IF;
  IF _clear_referrer AND v_before.referred_by_promoter_id IS NOT NULL THEN
    v_changed := v_changed || 'referred_by_promoter_id';
  ELSIF _referred_by IS NOT NULL AND _referred_by IS DISTINCT FROM v_before.referred_by_promoter_id THEN
    v_changed := v_changed || 'referred_by_promoter_id';
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN RETURN; END IF;

  UPDATE public.profiles SET
    full_name       = COALESCE(_full_name,       full_name),
    email           = COALESCE(_email,           email),
    phone           = COALESCE(_phone,           phone),
    address_line1   = COALESCE(_address_line1,   address_line1),
    address_line2   = COALESCE(_address_line2,   address_line2),
    city            = COALESCE(_city,            city),
    state           = COALESCE(_state,           state),
    postal_code     = COALESCE(_postal_code,     postal_code),
    country         = COALESCE(_country,         country),
    aadhaar_number  = COALESCE(_aadhaar_number,  aadhaar_number),
    aadhaar_address = COALESCE(_aadhaar_address, aadhaar_address),
    referred_by_promoter_id = CASE
      WHEN _clear_referrer THEN NULL
      WHEN _referred_by IS NOT NULL THEN _referred_by
      ELSE referred_by_promoter_id
    END,
    updated_at = now()
  WHERE id = _user_id;

  v_before_j := to_jsonb(v_before);
  SELECT to_jsonb(p) INTO v_after_j FROM public.profiles p WHERE id = _user_id;
  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor, v_actor_email, 'profile.edited_by_admin', _user_id, v_before.email, _reason,
    jsonb_build_object(
      'changed_fields', v_changed,
      'before', v_before_j - 'aadhaar_front_url' - 'aadhaar_back_url',
      'after',  v_after_j  - 'aadhaar_front_url' - 'aadhaar_back_url',
      'aadhaar_edited', ('aadhaar_number' = ANY(v_changed) OR 'aadhaar_address' = ANY(v_changed))
    )
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_update_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_profile(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BOOLEAN,TEXT) TO authenticated;

-- 6. Extended admin_list_users
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  id UUID, email TEXT, phone TEXT, full_name TEXT, role app_role,
  created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, banned_until TIMESTAMPTZ,
  membership_number TEXT,
  customer_display_id INTEGER,
  promoter_display_id CHAR(5),
  promoter_referral_code TEXT,
  kyc_status kyc_status
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id, u.email::text, u.phone::text,
    COALESCE(p.full_name, '')::text,
    (SELECT ur.role FROM public.user_roles ur
       WHERE ur.user_id = u.id
       ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'promoter' THEN 2 WHEN 'customer' THEN 3 END
       LIMIT 1),
    u.created_at, u.last_sign_in_at, u.banned_until,
    (SELECT m.membership_number FROM public.memberships m
       WHERE m.user_id = u.id
       ORDER BY m.created_at DESC LIMIT 1),
    ci.display_id, pi.display_id, pi.referral_code, p.kyc_status
  FROM auth.users u
  LEFT JOIN public.profiles     p  ON p.id       = u.id
  LEFT JOIN public.customer_ids ci ON ci.user_id = u.id
  LEFT JOIN public.promoter_ids pi ON pi.user_id = u.id
  ORDER BY u.created_at DESC;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
