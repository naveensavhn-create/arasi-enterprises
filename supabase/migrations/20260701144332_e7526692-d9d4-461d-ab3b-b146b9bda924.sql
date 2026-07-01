CREATE OR REPLACE FUNCTION public.admin_set_customer_promoter(_user_id uuid, _promoter_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_target_email text;
  v_before uuid;
  v_before_email text;
  v_after_email text;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _promoter_id IS NOT NULL
     AND NOT public.has_role(_promoter_id, 'promoter')
     AND NOT public.has_role(_promoter_id, 'admin') THEN
    RAISE EXCEPTION 'Selected user is not a promoter';
  END IF;

  SELECT referred_by_promoter_id, email
    INTO v_before, v_target_email
    FROM public.profiles WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  -- No-op: avoid audit noise
  IF v_before IS NOT DISTINCT FROM _promoter_id THEN
    RETURN;
  END IF;

  UPDATE public.profiles
     SET referred_by_promoter_id = _promoter_id
   WHERE id = _user_id;

  SELECT email INTO v_actor_email  FROM public.profiles WHERE id = v_actor;
  SELECT email INTO v_before_email FROM public.profiles WHERE id = v_before;
  SELECT email INTO v_after_email  FROM public.profiles WHERE id = _promoter_id;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor,
    v_actor_email,
    CASE
      WHEN v_before IS NULL AND _promoter_id IS NOT NULL THEN 'customer.promoter_assigned'
      WHEN v_before IS NOT NULL AND _promoter_id IS NULL THEN 'customer.promoter_cleared'
      ELSE 'customer.promoter_reassigned'
    END,
    _user_id,
    v_target_email,
    NULL,
    jsonb_build_object(
      'promoter_id_before', v_before,
      'promoter_id_after', _promoter_id,
      'promoter_email_before', v_before_email,
      'promoter_email_after', v_after_email,
      'changed_fields', ARRAY['referred_by_promoter_id'],
      'changed_at', now()
    )
  );
END;
$function$;