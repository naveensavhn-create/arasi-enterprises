
-- 1. BEFORE INSERT trigger to auto-fill membership_number + total_amount from plan
CREATE OR REPLACE FUNCTION public.membership_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.membership_plans%ROWTYPE;
  v_seq BIGINT;
BEGIN
  SELECT * INTO v_plan FROM public.membership_plans WHERE id = NEW.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan % not found', NEW.plan_id;
  END IF;
  IF NOT v_plan.is_active THEN
    RAISE EXCEPTION 'Plan is not active';
  END IF;

  -- Copy pricing from plan (source of truth)
  NEW.total_amount := COALESCE(v_plan.total_value, v_plan.advance_amount + (v_plan.monthly_installment * v_plan.duration_months));

  -- Generate membership number if not provided: ARE-YYMM-XXXXX
  IF NEW.membership_number IS NULL OR NEW.membership_number = '' THEN
    v_seq := nextval(pg_get_serial_sequence('public.memberships','id')::text);
    -- Fallback: use a random suffix since memberships.id is uuid (no sequence)
    NEW.membership_number := 'ARE-' || to_char(now(),'YYMM') || '-' ||
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Ensure random suffix path even if sequence lookup fails
  IF NEW.membership_number IS NULL OR NEW.membership_number = '' THEN
    NEW.membership_number := 'ARE-' || to_char(now(),'YYMM') || '-' ||
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  END IF;
  IF NEW.total_amount IS NULL THEN
    RAISE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_memberships_before_insert ON public.memberships;
CREATE TRIGGER trg_memberships_before_insert
BEFORE INSERT ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.membership_before_insert();

-- 2. RPC to activate membership after advance payment webhook confirms
CREATE OR REPLACE FUNCTION public.activate_membership_after_advance(_payment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership_id UUID;
  v_amount NUMERIC(12,2);
BEGIN
  SELECT membership_id, amount
    INTO v_membership_id, v_amount
  FROM public.payments
  WHERE id = _payment_id;

  IF v_membership_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.memberships
     SET status = 'active',
         advance_paid = GREATEST(COALESCE(advance_paid,0), v_amount),
         paid_amount  = GREATEST(COALESCE(paid_amount,0), v_amount)
   WHERE id = v_membership_id
     AND status <> 'active';
END;
$$;

-- 3. Let customers browse the plan catalog (RLS read for active plans)
DROP POLICY IF EXISTS "Anyone authenticated can view active plans" ON public.membership_plans;
CREATE POLICY "Anyone authenticated can view active plans"
ON public.membership_plans
FOR SELECT
TO authenticated
USING (is_active = true);
