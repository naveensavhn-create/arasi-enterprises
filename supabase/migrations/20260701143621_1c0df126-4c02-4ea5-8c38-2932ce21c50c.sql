-- Promoter-driven referral submission workflow.
-- Lets a promoter submit a referred customer for admin KYC review when the
-- customer has provided the minimum required information (Aadhaar number +
-- at least the front document). Records the transition in admin_audit_log.

CREATE OR REPLACE FUNCTION public.promoter_submit_referral_for_review(
  _user_id uuid,
  _note text DEFAULT NULL
)
RETURNS public.kyc_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_is_admin boolean;
  v_row public.profiles%ROWTYPE;
  v_before public.kyc_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin');
  IF NOT v_is_admin AND NOT public.has_role(v_actor, 'promoter') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF NOT v_is_admin AND v_row.referred_by_promoter_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'This customer was not referred by you' USING ERRCODE = '42501';
  END IF;

  IF v_row.kyc_status = 'approved' THEN
    RAISE EXCEPTION 'Customer is already approved';
  END IF;
  IF v_row.kyc_status = 'pending' THEN
    RAISE EXCEPTION 'Customer is already under review';
  END IF;

  IF v_row.aadhaar_number IS NULL OR v_row.aadhaar_number = ''
     OR v_row.aadhaar_front_url IS NULL OR v_row.aadhaar_front_url = '' THEN
    RAISE EXCEPTION 'Customer must upload Aadhaar number and front document before submission';
  END IF;

  v_before := v_row.kyc_status;

  UPDATE public.profiles
     SET kyc_status = 'pending',
         kyc_submitted_at = now(),
         kyc_reviewed_at = NULL,
         kyc_reviewed_by = NULL,
         kyc_review_notes = NULLIF(_note, '')
   WHERE id = _user_id;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor,
    v_actor_email,
    'kyc.submitted_by_promoter',
    _user_id,
    v_row.email,
    _note,
    jsonb_build_object(
      'kyc_status_before', v_before,
      'kyc_status_after', 'pending',
      'submitted_by_role', CASE WHEN v_is_admin THEN 'admin' ELSE 'promoter' END,
      'referred_by_promoter_id', v_row.referred_by_promoter_id
    )
  );

  RETURN 'pending'::public.kyc_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promoter_submit_referral_for_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promoter_submit_referral_for_review(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.promoter_submit_referral_for_review(uuid, text) IS
  'Promoter (or admin) submits a referred customer for admin KYC review. Requires Aadhaar number + front document. Transitions kyc_status: unsubmitted|rejected → pending. Logs to admin_audit_log with action=kyc.submitted_by_promoter.';
