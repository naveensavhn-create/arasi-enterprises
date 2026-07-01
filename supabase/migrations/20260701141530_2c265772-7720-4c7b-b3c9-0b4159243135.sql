
CREATE OR REPLACE FUNCTION public.admin_set_kyc_decision(_user_id uuid, _approve boolean, _notes text DEFAULT NULL::text)
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
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
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

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  v_action := CASE WHEN _approve THEN 'kyc.approved' ELSE 'kyc.rejected' END;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor,
    v_actor_email,
    v_action,
    _user_id,
    v_target_email,
    _notes,
    jsonb_build_object(
      'kyc_status_before', v_before,
      'kyc_status_after', v_new,
      'notes_before', v_before_notes,
      'notes_after', _notes,
      'reviewed_fields', ARRAY['kyc_status','kyc_reviewed_at','kyc_reviewed_by','kyc_review_notes'],
      'reviewed_at', now()
    )
  );
END $function$;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action ~ '^[a-z_]+(\.[a-z_]+)*$');
