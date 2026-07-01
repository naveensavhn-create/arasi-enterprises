-- Enforce that promoters cannot read Aadhaar number or Aadhaar document fields
-- from the profiles table, even by selecting those columns directly.
--
-- Strategy: remove the broad "Promoters can view customer profiles" row-level
-- policy on public.profiles. Promoters now access their referred customers
-- exclusively through the SECURITY DEFINER RPC public.promoter_list_my_customers(),
-- which already omits aadhaar_number, aadhaar_front_url, and aadhaar_back_url.
-- Owners retain access to their own profile row (including their own Aadhaar
-- fields) via the existing "Users can view their own profile" policy, and
-- admins retain full visibility via "Admins can view all profiles".

DROP POLICY IF EXISTS "Promoters can view customer profiles" ON public.profiles;

-- Defense-in-depth: explicitly forbid any future promoter-scoped SELECT
-- policy from returning Aadhaar-sensitive columns by wrapping promoter row
-- access in a restrictive policy that blocks direct table reads for
-- non-admin, non-owner callers even when they hold the 'promoter' role.
CREATE POLICY "Block direct promoter reads of profiles"
  ON public.profiles
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.has_role(auth.uid(), 'admin')
  );

COMMENT ON POLICY "Block direct promoter reads of profiles" ON public.profiles IS
  'Restrictive gate: only the profile owner or an admin can SELECT rows from public.profiles directly. Promoters must go through the SECURITY DEFINER RPC public.promoter_list_my_customers(), which strips aadhaar_number, aadhaar_front_url, and aadhaar_back_url. Ensures Aadhaar number and document URLs are never returned to a promoter even if they query the columns explicitly.';
