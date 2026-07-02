
-- ============ Ranks (configurable) ============
CREATE TABLE public.promoter_ranks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tier_order INT NOT NULL UNIQUE,
  min_active_customers INT NOT NULL CHECK (min_active_customers >= 0),
  commission_percent NUMERIC(5,2) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
  monthly_incentive NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_incentive >= 0),
  gift_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promoter_ranks TO authenticated;
GRANT ALL ON public.promoter_ranks TO service_role;
ALTER TABLE public.promoter_ranks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ranks readable by authenticated" ON public.promoter_ranks FOR SELECT TO authenticated USING (true);
CREATE POLICY "ranks admin write" ON public.promoter_ranks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ranks_updated BEFORE UPDATE ON public.promoter_ranks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.promoter_ranks (code,name,tier_order,min_active_customers,commission_percent,monthly_incentive,gift_name) VALUES
  ('lead','Lead',1,50,6.00,2400,NULL),
  ('silver','Silver Ambassador',2,100,7.00,5600,'Smartphone'),
  ('golden','Golden Ambassador',3,250,8.00,16000,'Refrigerator'),
  ('platinum','Platinum Ambassador',4,500,9.00,36000,'EV Scooter (Non-RTO)'),
  ('diamond','Diamond Ambassador',5,1000,10.00,40000,'EV Scooter (Non-RTO)');

