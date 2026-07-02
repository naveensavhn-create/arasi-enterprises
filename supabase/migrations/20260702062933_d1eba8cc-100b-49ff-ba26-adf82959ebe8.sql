
CREATE TABLE public.reward_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('installments_paid','membership_completed','on_time_streak','advance_paid')),
  threshold INTEGER NOT NULL DEFAULT 0,
  plan_id UUID REFERENCES public.membership_plans(id) ON DELETE CASCADE,
  reward_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  certificate_title TEXT,
  certificate_body TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_tiers TO authenticated;
GRANT ALL ON public.reward_tiers TO service_role;
ALTER TABLE public.reward_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view reward tiers"
  ON public.reward_tiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage reward tiers"
  ON public.reward_tiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_reward_tiers_updated_at
  BEFORE UPDATE ON public.reward_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  CREATE TYPE public.reward_claim_status AS ENUM
    ('locked','eligible','requested','approved','dispatched','delivered','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.customer_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_number TEXT UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES public.reward_tiers(id) ON DELETE RESTRICT,
  status public.reward_claim_status NOT NULL DEFAULT 'eligible',
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  request_note TEXT,
  admin_note TEXT,
  tracking_reference TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (membership_id, tier_id)
);

CREATE INDEX idx_customer_rewards_user ON public.customer_rewards(user_id, created_at DESC);
CREATE INDEX idx_customer_rewards_status ON public.customer_rewards(status);
CREATE INDEX idx_customer_rewards_membership ON public.customer_rewards(membership_id);

GRANT SELECT, UPDATE ON public.customer_rewards TO authenticated;
GRANT ALL ON public.customer_rewards TO service_role;
ALTER TABLE public.customer_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own rewards"
  ON public.customer_rewards FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins manage customer rewards"
  ON public.customer_rewards FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_customer_rewards_updated_at
  BEFORE UPDATE ON public.customer_rewards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.assign_reward_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  seq INTEGER;
BEGIN
  IF NEW.reward_number IS NULL THEN
    SELECT COALESCE(MAX(SUBSTRING(reward_number FROM '\d+$')::int), 0) + 1
      INTO seq
      FROM public.customer_rewards
     WHERE reward_number LIKE 'ARASI-RWD-' || yr || '-%';
    NEW.reward_number := 'ARASI-RWD-' || yr || '-' || LPAD(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_customer_rewards_number
  BEFORE INSERT ON public.customer_rewards
  FOR EACH ROW EXECUTE FUNCTION public.assign_reward_number();

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
        INSERT INTO public.notifications (user_id, kind, title, body, link)
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

REVOKE EXECUTE ON FUNCTION public.recompute_customer_rewards(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_customer_rewards(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_installment_reward_recompute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.recompute_customer_rewards(NEW.membership_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_installment_reward_recompute ON public.installments;
CREATE TRIGGER trg_installment_reward_recompute
  AFTER INSERT OR UPDATE OF status ON public.installments
  FOR EACH ROW EXECUTE FUNCTION public.trg_installment_reward_recompute();

CREATE OR REPLACE FUNCTION public.trg_membership_reward_recompute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_customer_rewards(NEW.id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_membership_reward_recompute ON public.memberships;
CREATE TRIGGER trg_membership_reward_recompute
  AFTER INSERT OR UPDATE OF status, paid_amount, advance_paid ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.trg_membership_reward_recompute();

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

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT ur.user_id, 'reward_requested',
         'Reward request submitted',
         'Customer requested reward ' || r.reward_number,
         '/admin/rewards'
    FROM public.user_roles ur WHERE ur.role='admin';

  RETURN r;
END; $$;

REVOKE EXECUTE ON FUNCTION public.request_customer_reward(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_customer_reward(UUID, TEXT) TO authenticated;

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

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'reward_status_change', 'customer_reward', r.id,
          jsonb_build_object('new_status', ns, 'note', _admin_note, 'tracking', _tracking));

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (r.user_id, 'reward_status',
          'Reward ' || r.reward_number || ': ' || ns,
          COALESCE(_admin_note, 'Your reward status has been updated.'),
          '/customer/rewards');

  RETURN r;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_reward_status(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_reward_status(UUID,TEXT,TEXT,TEXT) TO authenticated;

INSERT INTO public.reward_tiers (name, description, trigger_type, threshold, reward_value, certificate_title, certificate_body, sort_order)
VALUES
 ('Advance welcome gift','Awarded on payment of advance booking amount','advance_paid',0,0,
  'Welcome to Arasi','Awarded for beginning your Arasi membership journey.',10),
 ('3 installments cleared','Small welcome gift after 3 monthly installments','installments_paid',3,0,
  'Bronze Milestone','Awarded for consistently clearing 3 monthly installments.',20),
 ('6 installments cleared','Bonus coupon after clearing 6 installments','installments_paid',6,0,
  'Silver Milestone','Awarded for reaching the half-way point of your plan.',30),
 ('Plan completed','Product delivery + completion bonus','membership_completed',0,0,
  'Gold Completion','Awarded for successfully completing the full Arasi plan.',40)
ON CONFLICT DO NOTHING;
