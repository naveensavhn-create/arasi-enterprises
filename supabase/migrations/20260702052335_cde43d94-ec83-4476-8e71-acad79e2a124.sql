DROP FUNCTION IF EXISTS public.promoter_list_my_customers();

CREATE OR REPLACE FUNCTION public.promoter_list_my_customers()
 RETURNS TABLE(
   id uuid, email text, full_name text, phone text,
   address_line1 text, address_line2 text, city text, state text,
   postal_code text, country text, aadhaar_address text,
   has_aadhaar_docs boolean,
   has_aadhaar_number boolean,
   has_aadhaar_front boolean,
   kyc_status kyc_status, kyc_submitted_at timestamp with time zone,
   kyc_reviewed_at timestamp with time zone, kyc_review_notes text,
   created_at timestamp with time zone,
   membership_number text, membership_status text,
   member_display_id text, coupon_no text,
   plan_id uuid, plan_name text
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'promoter')
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.email, p.full_name, p.phone,
    p.address_line1, p.address_line2, p.city, p.state,
    p.postal_code, p.country, p.aadhaar_address,
    (p.aadhaar_number IS NOT NULL AND p.aadhaar_number <> ''
     AND p.aadhaar_front_url IS NOT NULL AND p.aadhaar_front_url <> '') AS has_aadhaar_docs,
    (p.aadhaar_number IS NOT NULL AND p.aadhaar_number <> '') AS has_aadhaar_number,
    (p.aadhaar_front_url IS NOT NULL AND p.aadhaar_front_url <> '') AS has_aadhaar_front,
    p.kyc_status, p.kyc_submitted_at, p.kyc_reviewed_at, p.kyc_review_notes, p.created_at,
    m.membership_number, m.status::text AS membership_status,
    m.member_display_id, m.coupon_no, m.plan_id, mp.name AS plan_name
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT membership_number, status, member_display_id, coupon_no, plan_id
      FROM public.memberships
     WHERE user_id = p.id
     ORDER BY created_at DESC LIMIT 1
  ) m ON TRUE
  LEFT JOIN public.membership_plans mp ON mp.id = m.plan_id
  WHERE p.referred_by_promoter_id = auth.uid()
  ORDER BY CASE WHEN p.kyc_status = 'pending' THEN 0 ELSE 1 END, p.created_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.promoter_list_my_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promoter_list_my_customers() TO authenticated;