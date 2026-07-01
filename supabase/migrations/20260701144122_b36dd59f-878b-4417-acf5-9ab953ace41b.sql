CREATE OR REPLACE FUNCTION public.promoter_register_referred_customer(
  _user_id uuid,
  _full_name text,
  _email text,
  _phone text DEFAULT NULL,
  _address_line1 text DEFAULT NULL,
  _address_line2 text DEFAULT NULL,
  _city text DEFAULT NULL,
  _state text DEFAULT NULL,
  _postal_code text DEFAULT NULL,
  _country text DEFAULT NULL,
  _referral_note text DEFAULT NULL,
  _referral_source text DEFAULT NULL,
  _promoter_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_is_admin boolean;
  v_is_promoter boolean;
  v_effective_promoter uuid;
  v_existing_ref uuid;
  v_target public.profiles%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin');
  v_is_promoter := public.has_role(v_actor, 'promoter');

  IF NOT v_is_admin AND NOT v_is_promoter THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Only admins may explicitly assign a promoter other than themselves.
  IF _promoter_id IS NOT NULL AND _promoter_id <> v_actor AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can assign a different promoter' USING ERRCODE = '42501';
  END IF;

  v_effective_promoter := COALESCE(_promoter_id, v_actor);

  IF NOT public.has_role(v_effective_promoter, 'promoter')
     AND NOT public.has_role(v_effective_promoter, 'admin') THEN
    RAISE EXCEPTION 'Selected user is not a promoter';
  END IF;

  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found (auth user must exist first)';
  END IF;

  v_existing_ref := v_target.referred_by_promoter_id;

  -- Enforce single-referrer immutability for non-admins.
  IF v_existing_ref IS NOT NULL
     AND v_existing_ref <> v_effective_promoter
     AND NOT v_is_admin THEN
    RAISE EXCEPTION 'This customer is already referred by another promoter';
  END IF;

  UPDATE public.profiles
     SET full_name = btrim(_full_name),
         email = COALESCE(NULLIF(btrim(_email), ''), email),
         phone = COALESCE(NULLIF(btrim(_phone), ''), phone),
         address_line1 = COALESCE(NULLIF(btrim(_address_line1), ''), address_line1),
         address_line2 = COALESCE(NULLIF(btrim(_address_line2), ''), address_line2),
         city = COALESCE(NULLIF(btrim(_city), ''), city),
         state = COALESCE(NULLIF(btrim(_state), ''), state),
         postal_code = COALESCE(NULLIF(btrim(_postal_code), ''), postal_code),
         country = COALESCE(NULLIF(btrim(_country), ''), country),
         referred_by_promoter_id = v_effective_promoter
   WHERE id = _user_id;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor,
    v_actor_email,
    'customer.registered_by_promoter',
    _user_id,
    COALESCE(NULLIF(btrim(_email), ''), v_target.email),
    NULLIF(btrim(_referral_note), ''),
    jsonb_build_object(
      'promoter_id', v_effective_promoter,
      'previous_referred_by', v_existing_ref,
      'assigned_by_role', CASE WHEN v_is_admin AND v_effective_promoter <> v_actor THEN 'admin' ELSE 'promoter' END,
      'referral_source', NULLIF(btrim(_referral_source), ''),
      'referral_note', NULLIF(btrim(_referral_note), ''),
      'set_fields', ARRAY['full_name','email','phone','address_line1','address_line2','city','state','postal_code','country','referred_by_promoter_id']
    )
  );

  RETURN _user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.promoter_register_referred_customer(
  uuid, text, text, text, text, text, text, text, text, text, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promoter_register_referred_customer(
  uuid, text, text, text, text, text, text, text, text, text, text, text, uuid
) TO authenticated, service_role;