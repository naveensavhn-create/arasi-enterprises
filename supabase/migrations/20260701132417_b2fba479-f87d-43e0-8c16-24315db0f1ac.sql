
-- 1. Add the referring-promoter column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by_promoter_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_promoter
  ON public.profiles(referred_by_promoter_id);

-- 2. Guard trigger: only admins may change referred_by_promoter_id after it's set.
--    (A promoter cannot re-assign a customer to themselves silently.)
CREATE OR REPLACE FUNCTION public.guard_profile_referrer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referred_by_promoter_id IS DISTINCT FROM OLD.referred_by_promoter_id THEN
    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;
    -- Non-admins may only set referrer when previously NULL (initial link during registration).
    IF OLD.referred_by_promoter_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only admins can change the referring promoter';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_referrer ON public.profiles;
CREATE TRIGGER trg_guard_profile_referrer
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_referrer();

-- 3. Promoter-scoped listing of referred customers.
--    IMPORTANT: intentionally OMITS aadhaar_number, aadhaar_front_url, aadhaar_back_url.
CREATE OR REPLACE FUNCTION public.promoter_list_my_customers()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  aadhaar_address TEXT,
  kyc_status public.kyc_status,
  kyc_submitted_at TIMESTAMPTZ,
  kyc_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  membership_number TEXT,
  membership_status TEXT,
  member_display_id TEXT,
  coupon_no TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'promoter')
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.address_line1,
    p.address_line2,
    p.city,
    p.state,
    p.postal_code,
    p.country,
    p.aadhaar_address,
    p.kyc_status,
    p.kyc_submitted_at,
    p.kyc_reviewed_at,
    p.created_at,
    m.membership_number,
    m.status::text AS membership_status,
    m.member_display_id,
    m.coupon_no
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT membership_number, status, member_display_id, coupon_no
      FROM public.memberships
     WHERE user_id = p.id
     ORDER BY created_at DESC
     LIMIT 1
  ) m ON TRUE
  WHERE p.referred_by_promoter_id = auth.uid()
  ORDER BY
    CASE WHEN p.kyc_status = 'pending' THEN 0 ELSE 1 END,
    p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.promoter_list_my_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promoter_list_my_customers() TO authenticated;

-- 4. Admin: change a customer's referring promoter.
CREATE OR REPLACE FUNCTION public.admin_set_customer_promoter(
  _user_id UUID,
  _promoter_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _promoter_id IS NOT NULL
     AND NOT public.has_role(_promoter_id, 'promoter')
     AND NOT public.has_role(_promoter_id, 'admin') THEN
    RAISE EXCEPTION 'Selected user is not a promoter';
  END IF;

  UPDATE public.profiles
     SET referred_by_promoter_id = _promoter_id
   WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_customer_promoter(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_promoter(UUID, UUID) TO authenticated;

-- 5. Admin promoter directory (id + display name) for pickers.
CREATE OR REPLACE FUNCTION public.admin_list_promoters()
RETURNS TABLE (id UUID, full_name TEXT, email TEXT)
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
  SELECT p.id, COALESCE(p.full_name, '') AS full_name, p.email
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
   WHERE ur.role = 'promoter'
   ORDER BY p.full_name NULLS LAST, p.email;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_promoters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_promoters() TO authenticated;

-- 6. Extend admin_list_kyc with referring-promoter info.
DROP FUNCTION IF EXISTS public.admin_list_kyc(text);
CREATE OR REPLACE FUNCTION public.admin_list_kyc(_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  phone text,
  role public.app_role,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  aadhaar_number text,
  aadhaar_address text,
  aadhaar_front_url text,
  aadhaar_back_url text,
  kyc_status public.kyc_status,
  kyc_submitted_at timestamptz,
  kyc_reviewed_at timestamptz,
  kyc_review_notes text,
  referred_by_promoter_id uuid,
  referred_by_name text,
  referred_by_email text
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
  SELECT p.id, p.email, p.full_name, p.phone,
    (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = p.id
       ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'promoter' THEN 2 WHEN 'customer' THEN 3 END LIMIT 1) AS role,
    p.address_line1, p.address_line2, p.city, p.state, p.postal_code, p.country,
    p.aadhaar_number, p.aadhaar_address, p.aadhaar_front_url, p.aadhaar_back_url,
    p.kyc_status, p.kyc_submitted_at, p.kyc_reviewed_at, p.kyc_review_notes,
    p.referred_by_promoter_id,
    rp.full_name AS referred_by_name,
    rp.email AS referred_by_email
  FROM public.profiles p
  LEFT JOIN public.profiles rp ON rp.id = p.referred_by_promoter_id
  WHERE (_status IS NULL OR p.kyc_status::text = _status)
  ORDER BY CASE WHEN p.kyc_status = 'pending' THEN 0 ELSE 1 END,
           p.kyc_submitted_at DESC NULLS LAST, p.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_kyc(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_kyc(text) TO authenticated;
