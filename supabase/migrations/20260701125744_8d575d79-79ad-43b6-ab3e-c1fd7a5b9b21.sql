
DO $$ BEGIN
  CREATE TYPE public.kyc_status AS ENUM ('unsubmitted','pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS aadhaar_number TEXT,
  ADD COLUMN IF NOT EXISTS aadhaar_address TEXT,
  ADD COLUMN IF NOT EXISTS aadhaar_front_url TEXT,
  ADD COLUMN IF NOT EXISTS aadhaar_back_url TEXT,
  ADD COLUMN IF NOT EXISTS kyc_status public.kyc_status NOT NULL DEFAULT 'unsubmitted',
  ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS kyc_review_notes TEXT;

CREATE OR REPLACE FUNCTION public.validate_profile_aadhaar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.aadhaar_number IS NOT NULL AND NEW.aadhaar_number <> '' THEN
    IF NEW.aadhaar_number !~ '^[0-9]{12}$' THEN
      RAISE EXCEPTION 'Aadhaar number must be exactly 12 digits';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_profile_aadhaar ON public.profiles;
CREATE TRIGGER trg_validate_profile_aadhaar
  BEFORE INSERT OR UPDATE OF aadhaar_number ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_aadhaar();

CREATE OR REPLACE FUNCTION public.guard_profile_kyc_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.kyc_reviewed_at IS DISTINCT FROM OLD.kyc_reviewed_at
     OR NEW.kyc_reviewed_by IS DISTINCT FROM OLD.kyc_reviewed_by
     OR NEW.kyc_review_notes IS DISTINCT FROM OLD.kyc_review_notes THEN
    RAISE EXCEPTION 'Only admins can modify KYC review fields';
  END IF;
  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
    IF NEW.kyc_status = 'approved' THEN
      RAISE EXCEPTION 'Only admins can approve KYC';
    END IF;
    IF NEW.kyc_status = 'rejected' AND OLD.kyc_status <> 'rejected' THEN
      RAISE EXCEPTION 'Only admins can reject KYC';
    END IF;
    IF NEW.kyc_status = 'pending' THEN
      NEW.kyc_submitted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_profile_kyc ON public.profiles;
CREATE TRIGGER trg_guard_profile_kyc
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_kyc_columns();

CREATE OR REPLACE FUNCTION public.admin_list_kyc(_status text DEFAULT NULL)
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, phone TEXT, role app_role,
  address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT,
  aadhaar_number TEXT, aadhaar_address TEXT, aadhaar_front_url TEXT, aadhaar_back_url TEXT,
  kyc_status public.kyc_status, kyc_submitted_at TIMESTAMPTZ, kyc_reviewed_at TIMESTAMPTZ, kyc_review_notes TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    p.kyc_status, p.kyc_submitted_at, p.kyc_reviewed_at, p.kyc_review_notes
  FROM public.profiles p
  WHERE (_status IS NULL OR p.kyc_status::text = _status)
  ORDER BY CASE WHEN p.kyc_status = 'pending' THEN 0 ELSE 1 END,
           p.kyc_submitted_at DESC NULLS LAST, p.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_kyc_decision(
  _user_id UUID, _approve BOOLEAN, _notes TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET kyc_status = CASE WHEN _approve THEN 'approved'::public.kyc_status ELSE 'rejected'::public.kyc_status END,
         kyc_reviewed_at = now(),
         kyc_reviewed_by = auth.uid(),
         kyc_review_notes = _notes
   WHERE id = _user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_list_kyc(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_kyc_decision(uuid, boolean, text) TO authenticated;

DROP POLICY IF EXISTS "KYC users read own" ON storage.objects;
CREATE POLICY "KYC users read own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kyc-documents' AND (auth.uid()::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "KYC users upload own" ON storage.objects;
CREATE POLICY "KYC users upload own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kyc-documents' AND (auth.uid()::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "KYC users update own" ON storage.objects;
CREATE POLICY "KYC users update own" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'kyc-documents' AND (auth.uid()::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "KYC users delete own" ON storage.objects;
CREATE POLICY "KYC users delete own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'kyc-documents' AND (auth.uid()::text = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "KYC admins read all" ON storage.objects;
CREATE POLICY "KYC admins read all" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kyc-documents' AND public.has_role(auth.uid(), 'admin'));
