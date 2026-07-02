
CREATE OR REPLACE FUNCTION public.recompute_customer_rewards(_membership_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m RECORD; t RECORD;
  paid_count INT; on_time_count INT;
  qualifies BOOLEAN;
  new_rows INT := 0;
  inserted_id UUID;
BEGIN
  SELECT * INTO m FROM public.memberships WHERE id = _membership_id;
  IF NOT FOUND OR m.user_id IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO paid_count FROM public.installments
   WHERE membership_id = m.id AND status = 'paid';
  SELECT COUNT(*) INTO on_time_count FROM public.installments
   WHERE membership_id = m.id AND status = 'paid'
     AND paid_at IS NOT NULL AND paid_at::date <= due_date;

  FOR t IN
    SELECT * FROM public.reward_tiers
     WHERE is_active = TRUE
       AND (plan_id IS NULL OR plan_id = m.plan_id)
  LOOP
    qualifies := FALSE;
    IF t.trigger_type = 'installments_paid' AND paid_count >= t.threshold THEN qualifies := TRUE;
    ELSIF t.trigger_type = 'on_time_streak' AND on_time_count >= t.threshold THEN qualifies := TRUE;
    ELSIF t.trigger_type = 'membership_completed'
      AND (m.status = 'completed' OR (m.total_amount > 0 AND m.paid_amount >= m.total_amount)) THEN qualifies := TRUE;
    ELSIF t.trigger_type = 'advance_paid' AND COALESCE(m.advance_paid,0) > 0 THEN qualifies := TRUE;
    END IF;

    IF qualifies THEN
      INSERT INTO public.customer_rewards (user_id, membership_id, tier_id, status, unlocked_at)
      VALUES (m.user_id, m.id, t.id, 'eligible', now())
      ON CONFLICT (membership_id, tier_id) DO NOTHING
      RETURNING id INTO inserted_id;

      IF inserted_id IS NOT NULL THEN
        new_rows := new_rows + 1;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (m.user_id, 'reward_unlocked',
                'Reward unlocked: ' || t.name,
                COALESCE(t.description, 'Congratulations! You have unlocked a new reward.'),
                '/customer/rewards');
        inserted_id := NULL;
      END IF;
    END IF;
  END LOOP;
  RETURN new_rows;
END; $$;

CREATE OR REPLACE FUNCTION public.request_customer_reward(_reward_id UUID, _note TEXT)
RETURNS public.customer_rewards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.customer_rewards;
BEGIN
  SELECT * INTO r FROM public.customer_rewards WHERE id = _reward_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REWARD_NOT_FOUND'; END IF;
  IF r.user_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF r.status <> 'eligible' THEN RAISE EXCEPTION 'INVALID_STATUS: %', r.status; END IF;

  UPDATE public.customer_rewards
     SET status='requested', requested_at=now(), request_note=_note, updated_at=now()
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

CREATE OR REPLACE FUNCTION public.admin_update_reward_status(
  _reward_id UUID, _new_status TEXT, _admin_note TEXT, _tracking TEXT
) RETURNS public.customer_rewards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.customer_rewards;
  ns public.reward_claim_status;
  allowed BOOLEAN := FALSE;
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
         admin_note = COALESCE(_admin_note, admin_note),
         tracking_reference = COALESCE(_tracking, tracking_reference),
         reviewed_by = auth.uid(),
         approved_at = CASE WHEN ns='approved' THEN now() ELSE approved_at END,
         dispatched_at = CASE WHEN ns='dispatched' THEN now() ELSE dispatched_at END,
         delivered_at = CASE WHEN ns='delivered' THEN now() ELSE delivered_at END,
         rejected_at = CASE WHEN ns='rejected' THEN now() ELSE rejected_at END,
         updated_at = now()
   WHERE id = _reward_id
   RETURNING * INTO r;

  INSERT INTO public.admin_audit_log (actor_id, action, target_user_id, reason, metadata)
  VALUES (auth.uid(), 'reward_status_change', r.user_id, _admin_note,
          jsonb_build_object('reward_id', r.id, 'reward_number', r.reward_number,
                             'new_status', ns, 'tracking', _tracking));

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (r.user_id, 'reward_status',
          'Reward ' || r.reward_number || ': ' || ns,
          COALESCE(_admin_note, 'Your reward status has been updated.'),
          '/customer/rewards');
  RETURN r;
END; $$;
