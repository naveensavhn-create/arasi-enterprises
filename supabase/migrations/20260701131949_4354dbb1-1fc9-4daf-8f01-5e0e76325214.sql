
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS member_display_id text,
  ADD COLUMN IF NOT EXISTS coupon_no text;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_member_display_id_key
  ON public.memberships (member_display_id) WHERE member_display_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS memberships_coupon_no_key
  ON public.memberships (coupon_no) WHERE coupon_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public.membership_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.membership_plans%ROWTYPE;
  v_try INT;
  v_candidate TEXT;
  v_prefix TEXT;
BEGIN
  SELECT * INTO v_plan FROM public.membership_plans WHERE id = NEW.plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan % not found', NEW.plan_id; END IF;
  IF NOT v_plan.is_active THEN RAISE EXCEPTION 'Plan is not active'; END IF;

  NEW.total_amount := COALESCE(
    v_plan.total_value,
    v_plan.advance_amount + (v_plan.monthly_installment * v_plan.duration_months)
  );

  IF NEW.membership_number IS NULL OR NEW.membership_number = '' THEN
    NEW.membership_number := 'ARE-' || to_char(now(),'YYMM') || '-' ||
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  END IF;

  v_prefix := upper(substr(regexp_replace(COALESCE(v_plan.name,'AR'), '[^A-Za-z]', '', 'g'), 1, 2));
  IF v_prefix IS NULL OR length(v_prefix) < 2 THEN v_prefix := 'AR'; END IF;

  IF NEW.member_display_id IS NULL OR NEW.member_display_id = '' THEN
    FOR v_try IN 1..12 LOOP
      v_candidate := v_prefix || lpad((floor(random() * 900000) + 100000)::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.memberships WHERE member_display_id = v_candidate
      );
    END LOOP;
    NEW.member_display_id := v_candidate;
  END IF;

  IF NEW.coupon_no IS NULL OR NEW.coupon_no = '' THEN
    FOR v_try IN 1..20 LOOP
      v_candidate := lpad((floor(random() * 9000) + 1000)::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.memberships WHERE coupon_no = v_candidate
      );
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.memberships WHERE coupon_no = v_candidate) THEN
      v_candidate := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    END IF;
    NEW.coupon_no := v_candidate;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill any existing rows.
DO $$
DECLARE
  r RECORD;
  v_candidate TEXT;
  v_prefix TEXT;
  v_try INT;
BEGIN
  FOR r IN
    SELECT m.id, mp.name AS plan_name, m.member_display_id, m.coupon_no
    FROM public.memberships m
    LEFT JOIN public.membership_plans mp ON mp.id = m.plan_id
    WHERE m.member_display_id IS NULL OR m.coupon_no IS NULL
  LOOP
    IF r.member_display_id IS NULL THEN
      v_prefix := upper(substr(regexp_replace(COALESCE(r.plan_name,'AR'), '[^A-Za-z]', '', 'g'), 1, 2));
      IF v_prefix IS NULL OR length(v_prefix) < 2 THEN v_prefix := 'AR'; END IF;
      FOR v_try IN 1..12 LOOP
        v_candidate := v_prefix || lpad((floor(random() * 900000) + 100000)::text, 6, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.memberships WHERE member_display_id = v_candidate);
      END LOOP;
      UPDATE public.memberships SET member_display_id = v_candidate WHERE id = r.id;
    END IF;
    IF r.coupon_no IS NULL THEN
      FOR v_try IN 1..20 LOOP
        v_candidate := lpad((floor(random() * 9000) + 1000)::text, 4, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.memberships WHERE coupon_no = v_candidate);
      END LOOP;
      IF EXISTS (SELECT 1 FROM public.memberships WHERE coupon_no = v_candidate AND id <> r.id) THEN
        v_candidate := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
      END IF;
      UPDATE public.memberships SET coupon_no = v_candidate WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
