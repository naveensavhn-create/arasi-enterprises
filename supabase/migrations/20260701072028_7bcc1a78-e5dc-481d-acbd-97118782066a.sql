
REVOKE EXECUTE ON FUNCTION public.activate_membership_after_advance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_membership_after_advance(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.membership_before_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.membership_before_insert() TO service_role;
