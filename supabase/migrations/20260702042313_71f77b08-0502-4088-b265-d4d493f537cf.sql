
-- 1) New unique identifier columns on draw_entries
ALTER TABLE public.draw_entries
  ADD COLUMN IF NOT EXISTS entry_code  TEXT,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS draw_entries_entry_code_key  ON public.draw_entries(entry_code);
CREATE UNIQUE INDEX IF NOT EXISTS draw_entries_coupon_code_key ON public.draw_entries(coupon_code);

-- 2) Generator: assigns entry_code + coupon_code on insert if not provided.
CREATE OR REPLACE FUNCTION public.generate_draw_entry_codes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_prefix TEXT;
  v_try INT;
  v_candidate TEXT;
BEGIN
  SELECT * INTO v_draw FROM public.draws WHERE id = NEW.draw_id;

  v_prefix := upper(substr(regexp_replace(COALESCE(v_draw.name,'DR'), '[^A-Za-z]', '', 'g'), 1, 3));
  IF v_prefix IS NULL OR length(v_prefix) < 2 THEN v_prefix := 'DRW'; END IF;

  IF NEW.entry_code IS NULL OR NEW.entry_code = '' THEN
    FOR v_try IN 1..12 LOOP
      v_candidate := v_prefix || '-' || to_char(now(),'YYMM') || '-' ||
        upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.draw_entries WHERE entry_code = v_candidate);
    END LOOP;
    NEW.entry_code := v_candidate;
  END IF;

  IF NEW.coupon_code IS NULL OR NEW.coupon_code = '' THEN
    FOR v_try IN 1..20 LOOP
      v_candidate := lpad((floor(random() * 90000000) + 10000000)::text, 8, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.draw_entries WHERE coupon_code = v_candidate);
    END LOOP;
    NEW.coupon_code := v_candidate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_draw_entry_codes ON public.draw_entries;
CREATE TRIGGER trg_generate_draw_entry_codes
  BEFORE INSERT ON public.draw_entries
  FOR EACH ROW EXECUTE FUNCTION public.generate_draw_entry_codes();

-- Backfill for any existing rows
UPDATE public.draw_entries
   SET entry_code  = 'DRW-LEG-' || upper(substr(replace(id::text,'-',''),1,10))
 WHERE entry_code IS NULL;

UPDATE public.draw_entries de
   SET coupon_code = lpad(((abs(hashtext(de.id::text)) % 90000000) + 10000000)::text, 8, '0')
 WHERE coupon_code IS NULL;

-- 3) Auto-enroll helper: creates a draw_entry for a (draw, customer) pair
--    when the customer has an active, plan-matching membership.
CREATE OR REPLACE FUNCTION public.auto_enroll_customer_in_draw(_draw_id UUID, _customer_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_mem  public.memberships%ROWTYPE;
  v_id   UUID;
BEGIN
  SELECT * INTO v_draw FROM public.draws WHERE id = _draw_id;
  IF NOT FOUND OR v_draw.mode <> 'automated' THEN
    RETURN NULL;
  END IF;
  IF v_draw.status NOT IN ('scheduled','open') THEN
    RETURN NULL;
  END IF;
  IF v_draw.closes_at IS NOT NULL AND v_draw.closes_at <= now() THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.draw_entries
              WHERE draw_id = _draw_id AND customer_id = _customer_id) THEN
    RETURN NULL;
  END IF;

  IF v_draw.requires_active_membership THEN
    SELECT * INTO v_mem FROM public.memberships
      WHERE user_id = _customer_id
        AND status = 'active'
        AND (v_draw.plan_id IS NULL OR plan_id = v_draw.plan_id)
      ORDER BY created_at DESC
      LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO public.draw_entries (draw_id, customer_id, membership_id)
  VALUES (_draw_id, _customer_id, v_mem.id)
  ON CONFLICT (draw_id, customer_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_enroll_customer_in_draw(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- 4) When a membership becomes active, enroll into every eligible automated draw.
CREATE OR REPLACE FUNCTION public.enroll_membership_in_automated_draws()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw_id UUID;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  FOR v_draw_id IN
    SELECT d.id FROM public.draws d
     WHERE d.mode = 'automated'
       AND d.status IN ('scheduled','open')
       AND (d.closes_at IS NULL OR d.closes_at > now())
       AND (d.plan_id IS NULL OR d.plan_id = NEW.plan_id)
  LOOP
    PERFORM public.auto_enroll_customer_in_draw(v_draw_id, NEW.user_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enroll_membership_in_automated_draws ON public.memberships;
CREATE TRIGGER trg_enroll_membership_in_automated_draws
  AFTER INSERT OR UPDATE OF status ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.enroll_membership_in_automated_draws();

-- 5) When a new automated draw is scheduled, enroll all currently eligible customers.
CREATE OR REPLACE FUNCTION public.enroll_active_customers_in_new_draw()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer UUID;
BEGIN
  IF NEW.mode <> 'automated' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('scheduled','open') THEN RETURN NEW; END IF;

  FOR v_customer IN
    SELECT DISTINCT m.user_id
      FROM public.memberships m
     WHERE m.status = 'active'
       AND (NEW.plan_id IS NULL OR m.plan_id = NEW.plan_id)
  LOOP
    PERFORM public.auto_enroll_customer_in_draw(NEW.id, v_customer);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enroll_active_customers_in_new_draw ON public.draws;
CREATE TRIGGER trg_enroll_active_customers_in_new_draw
  AFTER INSERT ON public.draws
  FOR EACH ROW EXECUTE FUNCTION public.enroll_active_customers_in_new_draw();