-- ============ Per-promoter state ============
CREATE TABLE public.promoter_rank_state (
  promoter_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_customer_count INT NOT NULL DEFAULT 0,
  current_rank_id UUID REFERENCES public.promoter_ranks(id) ON DELETE SET NULL,
  rank_since TIMESTAMPTZ,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promoter_rank_state TO authenticated;
GRANT ALL ON public.promoter_rank_state TO service_role;
ALTER TABLE public.promoter_rank_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rank_state self or admin" ON public.promoter_rank_state FOR SELECT TO authenticated
  USING (promoter_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "rank_state admin write" ON public.promoter_rank_state FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ Rank history ============
CREATE TABLE public.promoter_rank_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_rank_id UUID REFERENCES public.promoter_ranks(id) ON DELETE SET NULL,
  to_rank_id UUID REFERENCES public.promoter_ranks(id) ON DELETE SET NULL,
  active_customer_count INT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rank_history_promoter ON public.promoter_rank_history(promoter_id, created_at DESC);
GRANT SELECT ON public.promoter_rank_history TO authenticated;
GRANT ALL ON public.promoter_rank_history TO service_role;
ALTER TABLE public.promoter_rank_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rank_history self or admin" ON public.promoter_rank_history FOR SELECT TO authenticated
  USING (promoter_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- ============ Commission ledger ============
CREATE TABLE public.promoter_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_number TEXT NOT NULL UNIQUE,
  promoter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES public.installments(id) ON DELETE SET NULL,
  receipt_id UUID REFERENCES public.receipts(id) ON DELETE SET NULL,
  installment_amount NUMERIC(12,2) NOT NULL CHECK (installment_amount >= 0),
  commission_percent NUMERIC(5,2) NOT NULL,
  commission_amount NUMERIC(12,2) NOT NULL,
  rank_id UUID REFERENCES public.promoter_ranks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_reference TEXT,
  remarks TEXT,
  payment_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(payment_id)
);
CREATE INDEX idx_commissions_promoter ON public.promoter_commissions(promoter_id, created_at DESC);
CREATE INDEX idx_commissions_status ON public.promoter_commissions(status);
GRANT SELECT ON public.promoter_commissions TO authenticated;
GRANT ALL ON public.promoter_commissions TO service_role;
ALTER TABLE public.promoter_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commissions self or admin" ON public.promoter_commissions FOR SELECT TO authenticated
  USING (promoter_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "commissions admin write" ON public.promoter_commissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_commissions_updated BEFORE UPDATE ON public.promoter_commissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS public.commission_ledger_seq;

-- ============ Monthly incentives ============
CREATE TABLE public.promoter_incentives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_id UUID NOT NULL REFERENCES public.promoter_ranks(id) ON DELETE RESTRICT,
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_reference TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(promoter_id, period_year, period_month)
);
CREATE INDEX idx_incentives_promoter ON public.promoter_incentives(promoter_id);
GRANT SELECT ON public.promoter_incentives TO authenticated;
GRANT ALL ON public.promoter_incentives TO service_role;
ALTER TABLE public.promoter_incentives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incentives self or admin" ON public.promoter_incentives FOR SELECT TO authenticated
  USING (promoter_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "incentives admin write" ON public.promoter_incentives FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_incentives_updated BEFORE UPDATE ON public.promoter_incentives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Rank gifts ============
CREATE TABLE public.promoter_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_id UUID NOT NULL REFERENCES public.promoter_ranks(id) ON DELETE RESTRICT,
  gift_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible','approved','dispatched','delivered','completed','rejected')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  courier_name TEXT,
  tracking_number TEXT,
  serial_number TEXT,
  delivery_proof_url TEXT,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(promoter_id, rank_id)
);
CREATE INDEX idx_gifts_promoter ON public.promoter_gifts(promoter_id);
GRANT SELECT ON public.promoter_gifts TO authenticated;
GRANT ALL ON public.promoter_gifts TO service_role;
ALTER TABLE public.promoter_gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gifts self or admin" ON public.promoter_gifts FOR SELECT TO authenticated
  USING (promoter_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "gifts admin write" ON public.promoter_gifts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_gifts_updated BEFORE UPDATE ON public.promoter_gifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Commission settings (singleton) ============
CREATE TABLE public.commission_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  commission_auto_approve BOOLEAN NOT NULL DEFAULT TRUE,
  incentive_mode TEXT NOT NULL DEFAULT 'manual' CHECK (incentive_mode IN ('automatic','manual')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.commission_settings TO authenticated;
GRANT ALL ON public.commission_settings TO service_role;
ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings readable" ON public.commission_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin write" ON public.commission_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.commission_settings(id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- ============ Functions ============
CREATE OR REPLACE FUNCTION public.recompute_promoter_rank(_promoter UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_prev_rank UUID;
  v_new_rank public.promoter_ranks%ROWTYPE;
  v_prev_row public.promoter_rank_state%ROWTYPE;
BEGIN
  IF _promoter IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_count FROM public.memberships
   WHERE promoter_id = _promoter AND status = 'active';

  SELECT * INTO v_prev_row FROM public.promoter_rank_state WHERE promoter_id = _promoter;
  v_prev_rank := v_prev_row.current_rank_id;

  SELECT * INTO v_new_rank FROM public.promoter_ranks
   WHERE is_active AND min_active_customers <= v_count
   ORDER BY min_active_customers DESC LIMIT 1;

  INSERT INTO public.promoter_rank_state(promoter_id, active_customer_count, current_rank_id, rank_since, updated_at)
  VALUES(_promoter, v_count, v_new_rank.id, CASE WHEN v_new_rank.id IS NOT NULL THEN now() END, now())
  ON CONFLICT (promoter_id) DO UPDATE
    SET active_customer_count = EXCLUDED.active_customer_count,
        current_rank_id = EXCLUDED.current_rank_id,
        rank_since = CASE WHEN public.promoter_rank_state.current_rank_id IS DISTINCT FROM EXCLUDED.current_rank_id
                          THEN now() ELSE public.promoter_rank_state.rank_since END,
        updated_at = now();

  IF v_prev_rank IS DISTINCT FROM v_new_rank.id THEN
    INSERT INTO public.promoter_rank_history(promoter_id, from_rank_id, to_rank_id, active_customer_count, reason)
    VALUES(_promoter, v_prev_rank, v_new_rank.id, v_count,
           CASE WHEN v_prev_rank IS NULL THEN 'initial_assignment'
                WHEN v_new_rank.id IS NULL THEN 'demoted_below_threshold'
                ELSE 'threshold_reached' END);

    IF v_new_rank.id IS NOT NULL AND v_new_rank.gift_name IS NOT NULL THEN
      INSERT INTO public.promoter_gifts(promoter_id, rank_id, gift_name)
      VALUES(_promoter, v_new_rank.id, v_new_rank.gift_name)
      ON CONFLICT (promoter_id, rank_id) DO NOTHING;
    END IF;

    IF v_new_rank.id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, link, metadata)
      VALUES(_promoter, 'rank_upgraded', 'Congratulations — new rank: ' || v_new_rank.name,
             'You have been promoted to ' || v_new_rank.name || ' with ' || v_count || ' active customers.',
             '/promoter/rank',
             jsonb_build_object('rank_id', v_new_rank.id, 'active_customers', v_count));
    END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_membership_recompute_rank() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.promoter_id IS NOT NULL THEN PERFORM public.recompute_promoter_rank(NEW.promoter_id); END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.promoter_id IS NOT NULL THEN PERFORM public.recompute_promoter_rank(NEW.promoter_id); END IF;
    IF OLD.promoter_id IS NOT NULL AND OLD.promoter_id IS DISTINCT FROM NEW.promoter_id THEN
      PERFORM public.recompute_promoter_rank(OLD.promoter_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.promoter_id IS NOT NULL THEN PERFORM public.recompute_promoter_rank(OLD.promoter_id); END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_memberships_rank_recompute
AFTER INSERT OR UPDATE OF status, promoter_id OR DELETE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.trg_membership_recompute_rank();

-- ===== Auto-create commission on payment paid =====
CREATE OR REPLACE FUNCTION public.trg_payment_create_commission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_promoter UUID;
  v_rank public.promoter_ranks%ROWTYPE;
  v_pct NUMERIC(5,2);
  v_amt NUMERIC(12,2);
  v_receipt UUID;
  v_settings public.commission_settings%ROWTYPE;
  v_ledger_no TEXT;
BEGIN
  IF NEW.status::text <> 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'paid' THEN RETURN NEW; END IF;

  SELECT promoter_id INTO v_promoter FROM public.memberships WHERE id = NEW.membership_id;
  IF v_promoter IS NULL THEN RETURN NEW; END IF;

  SELECT r.* INTO v_rank FROM public.promoter_rank_state s
    JOIN public.promoter_ranks r ON r.id = s.current_rank_id
    WHERE s.promoter_id = v_promoter;

  IF v_rank.id IS NULL THEN
    SELECT * INTO v_rank FROM public.promoter_ranks WHERE is_active
      ORDER BY min_active_customers ASC LIMIT 1;
  END IF;

  v_pct := COALESCE(v_rank.commission_percent, 0);
  v_amt := ROUND(NEW.amount * v_pct / 100.0, 2);
  SELECT id INTO v_receipt FROM public.receipts WHERE payment_id = NEW.id;
  SELECT * INTO v_settings FROM public.commission_settings WHERE id = TRUE;
  v_ledger_no := 'COMM-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.commission_ledger_seq')::text, 6, '0');

  INSERT INTO public.promoter_commissions(
    ledger_number, promoter_id, customer_id, membership_id, payment_id, installment_id, receipt_id,
    installment_amount, commission_percent, commission_amount, rank_id, status, approved_by, approved_at, payment_date
  ) VALUES (
    v_ledger_no, v_promoter, NEW.customer_id, NEW.membership_id, NEW.id, NEW.installment_id, v_receipt,
    NEW.amount, v_pct, v_amt, v_rank.id,
    CASE WHEN COALESCE(v_settings.commission_auto_approve, TRUE) THEN 'approved' ELSE 'pending' END,
    CASE WHEN COALESCE(v_settings.commission_auto_approve, TRUE) THEN v_promoter ELSE NULL END,
    CASE WHEN COALESCE(v_settings.commission_auto_approve, TRUE) THEN now() ELSE NULL END,
    COALESCE(NEW.paid_at, now())
  ) ON CONFLICT (payment_id) DO NOTHING;

  INSERT INTO public.notifications(user_id, type, title, body, link, metadata)
  VALUES(v_promoter, 'commission_credited', 'Commission credited',
         'A commission of ₹' || v_amt || ' was recorded at ' || v_pct || '% for a ₹' || NEW.amount || ' collection.',
         '/promoter/commissions',
         jsonb_build_object('payment_id', NEW.id, 'amount', v_amt, 'percent', v_pct));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_payments_commission
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_payment_create_commission();

-- ===== Backfill existing promoter rank state =====
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT promoter_id FROM public.memberships WHERE promoter_id IS NOT NULL LOOP
    PERFORM public.recompute_promoter_rank(r.promoter_id);
  END LOOP;
END $$;

-- ===== Admin RPCs =====
CREATE OR REPLACE FUNCTION public.admin_update_commission_status(_id UUID, _status TEXT, _reference TEXT DEFAULT NULL, _remarks TEXT DEFAULT NULL)
RETURNS public.promoter_commissions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.promoter_commissions%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF _status NOT IN ('pending','approved','paid','rejected') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.promoter_commissions
     SET status=_status,
         approved_by = CASE WHEN _status IN ('approved','paid') THEN auth.uid() ELSE approved_by END,
         approved_at = CASE WHEN _status IN ('approved','paid') AND approved_at IS NULL THEN now() ELSE approved_at END,
         paid_at = CASE WHEN _status='paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         paid_reference = COALESCE(_reference, paid_reference),
         remarks = COALESCE(_remarks, remarks),
         updated_at = now()
   WHERE id = _id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission not found'; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_generate_monthly_incentives(_year INT, _month INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settings public.commission_settings%ROWTYPE; r RECORD; v_count INT := 0; v_status TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM public.commission_settings WHERE id = TRUE;
  v_status := CASE WHEN v_settings.incentive_mode = 'automatic' THEN 'approved' ELSE 'pending' END;

  FOR r IN
    SELECT s.promoter_id, s.current_rank_id, pr.monthly_incentive
      FROM public.promoter_rank_state s
      JOIN public.promoter_ranks pr ON pr.id = s.current_rank_id
     WHERE pr.monthly_incentive > 0 AND NOT s.frozen
  LOOP
    INSERT INTO public.promoter_incentives(promoter_id, rank_id, period_year, period_month, amount, status,
      approved_by, approved_at)
    VALUES(r.promoter_id, r.current_rank_id, _year, _month, r.monthly_incentive, v_status,
           CASE WHEN v_status='approved' THEN auth.uid() END,
           CASE WHEN v_status='approved' THEN now() END)
    ON CONFLICT (promoter_id, period_year, period_month) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_incentive_status(_id UUID, _status TEXT, _reference TEXT DEFAULT NULL, _remarks TEXT DEFAULT NULL)
RETURNS public.promoter_incentives LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.promoter_incentives%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF _status NOT IN ('pending','approved','paid','rejected') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.promoter_incentives
     SET status=_status,
         approved_by = CASE WHEN _status IN ('approved','paid') THEN auth.uid() ELSE approved_by END,
         approved_at = CASE WHEN _status IN ('approved','paid') AND approved_at IS NULL THEN now() ELSE approved_at END,
         paid_at = CASE WHEN _status='paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         paid_reference = COALESCE(_reference, paid_reference),
         remarks = COALESCE(_remarks, remarks),
         updated_at = now()
   WHERE id = _id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incentive not found'; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_gift(_id UUID, _status TEXT, _courier TEXT DEFAULT NULL, _tracking TEXT DEFAULT NULL, _serial TEXT DEFAULT NULL, _proof_url TEXT DEFAULT NULL, _remarks TEXT DEFAULT NULL)
RETURNS public.promoter_gifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.promoter_gifts%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF _status NOT IN ('eligible','approved','dispatched','delivered','completed','rejected') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.promoter_gifts
     SET status=_status,
         approved_by = CASE WHEN _status='approved' AND approved_by IS NULL THEN auth.uid() ELSE approved_by END,
         approved_at = CASE WHEN _status='approved' AND approved_at IS NULL THEN now() ELSE approved_at END,
         courier_name = COALESCE(_courier, courier_name),
         tracking_number = COALESCE(_tracking, tracking_number),
         serial_number = COALESCE(_serial, serial_number),
         delivery_proof_url = COALESCE(_proof_url, delivery_proof_url),
         dispatched_at = CASE WHEN _status='dispatched' AND dispatched_at IS NULL THEN now() ELSE dispatched_at END,
         delivered_at = CASE WHEN _status IN ('delivered','completed') AND delivered_at IS NULL THEN now() ELSE delivered_at END,
         remarks = COALESCE(_remarks, remarks),
         updated_at = now()
   WHERE id = _id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gift not found'; END IF;
  RETURN v;
END; $$;

REVOKE EXECUTE ON FUNCTION public.recompute_promoter_rank(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_commission_status(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_generate_monthly_incentives(INT,INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_incentive_status(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_gift(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_commission_status(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_monthly_incentives(INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_incentive_status(UUID,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_gift(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
