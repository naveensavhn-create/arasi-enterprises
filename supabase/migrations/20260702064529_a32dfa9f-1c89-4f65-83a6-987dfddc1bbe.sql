
CREATE OR REPLACE FUNCTION public.trg_block_inactive_plan_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active BOOLEAN;
  v_name   TEXT;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only guard when the plan is (re)assigned: new inserts, or updates
  -- that change plan_id to a different plan.
  IF TG_OP = 'UPDATE' AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;

  SELECT is_active, name INTO v_active, v_name
    FROM public.membership_plans WHERE id = NEW.plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plan does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Plan "%" is inactive and cannot be assigned to new memberships. Reactivate the plan first.', v_name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS membership_block_inactive_plan ON public.memberships;
CREATE TRIGGER membership_block_inactive_plan
BEFORE INSERT OR UPDATE OF plan_id ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.trg_block_inactive_plan_membership();
