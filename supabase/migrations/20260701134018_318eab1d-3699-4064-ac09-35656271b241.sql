-- Defense-in-depth: enforce draw-entry eligibility at the database layer so
-- direct Data API inserts (bypassing our server function) cannot create
-- ineligible entries. RLS already restricts customer_id to auth.uid();
-- this trigger enforces the draw window and membership requirements.

CREATE OR REPLACE FUNCTION public.validate_draw_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_mem  public.memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_draw FROM public.draws WHERE id = NEW.draw_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw % not found', NEW.draw_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_draw.status NOT IN ('scheduled', 'open') THEN
    RAISE EXCEPTION 'Draw is not open for entries (status: %)', v_draw.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_draw.opens_at IS NOT NULL AND v_draw.opens_at > now() THEN
    RAISE EXCEPTION 'Draw has not opened yet' USING ERRCODE = 'check_violation';
  END IF;

  IF v_draw.closes_at IS NOT NULL AND v_draw.closes_at <= now() THEN
    RAISE EXCEPTION 'Draw entries have closed' USING ERRCODE = 'check_violation';
  END IF;

  -- If the draw requires an active membership, resolve one and pin it on
  -- the entry so pick_draw_winners can validate at draw time too.
  IF v_draw.requires_active_membership THEN
    IF NEW.membership_id IS NOT NULL THEN
      SELECT * INTO v_mem FROM public.memberships
        WHERE id = NEW.membership_id AND user_id = NEW.customer_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership % does not belong to this customer', NEW.membership_id
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      SELECT * INTO v_mem FROM public.memberships
        WHERE user_id = NEW.customer_id
          AND status = 'active'
          AND (v_draw.plan_id IS NULL OR plan_id = v_draw.plan_id)
        ORDER BY created_at DESC
        LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An active membership is required to enter this draw'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.membership_id := v_mem.id;
    END IF;

    IF v_mem.status <> 'active' THEN
      RAISE EXCEPTION 'Membership is not active' USING ERRCODE = 'check_violation';
    END IF;

    IF v_draw.plan_id IS NOT NULL AND v_mem.plan_id <> v_draw.plan_id THEN
      RAISE EXCEPTION 'Membership plan does not match this draw'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- New entries always start eligible; disqualification is an admin action.
  IF NEW.eligible IS NULL THEN
    NEW.eligible := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_draw_entry ON public.draw_entries;
CREATE TRIGGER trg_validate_draw_entry
  BEFORE INSERT ON public.draw_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_draw_entry();
