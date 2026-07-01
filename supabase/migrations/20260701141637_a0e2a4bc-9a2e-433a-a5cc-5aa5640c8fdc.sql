
CREATE OR REPLACE FUNCTION public.admin_set_kyc_decision(
  _user_id uuid,
  _approve boolean,
  _notes text DEFAULT NULL::text,
  _assign_role public.app_role DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_email TEXT;
  v_target_email TEXT;
  v_before public.kyc_status;
  v_before_notes TEXT;
  v_new public.kyc_status;
  v_action TEXT;
  v_role_before public.app_role;
  v_role_after  public.app_role;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _assign_role IS NOT NULL AND _assign_role = 'admin' THEN
    RAISE EXCEPTION 'Admin role cannot be granted through KYC approval';
  END IF;

  IF _assign_role IS NOT NULL AND NOT _approve THEN
    RAISE EXCEPTION 'Role can only be assigned when approving KYC';
  END IF;

  SELECT kyc_status, kyc_review_notes, email
    INTO v_before, v_before_notes, v_target_email
    FROM public.profiles WHERE id = _user_id;

  v_new := CASE WHEN _approve THEN 'approved'::public.kyc_status ELSE 'rejected'::public.kyc_status END;

  UPDATE public.profiles
     SET kyc_status = v_new,
         kyc_reviewed_at = now(),
         kyc_reviewed_by = v_actor,
         kyc_review_notes = _notes
   WHERE id = _user_id;

  -- Optional atomic role reassignment on approval
  SELECT ur.role INTO v_role_before
    FROM public.user_roles ur
   WHERE ur.user_id = _user_id
   ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'promoter' THEN 2 WHEN 'customer' THEN 3 END
   LIMIT 1;

  IF _assign_role IS NOT NULL AND _approve THEN
    -- Never touch existing admin role
    IF v_role_before = 'admin' THEN
      RAISE EXCEPTION 'Cannot change role of an admin user';
    END IF;

    -- Replace any non-admin roles with the assigned one
    DELETE FROM public.user_roles
     WHERE user_id = _user_id AND role <> 'admin';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _assign_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    v_role_after := _assign_role;
  ELSE
    v_role_after := v_role_before;
  END IF;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  v_action := CASE WHEN _approve THEN 'kyc.approved' ELSE 'kyc.rejected' END;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email,
     role_before, role_after, reason, metadata)
  VALUES (
    v_actor,
    v_actor_email,
    v_action,
    _user_id,
    v_target_email,
    v_role_before,
    v_role_after,
    _notes,
    jsonb_build_object(
      'kyc_status_before', v_before,
      'kyc_status_after', v_new,
      'notes_before', v_before_notes,
      'notes_after', _notes,
      'role_assigned', _assign_role,
      'reviewed_fields',
        CASE WHEN _assign_role IS NOT NULL AND _approve
             THEN ARRAY['kyc_status','kyc_reviewed_at','kyc_reviewed_by','kyc_review_notes','user_roles.role']
             ELSE ARRAY['kyc_status','kyc_reviewed_at','kyc_reviewed_by','kyc_review_notes'] END,
      'reviewed_at', now()
    )
  );

  -- If role changed as part of approval, also log a discrete role change entry
  IF _assign_role IS NOT NULL AND _approve AND v_role_before IS DISTINCT FROM v_role_after THEN
    INSERT INTO public.admin_audit_log
      (actor_id, actor_email, action, target_user_id, target_email,
       role_before, role_after, reason, metadata)
    VALUES (
      v_actor,
      v_actor_email,
      'role.assigned_via_kyc',
      _user_id,
      v_target_email,
      v_role_before,
      v_role_after,
      _notes,
      jsonb_build_object('source', 'kyc_approval')
    );
  END IF;
END $function$;
