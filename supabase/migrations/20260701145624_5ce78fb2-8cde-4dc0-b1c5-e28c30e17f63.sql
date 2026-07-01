-- ============================================================
-- 1) membership_status_bypass
--    Force customer-side inserts to status='pending' and tighten policy.
-- ============================================================

DROP POLICY IF EXISTS "Customers create own membership" ON public.memberships;
CREATE POLICY "Customers create own membership"
  ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'::public.membership_status
  );

CREATE OR REPLACE FUNCTION public.enforce_membership_status_on_customer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins and service-role writers (server functions / webhooks) may set
  -- any status. All other authenticated callers are forced to 'pending'.
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM 'pending'::public.membership_status THEN
      NEW.status := 'pending'::public.membership_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_status_customer_guard ON public.memberships;
CREATE TRIGGER trg_membership_status_customer_guard
BEFORE INSERT ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_status_on_customer_insert();

REVOKE EXECUTE ON FUNCTION public.enforce_membership_status_on_customer_insert() FROM PUBLIC;

-- ============================================================
-- 2) self_register_promoter
--    handle_new_user() now ALWAYS assigns 'customer'; role from
--    signup metadata is ignored. Admins/promoters must be granted
--    explicitly through admin flows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    NEW.email,
    NEW.phone
  );

  -- Ignore any client-supplied `role` in signup metadata. Every new
  -- account starts as 'customer'; elevated roles are granted only by
  -- admins via server-side RPCs.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3) promoters_view_unassigned_payments / payments_promoter_no_role_check
--    Require the caller to actually hold the promoter role AND for the
--    membership to have a non-null promoter_id that matches.
-- ============================================================

DROP POLICY IF EXISTS "Promoters view assigned payments" ON public.payments;
CREATE POLICY "Promoters view assigned payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'promoter'::public.app_role)
    AND EXISTS (
      SELECT 1
        FROM public.memberships m
       WHERE m.id = payments.membership_id
         AND m.promoter_id IS NOT NULL
         AND m.promoter_id = auth.uid()
    )
  );

-- ============================================================
-- 4) SUPA_anon / SUPA_authenticated definer function executable
--    Revoke PUBLIC EXECUTE on every SECURITY DEFINER function in
--    public. Re-grant EXECUTE narrowly:
--      - authenticated : client-callable RPCs + has_role/current_user_role
--                        (used by RLS policies)
--      - service_role  : server-only RPCs
--      - trigger fns   : no grants (triggers run as function owner)
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
                   r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
                   r.proname, r.args);
  END LOOP;
END $$;

-- RLS policies reference these — must be executable by authenticated.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Client-callable admin/promoter RPCs.
GRANT EXECUTE ON FUNCTION public.admin_list_kyc(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_promoters() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_payments_totals(text, timestamptz, timestamptz, uuid[], uuid[], text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_promoter(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_kyc_decision(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_kyc_decision(uuid, boolean, text, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_draw_winners(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promoter_list_my_customers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.promoter_register_referred_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promoter_submit_referral_for_review(uuid, text) TO authenticated;
