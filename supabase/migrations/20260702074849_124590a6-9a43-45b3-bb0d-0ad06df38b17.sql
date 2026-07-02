-- Enhanced per-action audit logging for full-access impersonation writes.
-- Emits a specific action name per table+op and captures affected record IDs
-- (primary key + common FK identifiers) plus a diff of changed columns.

CREATE OR REPLACE FUNCTION public.guard_impersonation_mutations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session UUID;
  v_mode TEXT;
  v_target UUID;
  v_actor_email TEXT;
  v_new JSONB;
  v_old JSONB;
  v_row JSONB;
  v_op TEXT := lower(TG_OP);
  v_action TEXT;
  v_changed TEXT[] := ARRAY[]::TEXT[];
  v_ids JSONB := '{}'::JSONB;
  k TEXT;
  fk TEXT;
  fk_cols CONSTANT TEXT[] := ARRAY[
    'id','user_id','customer_id','promoter_id','membership_id',
    'installment_id','payment_id','receipt_id','reward_id','draw_id',
    'entry_id','plan_id','rank_id','commission_id','template_id','job_id',
    'notification_id','role','target_user_id','session_id','parent_id',
    'referred_by','referrer_id'
  ];
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

  -- full_access: build a rich per-action audit entry.
  v_new := CASE WHEN NEW IS NULL THEN NULL ELSE to_jsonb(NEW) END;
  v_old := CASE WHEN OLD IS NULL THEN NULL ELSE to_jsonb(OLD) END;
  v_row := COALESCE(v_new, v_old);

  -- Semantic action name, e.g. impersonation.mutation.memberships.update
  v_action := 'impersonation.mutation.' || TG_TABLE_NAME || '.' || v_op;

  -- Changed columns on UPDATE (values that actually differ, ignore identical).
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN
        v_changed := array_append(v_changed, k);
      END IF;
    END LOOP;
  END IF;

  -- Affected record identifiers: primary key + common FK columns present on the row.
  FOREACH fk IN ARRAY fk_cols LOOP
    IF v_row ? fk AND (v_row -> fk) IS NOT NULL AND (v_row -> fk) <> 'null'::jsonb THEN
      v_ids := v_ids || jsonb_build_object(fk, v_row -> fk);
    END IF;
  END LOOP;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, metadata)
  VALUES (
    v_actor, v_actor_email, v_action, v_target,
    jsonb_build_object(
      'session_id',      v_session,
      'schema',          TG_TABLE_SCHEMA,
      'table',           TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      'table_name',      TG_TABLE_NAME,
      'op',              TG_OP,
      'operation',       v_op,
      'row_pk',          v_row -> 'id',
      'new_pk',          CASE WHEN v_new IS NULL THEN NULL ELSE v_new -> 'id' END,
      'old_pk',          CASE WHEN v_old IS NULL THEN NULL ELSE v_old -> 'id' END,
      'affected_ids',    v_ids,
      'changed_columns', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(v_changed) ELSE NULL END
    )
  );

  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_impersonation_mutations() FROM PUBLIC, anon, authenticated;
