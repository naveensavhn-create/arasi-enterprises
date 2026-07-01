
-- Plan audit log for compliance
CREATE TABLE public.plan_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  plan_id UUID,
  plan_code TEXT,
  plan_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('create','update','activate','deactivate','delete')),
  before_data JSONB,
  after_data JSONB,
  changed_fields TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plan_audit_log TO authenticated;
GRANT ALL ON public.plan_audit_log TO service_role;

ALTER TABLE public.plan_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view plan audit log"
  ON public.plan_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_plan_audit_log_plan_id ON public.plan_audit_log(plan_id, created_at DESC);
CREATE INDEX idx_plan_audit_log_created_at ON public.plan_audit_log(created_at DESC);

-- Trigger function: capture INSERT/UPDATE/DELETE on membership_plans
CREATE OR REPLACE FUNCTION public.log_plan_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_email TEXT;
  v_action TEXT;
  v_before JSONB;
  v_after JSONB;
  v_changed TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_after := to_jsonb(NEW);
    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_code, plan_name, action, before_data, after_data, changed_fields)
    VALUES
      (v_actor, v_email, NEW.id, NEW.code, NEW.name, v_action, NULL, v_after, NULL);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    -- Diff changed keys
    FOR v_key IN SELECT jsonb_object_keys(v_after) LOOP
      IF v_before->v_key IS DISTINCT FROM v_after->v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW; -- no-op update, skip logging
    END IF;

    IF OLD.is_active IS DISTINCT FROM NEW.is_active AND array_length(v_changed, 1) = 1 THEN
      v_action := CASE WHEN NEW.is_active THEN 'activate' ELSE 'deactivate' END;
    ELSE
      v_action := 'update';
    END IF;

    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_code, plan_name, action, before_data, after_data, changed_fields)
    VALUES
      (v_actor, v_email, NEW.id, NEW.code, NEW.name, v_action, v_before, v_after, v_changed);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    INSERT INTO public.plan_audit_log
      (actor_id, actor_email, plan_id, plan_code, plan_name, action, before_data, after_data, changed_fields)
    VALUES
      (v_actor, v_email, OLD.id, OLD.code, OLD.name, 'delete', v_before, NULL, NULL);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_plan_change ON public.membership_plans;
CREATE TRIGGER trg_log_plan_change
AFTER INSERT OR UPDATE OR DELETE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION public.log_plan_change();
