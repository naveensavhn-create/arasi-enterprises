-- Impersonation mutation guard: block all mutations while an admin has an
-- active read_only impersonation session; audit-log every mutation performed
-- during a full_access session.

CREATE OR REPLACE FUNCTION public.current_impersonation()
RETURNS TABLE (session_id UUID, mode TEXT, target_user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, mode, target_user_id
  FROM public.impersonation_sessions
  WHERE admin_id = auth.uid() AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_impersonation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_impersonation() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_impersonation_mutations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session UUID;
  v_mode TEXT;
  v_target UUID;
  v_actor_email TEXT;
BEGIN
  -- Service role / background jobs / non-authenticated triggers bypass.
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id, mode, target_user_id
    INTO v_session, v_mode, v_target
  FROM public.impersonation_sessions
  WHERE admin_id = v_actor AND ended_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_session IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_mode = 'read_only' THEN
    RAISE EXCEPTION 'Impersonation session is read-only. End the session or start a full-access session to modify %.', TG_TABLE_NAME
      USING ERRCODE = '42501',
            HINT = 'Read-only impersonation blocks all write operations.';
  END IF;

  -- full_access: record the mutation for audit.
  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, metadata)
  VALUES (
    v_actor, v_actor_email, 'impersonation.mutation', v_target,
    jsonb_build_object(
      'session_id', v_session,
      'table', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      'op', TG_OP,
      'row_pk', CASE
        WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) -> 'id'
        ELSE to_jsonb(NEW) -> 'id'
      END
    )
  );

  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_impersonation_mutations() FROM PUBLIC, anon, authenticated;

-- Attach the guard to every user-facing mutation table. Impersonation-session
-- and audit-log tables are deliberately excluded so the guard itself and its
-- audit writes are never blocked or recursed.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'memberships','installments','payments','receipts','customer_rewards',
    'draw_entries','draw_winners','promoter_commissions','promoter_incentives',
    'promoter_gifts','promoter_rank_history','promoter_rank_state',
    'notifications','profiles','user_roles','membership_plans','draws',
    'reward_tiers','reward_events','reward_notification_jobs',
    'reminder_templates','payment_reminder_jobs','site_settings',
    'commission_settings','customer_ids','promoter_ids','user_ui_prefs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_impersonation_guard ON public.%I;', t
      );
      EXECUTE format(
        'CREATE TRIGGER trg_impersonation_guard
           BEFORE INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.guard_impersonation_mutations();',
        t
      );
    END IF;
  END LOOP;
END $$;