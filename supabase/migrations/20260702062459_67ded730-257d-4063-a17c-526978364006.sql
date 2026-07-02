
CREATE OR REPLACE FUNCTION public.admin_update_commission_status(
  _id uuid, _status text, _reference text DEFAULT NULL::text, _remarks text DEFAULT NULL::text
) RETURNS public.promoter_commissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_before public.promoter_commissions%ROWTYPE;
  v_after  public.promoter_commissions%ROWTYPE;
  v_valid  boolean := false;
BEGIN
  IF NOT public.has_role(v_actor,'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  IF _status NOT IN ('pending','approved','paid','rejected') THEN
    RAISE EXCEPTION 'Invalid status: %', _status;
  END IF;

  SELECT * INTO v_before FROM public.promoter_commissions WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission not found'; END IF;

  -- No-op transitions are silently allowed
  IF v_before.status = _status THEN
    v_valid := true;
  ELSE
    -- Workflow: pending → approved|rejected; approved → paid|pending|rejected;
    --           rejected → pending; paid is terminal.
    v_valid := CASE v_before.status
      WHEN 'pending'  THEN _status IN ('approved','rejected')
      WHEN 'approved' THEN _status IN ('paid','pending','rejected')
      WHEN 'rejected' THEN _status = 'pending'
      WHEN 'paid'     THEN false
      ELSE false
    END;
  END IF;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Illegal transition: % → %', v_before.status, _status;
  END IF;

  IF _status = 'paid'
     AND COALESCE(NULLIF(btrim(COALESCE(_reference, v_before.paid_reference, '')), ''), '') = '' THEN
    RAISE EXCEPTION 'Payment reference is required when marking as paid';
  END IF;

  UPDATE public.promoter_commissions SET
    status         = _status,
    approved_by    = CASE WHEN _status IN ('approved','paid') THEN v_actor ELSE approved_by END,
    approved_at    = CASE WHEN _status IN ('approved','paid') AND approved_at IS NULL THEN now() ELSE approved_at END,
    paid_at        = CASE WHEN _status='paid' THEN COALESCE(paid_at, now())
                          WHEN _status='pending' THEN NULL
                          ELSE paid_at END,
    paid_reference = CASE WHEN _status='paid' THEN COALESCE(_reference, paid_reference)
                          WHEN _status='pending' THEN NULL
                          ELSE COALESCE(_reference, paid_reference) END,
    remarks        = COALESCE(_remarks, remarks),
    updated_at     = now()
  WHERE id = _id
  RETURNING * INTO v_after;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor, v_actor_email,
    'commission.status_changed',
    v_after.promoter_id,
    (SELECT email FROM public.profiles WHERE id = v_after.promoter_id),
    NULLIF(btrim(COALESCE(_remarks,'')), ''),
    jsonb_build_object(
      'commission_id',   v_after.id,
      'ledger_number',   v_after.ledger_number,
      'status_before',   v_before.status,
      'status_after',    v_after.status,
      'commission_amount', v_after.commission_amount,
      'payment_id',      v_after.payment_id,
      'paid_reference',  v_after.paid_reference
    )
  );

  -- In-app notification for the promoter on meaningful transitions
  IF v_before.status <> v_after.status THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
    VALUES (
      v_after.promoter_id,
      'commission_status',
      CASE v_after.status
        WHEN 'approved' THEN 'Commission approved'
        WHEN 'paid'     THEN 'Commission paid out'
        WHEN 'rejected' THEN 'Commission rejected'
        WHEN 'pending'  THEN 'Commission re-opened'
      END,
      'Ledger ' || v_after.ledger_number || ' — ₹' || v_after.commission_amount ||
        CASE WHEN v_after.status='paid' AND v_after.paid_reference IS NOT NULL
             THEN ' (Ref: ' || v_after.paid_reference || ')' ELSE '' END,
      '/promoter/commissions',
      jsonb_build_object('commission_id', v_after.id, 'status', v_after.status)
    );
  END IF;

  RETURN v_after;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_update_commission_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_commission_status(uuid, text, text, text) TO authenticated, service_role;
