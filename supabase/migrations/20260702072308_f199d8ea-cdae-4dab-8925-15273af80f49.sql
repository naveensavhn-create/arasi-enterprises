
CREATE TABLE IF NOT EXISTS public.reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id uuid REFERENCES public.customer_rewards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  tier_id uuid REFERENCES public.reward_tiers(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z_]+$'),
  from_status public.reward_claim_status,
  to_status public.reward_claim_status,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_events TO authenticated;
GRANT ALL ON public.reward_events TO service_role;

CREATE INDEX IF NOT EXISTS reward_events_user_idx ON public.reward_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reward_events_reward_idx ON public.reward_events (reward_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reward_events_membership_idx ON public.reward_events (membership_id, created_at DESC);

ALTER TABLE public.reward_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view all reward events" ON public.reward_events;
CREATE POLICY "Admins view all reward events" ON public.reward_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Customers view own reward events" ON public.reward_events;
CREATE POLICY "Customers view own reward events" ON public.reward_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Immutability: nothing may update or delete a logged event
CREATE OR REPLACE FUNCTION public.reward_events_block_mutations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reward_events is append-only';
END; $$;

DROP TRIGGER IF EXISTS trg_reward_events_immutable ON public.reward_events;
CREATE TRIGGER trg_reward_events_immutable
  BEFORE UPDATE OR DELETE ON public.reward_events
  FOR EACH ROW EXECUTE FUNCTION public.reward_events_block_mutations();

-- Auto-log inserts and status transitions on customer_rewards
CREATE OR REPLACE FUNCTION public.log_customer_reward_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_meta jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_meta := jsonb_build_object(
      'reward_number', NEW.reward_number,
      'unlocked_at', NEW.unlocked_at
    );
    INSERT INTO public.reward_events (reward_id, user_id, membership_id, tier_id,
                                      event_type, from_status, to_status, actor_id, note, metadata)
    VALUES (NEW.id, NEW.user_id, NEW.membership_id, NEW.tier_id,
            'unlocked', NULL, NEW.status, v_actor, NEW.admin_note, v_meta);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_meta := jsonb_build_object(
        'reward_number', NEW.reward_number,
        'tracking_reference', NEW.tracking_reference,
        'request_note', NEW.request_note
      );
      INSERT INTO public.reward_events (reward_id, user_id, membership_id, tier_id,
                                        event_type, from_status, to_status, actor_id, note, metadata)
      VALUES (NEW.id, NEW.user_id, NEW.membership_id, NEW.tier_id,
              'status_change', OLD.status, NEW.status,
              COALESCE(NEW.reviewed_by, v_actor), NEW.admin_note, v_meta);
    ELSIF NEW.admin_note IS DISTINCT FROM OLD.admin_note AND NEW.admin_note IS NOT NULL THEN
      INSERT INTO public.reward_events (reward_id, user_id, membership_id, tier_id,
                                        event_type, from_status, to_status, actor_id, note, metadata)
      VALUES (NEW.id, NEW.user_id, NEW.membership_id, NEW.tier_id,
              'admin_note', OLD.status, NEW.status,
              COALESCE(NEW.reviewed_by, v_actor), NEW.admin_note,
              jsonb_build_object('reward_number', NEW.reward_number));
    ELSIF NEW.tracking_reference IS DISTINCT FROM OLD.tracking_reference THEN
      INSERT INTO public.reward_events (reward_id, user_id, membership_id, tier_id,
                                        event_type, from_status, to_status, actor_id, note, metadata)
      VALUES (NEW.id, NEW.user_id, NEW.membership_id, NEW.tier_id,
              'tracking_updated', OLD.status, NEW.status,
              COALESCE(NEW.reviewed_by, v_actor), NEW.admin_note,
              jsonb_build_object('tracking_reference', NEW.tracking_reference));
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_customer_rewards_event_log ON public.customer_rewards;
CREATE TRIGGER trg_customer_rewards_event_log
  AFTER INSERT OR UPDATE ON public.customer_rewards
  FOR EACH ROW EXECUTE FUNCTION public.log_customer_reward_event();

-- Log every eligibility recompute run (membership-scoped)
CREATE OR REPLACE FUNCTION public.log_reward_recompute(_membership_id uuid, _unlocked int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE id = _membership_id;
  IF v_user IS NULL THEN RETURN; END IF;
  INSERT INTO public.reward_events (reward_id, user_id, membership_id, event_type, actor_id, metadata)
  VALUES (NULL, v_user, _membership_id, 'recomputed', auth.uid(),
          jsonb_build_object('unlocked_count', _unlocked));
END; $$;

REVOKE ALL ON FUNCTION public.log_reward_recompute(uuid, int) FROM PUBLIC, anon, authenticated;
