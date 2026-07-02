
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role public.app_role NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read_only' CHECK (mode IN ('read_only','full_access')),
  reason TEXT,
  session_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  ip_address TEXT,
  user_agent TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impersonation_admin_active
  ON public.impersonation_sessions(admin_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_impersonation_target
  ON public.impersonation_sessions(target_user_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.impersonation_sessions TO authenticated;
GRANT ALL ON public.impersonation_sessions TO service_role;

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage impersonation" ON public.impersonation_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_impersonation_updated_at
  BEFORE UPDATE ON public.impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Start impersonation
CREATE OR REPLACE FUNCTION public.start_impersonation(
  _target_user_id UUID,
  _mode TEXT DEFAULT 'read_only',
  _reason TEXT DEFAULT NULL,
  _ip TEXT DEFAULT NULL,
  _user_agent TEXT DEFAULT NULL
) RETURNS public.impersonation_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_email TEXT;
  v_target_role public.app_role;
  v_target_email TEXT;
  v_row public.impersonation_sessions%ROWTYPE;
BEGIN
  IF NOT public.has_role(v_actor,'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  IF _target_user_id = v_actor THEN
    RAISE EXCEPTION 'Cannot impersonate yourself';
  END IF;
  IF _mode NOT IN ('read_only','full_access') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;

  -- Prevent nested impersonation
  IF EXISTS (SELECT 1 FROM public.impersonation_sessions
              WHERE admin_id = v_actor AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'You already have an active impersonation session. End it before starting a new one.';
  END IF;

  SELECT ur.role INTO v_target_role FROM public.user_roles ur
    WHERE ur.user_id = _target_user_id
    ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'promoter' THEN 2 WHEN 'customer' THEN 3 END LIMIT 1;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user has no role';
  END IF;
  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot impersonate another admin';
  END IF;

  INSERT INTO public.impersonation_sessions
    (admin_id, target_user_id, target_role, mode, reason, ip_address, user_agent)
  VALUES (v_actor, _target_user_id, v_target_role, _mode, NULLIF(btrim(_reason),''), _ip, _user_agent)
  RETURNING * INTO v_row;

  SELECT email INTO v_actor_email  FROM public.profiles WHERE id = v_actor;
  SELECT email INTO v_target_email FROM public.profiles WHERE id = _target_user_id;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (v_actor, v_actor_email, 'impersonation.started', _target_user_id, v_target_email,
    v_row.reason, jsonb_build_object(
      'session_id', v_row.id, 'mode', _mode, 'target_role', v_target_role,
      'ip', _ip, 'user_agent', _user_agent
    ));

  RETURN v_row;
END $$;

REVOKE EXECUTE ON FUNCTION public.start_impersonation(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_impersonation(UUID,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- End impersonation
CREATE OR REPLACE FUNCTION public.end_impersonation()
RETURNS public.impersonation_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_email TEXT;
  v_row public.impersonation_sessions%ROWTYPE;
  v_target_email TEXT;
BEGIN
  IF NOT public.has_role(v_actor,'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;

  UPDATE public.impersonation_sessions
     SET ended_at = now(), updated_at = now()
   WHERE admin_id = v_actor AND ended_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;
  SELECT email INTO v_target_email FROM public.profiles WHERE id = v_row.target_user_id;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (v_actor, v_actor_email, 'impersonation.ended', v_row.target_user_id, v_target_email,
    NULL, jsonb_build_object(
      'session_id', v_row.id, 'duration_seconds',
      EXTRACT(EPOCH FROM (v_row.ended_at - v_row.started_at))::int
    ));

  RETURN v_row;
END $$;

REVOKE EXECUTE ON FUNCTION public.end_impersonation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_impersonation() TO authenticated;

-- Get active session
CREATE OR REPLACE FUNCTION public.get_active_impersonation()
RETURNS TABLE (
  id UUID, target_user_id UUID, target_role public.app_role, mode TEXT,
  reason TEXT, started_at TIMESTAMPTZ,
  target_full_name TEXT, target_email TEXT,
  target_customer_display_id INTEGER, target_promoter_display_id CHAR(5),
  target_membership_number TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.target_user_id, s.target_role, s.mode, s.reason, s.started_at,
    COALESCE(p.full_name,'') AS target_full_name, p.email AS target_email,
    ci.display_id, pi.display_id,
    (SELECT m.membership_number FROM public.memberships m
      WHERE m.user_id = s.target_user_id ORDER BY m.created_at DESC LIMIT 1)
  FROM public.impersonation_sessions s
  LEFT JOIN public.profiles p ON p.id = s.target_user_id
  LEFT JOIN public.customer_ids ci ON ci.user_id = s.target_user_id
  LEFT JOIN public.promoter_ids pi ON pi.user_id = s.target_user_id
  WHERE s.admin_id = auth.uid() AND s.ended_at IS NULL
  ORDER BY s.started_at DESC LIMIT 1;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_active_impersonation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_impersonation() TO authenticated;

-- History
CREATE OR REPLACE FUNCTION public.list_impersonation_history(_limit INT DEFAULT 100, _offset INT DEFAULT 0)
RETURNS TABLE (
  id UUID, admin_id UUID, admin_email TEXT, target_user_id UUID, target_email TEXT,
  target_role public.app_role, mode TEXT, reason TEXT,
  ip_address TEXT, user_agent TEXT, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.admin_id, ap.email, s.target_user_id, tp.email,
    s.target_role, s.mode, s.reason, s.ip_address, s.user_agent, s.started_at, s.ended_at
  FROM public.impersonation_sessions s
  LEFT JOIN public.profiles ap ON ap.id = s.admin_id
  LEFT JOIN public.profiles tp ON tp.id = s.target_user_id
  ORDER BY s.started_at DESC
  LIMIT GREATEST(_limit,1) OFFSET GREATEST(_offset,0);
END $$;

REVOKE EXECUTE ON FUNCTION public.list_impersonation_history(INT,INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_impersonation_history(INT,INT) TO authenticated;

-- Comprehensive admin snapshot of another user
CREATE OR REPLACE FUNCTION public.admin_user_snapshot(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE v JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'profile', to_jsonb(p),
    'role', (SELECT role FROM public.user_roles WHERE user_id=_user_id
              ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'promoter' THEN 2 ELSE 3 END LIMIT 1),
    'customer_display_id', (SELECT display_id FROM public.customer_ids WHERE user_id=_user_id),
    'promoter_display_id', (SELECT display_id FROM public.promoter_ids WHERE user_id=_user_id),
    'promoter_referral_code', (SELECT referral_code FROM public.promoter_ids WHERE user_id=_user_id),
    'memberships', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC)
                              FROM public.memberships m WHERE m.user_id=_user_id), '[]'::jsonb),
    'installments', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.due_date)
                              FROM public.installments i
                              JOIN public.memberships m ON m.id=i.membership_id
                              WHERE m.user_id=_user_id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(to_jsonb(pay) ORDER BY pay.created_at DESC)
                          FROM public.payments pay WHERE pay.customer_id=_user_id), '[]'::jsonb),
    'receipts', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.issued_at DESC)
                          FROM public.receipts r WHERE r.customer_id=_user_id), '[]'::jsonb),
    'rewards', COALESCE((SELECT jsonb_agg(to_jsonb(cr) ORDER BY cr.created_at DESC)
                         FROM public.customer_rewards cr WHERE cr.customer_id=_user_id), '[]'::jsonb),
    'draw_entries', COALESCE((SELECT jsonb_agg(to_jsonb(de) ORDER BY de.created_at DESC)
                              FROM public.draw_entries de WHERE de.customer_id=_user_id), '[]'::jsonb),
    'draw_wins', COALESCE((SELECT jsonb_agg(to_jsonb(dw) ORDER BY dw.created_at DESC)
                           FROM public.draw_winners dw WHERE dw.customer_id=_user_id), '[]'::jsonb),
    'notifications', COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC)
                               FROM (SELECT * FROM public.notifications
                                     WHERE user_id=_user_id ORDER BY created_at DESC LIMIT 100) n), '[]'::jsonb),
    'referred_by', (SELECT jsonb_build_object('id', rp.id, 'full_name', rp.full_name, 'email', rp.email)
                    FROM public.profiles rp WHERE rp.id = p.referred_by_promoter_id),
    'referrals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', p2.id, 'full_name', p2.full_name, 'email', p2.email,
                            'kyc_status', p2.kyc_status, 'created_at', p2.created_at))
                          FROM public.profiles p2 WHERE p2.referred_by_promoter_id=_user_id), '[]'::jsonb),
    'commissions', COALESCE((SELECT jsonb_agg(to_jsonb(pc) ORDER BY pc.created_at DESC)
                             FROM public.promoter_commissions pc WHERE pc.promoter_id=_user_id), '[]'::jsonb),
    'rank_state', (SELECT to_jsonb(rs) FROM public.promoter_rank_state rs WHERE rs.promoter_id=_user_id),
    'auth', (SELECT jsonb_build_object('created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
              'banned_until', u.banned_until) FROM auth.users u WHERE u.id=_user_id)
  ) INTO v
  FROM public.profiles p WHERE p.id=_user_id;
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_user_snapshot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_snapshot(UUID) TO authenticated;
