
-- ============ ENUMS ============
CREATE TYPE public.membership_status AS ENUM ('pending','active','completed','cancelled','defaulted');
CREATE TYPE public.installment_status AS ENUM ('pending','paid','overdue','waived');

-- ============ MEMBERSHIP PLANS ============
CREATE TABLE public.membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  advance_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  monthly_installment NUMERIC(12,2) NOT NULL CHECK (monthly_installment > 0),
  duration_months INTEGER NOT NULL CHECK (duration_months > 0 AND duration_months <= 120),
  total_value NUMERIC(12,2) GENERATED ALWAYS AS (advance_amount + (monthly_installment * duration_months)) STORED,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.membership_plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_plans TO authenticated;
GRANT ALL ON public.membership_plans TO service_role;

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active plans"
  ON public.membership_plans FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage plans"
  ON public.membership_plans FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_membership_plans_updated
  BEFORE UPDATE ON public.membership_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ MEMBERSHIPS ============
CREATE TABLE public.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
  promoter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.membership_status NOT NULL DEFAULT 'pending',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  advance_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (advance_paid >= 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memberships_user ON public.memberships(user_id);
CREATE INDEX idx_memberships_promoter ON public.memberships(promoter_id);
CREATE INDEX idx_memberships_status ON public.memberships(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own memberships"
  ON public.memberships FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Promoters view assigned memberships"
  ON public.memberships FOR SELECT TO authenticated
  USING (auth.uid() = promoter_id AND public.has_role(auth.uid(), 'promoter'));

CREATE POLICY "Admins view all memberships"
  ON public.memberships FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Customers create own membership"
  ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins manage memberships"
  ON public.memberships FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_memberships_updated
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ INSTALLMENTS ============
CREATE TABLE public.installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status public.installment_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (membership_id, sequence)
);

CREATE INDEX idx_installments_membership ON public.installments(membership_id);
CREATE INDEX idx_installments_status ON public.installments(status);
CREATE INDEX idx_installments_due_date ON public.installments(due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installments TO authenticated;
GRANT ALL ON public.installments TO service_role;

ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own installments"
  ON public.installments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.id = installments.membership_id AND m.user_id = auth.uid()
  ));

CREATE POLICY "Promoters view assigned installments"
  ON public.installments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.id = installments.membership_id
      AND m.promoter_id = auth.uid()
      AND public.has_role(auth.uid(), 'promoter')
  ));

CREATE POLICY "Admins view all installments"
  ON public.installments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage installments"
  ON public.installments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_installments_updated
  BEFORE UPDATE ON public.installments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ AUTO-GENERATE SCHEDULE ON MEMBERSHIP INSERT ============
CREATE OR REPLACE FUNCTION public.generate_installment_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration INTEGER;
  v_monthly NUMERIC(12,2);
  i INTEGER;
BEGIN
  SELECT duration_months, monthly_installment
    INTO v_duration, v_monthly
  FROM public.membership_plans
  WHERE id = NEW.plan_id;

  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Plan % not found', NEW.plan_id;
  END IF;

  FOR i IN 1..v_duration LOOP
    INSERT INTO public.installments (membership_id, sequence, due_date, amount)
    VALUES (NEW.id, i, (NEW.start_date + (i || ' month')::interval)::date, v_monthly);
  END LOOP;

  IF NEW.end_date IS NULL THEN
    UPDATE public.memberships
    SET end_date = (NEW.start_date + (v_duration || ' month')::interval)::date
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_installment_schedule() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_memberships_generate_schedule
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.generate_installment_schedule();

-- ============ OVERDUE MARKER (call from cron/edge) ============
CREATE OR REPLACE FUNCTION public.mark_overdue_installments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.installments
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_overdue_installments() FROM PUBLIC, anon, authenticated;
