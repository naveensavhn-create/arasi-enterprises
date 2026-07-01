CREATE OR REPLACE FUNCTION public.log_plan_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_email TEXT;
  v_action TEXT;
  v_before JSONB;
  v_after JSONB;
  v_changed TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
  v_new_code TEXT;
  v_old_code TEXT;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    -- Tolerate schemas that never had a `code` column on membership_plans.
    v_new_code := (to_jsonb(NEW) ->> 'code');
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old_code := (to_jsonb(OLD) ->> 'code');
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_after := to_jsonb(NEW);
    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_code, plan_name, action, before_data, after_data, changed_fields)
    VALUES
      (v_actor, v_email, NEW.id, v_new_code, NEW.name, v_action, NULL, v_after, NULL);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_after) LOOP
      IF v_before->v_key IS DISTINCT FROM v_after->v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    IF OLD.is_active IS DISTINCT FROM NEW.is_active AND array_length(v_changed, 1) = 1 THEN
      v_action := CASE WHEN NEW.is_active THEN 'activate' ELSE 'deactivate' END;
    ELSE
      v_action := 'update';
    END IF;

    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_code, plan_name, action, before_data, after_data, changed_fields)
    VALUES
      (v_actor, v_email, NEW.id, v_new_code, NEW.name, v_action, v_before, v_after, v_changed);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_code, plan_name, action, before_data, after_data, changed_fields)
    VALUES
      (v_actor, v_email, OLD.id, v_old_code, OLD.name, 'delete', v_before, NULL, NULL);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;