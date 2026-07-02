
CREATE OR REPLACE FUNCTION public.admin_update_reward_status(
  _reward_id UUID, _new_status TEXT, _admin_note TEXT, _tracking TEXT
) RETURNS public.customer_rewards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.customer_rewards;
  ns public.reward_claim_status;
  allowed BOOLEAN := FALSE;
  note TEXT := NULLIF(_admin_note, '');
  trk  TEXT := NULLIF(_tracking, '');
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.customer_rewards WHERE id = _reward_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REWARD_NOT_FOUND'; END IF;
  ns := _new_status::public.reward_claim_status;

  IF r.status = 'requested' AND ns IN ('approved','rejected') THEN allowed := TRUE;
  ELSIF r.status = 'approved' AND ns IN ('dispatched','rejected') THEN allowed := TRUE;
  ELSIF r.status = 'dispatched' AND ns IN ('delivered') THEN allowed := TRUE;
  ELSIF r.status = 'eligible' AND ns = 'rejected' THEN allowed := TRUE;
  ELSIF r.status = 'rejected' AND ns = 'eligible' THEN allowed := TRUE;
  END IF;

  IF NOT allowed THEN RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', r.status, ns; END IF;

  UPDATE public.customer_rewards
     SET status = ns,
         admin_note = COALESCE(note, admin_note),
         tracking_reference = COALESCE(trk, tracking_reference),
         reviewed_by = auth.uid(),
         approved_at = CASE WHEN ns='approved' THEN now() ELSE approved_at END,
         dispatched_at = CASE WHEN ns='dispatched' THEN now() ELSE dispatched_at END,
         delivered_at = CASE WHEN ns='delivered' THEN now() ELSE delivered_at END,
         rejected_at = CASE WHEN ns='rejected' THEN now() ELSE rejected_at END,
         updated_at = now()
   WHERE id = _reward_id
   RETURNING * INTO r;

  INSERT INTO public.admin_audit_log (actor_id, action, target_user_id, reason, metadata)
  VALUES (auth.uid(), 'reward_status_change', r.user_id, note,
          jsonb_build_object('reward_id', r.id, 'reward_number', r.reward_number,
                             'new_status', ns, 'tracking', trk));

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (r.user_id, 'reward_status',
          'Reward ' || r.reward_number || ': ' || ns,
          COALESCE(note, 'Your reward status has been updated.'),
          '/customer/rewards');
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.request_customer_reward(_reward_id UUID, _note TEXT)
RETURNS public.customer_rewards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.customer_rewards;
  note TEXT := NULLIF(_note, '');
BEGIN
  SELECT * INTO r FROM public.customer_rewards WHERE id = _reward_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REWARD_NOT_FOUND'; END IF;
  IF r.user_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF r.status <> 'eligible' THEN RAISE EXCEPTION 'INVALID_STATUS: %', r.status; END IF;

  UPDATE public.customer_rewards
     SET status='requested', requested_at=now(), request_note=note, updated_at=now()
   WHERE id = _reward_id
   RETURNING * INTO r;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT ur.user_id, 'reward_requested',
         'Reward request submitted',
         'Customer requested reward ' || r.reward_number,
         '/admin/rewards'
    FROM public.user_roles ur WHERE ur.role='admin';
  RETURN r;
END; $$;
