-- ============================================================
-- 1) admin_audit_log: forensic metadata + immutability
-- ============================================================
ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS ip_address inet,
  ADD COLUMN IF NOT EXISTS user_agent text;

CREATE OR REPLACE FUNCTION public.admin_audit_log_block_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the internal service_role may amend history.
  IF current_setting('role', true) = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'admin_audit_log is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_log_block_mutations() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_admin_audit_log_immutable ON public.admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_immutable
BEFORE UPDATE OR DELETE ON public.admin_audit_log
FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_block_mutations();

-- ============================================================
-- 2) rate_limit_buckets — best-effort app-layer throttling
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only the backend touches this table; no direct API access.
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_consume_rate_limit(
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_row public.rate_limit_buckets%ROWTYPE;
BEGIN
  IF _limit <= 0 OR _window_seconds <= 0 THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_key, 0));

  SELECT * INTO v_row FROM public.rate_limit_buckets WHERE key = _key FOR UPDATE;

  IF NOT FOUND OR v_now - v_row.window_start > make_interval(secs => _window_seconds) THEN
    INSERT INTO public.rate_limit_buckets(key, window_start, count, updated_at)
    VALUES (_key, v_now, 1, v_now)
    ON CONFLICT (key) DO UPDATE
      SET window_start = EXCLUDED.window_start,
          count = 1,
          updated_at = EXCLUDED.updated_at;
    RETURN true;
  END IF;

  IF v_row.count >= _limit THEN
    RETURN false;
  END IF;

  UPDATE public.rate_limit_buckets
     SET count = count + 1, updated_at = v_now
   WHERE key = _key;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.try_consume_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_consume_rate_limit(text, integer, integer) TO service_role;

-- Optional periodic cleanup of stale buckets (>24h old).
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_buckets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_buckets
   WHERE updated_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limit_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_buckets() TO service_role;

-- ============================================================
-- 3) security_alerts — monitoring surface
-- ============================================================
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  kind text NOT NULL,
  subject_user_id uuid,
  ip_address inet,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_alerts_created_idx
  ON public.security_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS security_alerts_severity_idx
  ON public.security_alerts(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS security_alerts_kind_idx
  ON public.security_alerts(kind, created_at DESC);

GRANT SELECT ON public.security_alerts TO authenticated;
GRANT ALL ON public.security_alerts TO service_role;

ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view security alerts"
  ON public.security_alerts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can acknowledge security alerts"
  ON public.security_alerts FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Alerts are immutable except for the acknowledgement fields.
CREATE OR REPLACE FUNCTION public.security_alerts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
     OR NEW.meta IS DISTINCT FROM OLD.meta
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only acknowledgement fields may be updated on security_alerts'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.acknowledged_by := auth.uid();
  NEW.acknowledged_at := COALESCE(NEW.acknowledged_at, now());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.security_alerts_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_security_alerts_guard ON public.security_alerts;
CREATE TRIGGER trg_security_alerts_guard
BEFORE UPDATE ON public.security_alerts
FOR EACH ROW EXECUTE FUNCTION public.security_alerts_guard();

-- ============================================================
-- 4) profiles: encrypted-at-rest columns (adopted by app in follow-up)
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS aadhaar_number_enc bytea,
  ADD COLUMN IF NOT EXISTS aadhaar_address_enc bytea;

COMMENT ON COLUMN public.profiles.aadhaar_number_enc IS
  'AES-256-GCM ciphertext: 12-byte IV || ciphertext || 16-byte tag. AAD = "aadhaar_number".';
COMMENT ON COLUMN public.profiles.aadhaar_address_enc IS
  'AES-256-GCM ciphertext: 12-byte IV || ciphertext || 16-byte tag. AAD = "aadhaar_address".';
