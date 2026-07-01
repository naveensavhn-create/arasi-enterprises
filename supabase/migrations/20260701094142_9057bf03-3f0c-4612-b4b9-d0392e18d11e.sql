
CREATE OR REPLACE FUNCTION public.prevent_plan_delete_with_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.memberships WHERE plan_id = OLD.id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete plan: % membership(s) still reference this plan. Deactivate the plan instead.', v_count
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_plan_delete_with_memberships ON public.membership_plans;
CREATE TRIGGER trg_prevent_plan_delete_with_memberships
BEFORE DELETE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION public.prevent_plan_delete_with_memberships();
