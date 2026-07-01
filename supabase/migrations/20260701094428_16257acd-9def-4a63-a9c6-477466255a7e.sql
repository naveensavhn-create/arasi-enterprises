
CREATE OR REPLACE FUNCTION public.prevent_plan_delete_with_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active INTEGER;
BEGIN
  SELECT count(*) INTO v_active
    FROM public.memberships
   WHERE plan_id = OLD.id
     AND status IN ('pending','active');

  IF v_active > 0 THEN
    RAISE EXCEPTION 'Cannot delete plan: % active enrollment(s) still reference this plan. Deactivate the plan instead.', v_active
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_plan_delete_with_memberships() FROM PUBLIC, anon, authenticated;
