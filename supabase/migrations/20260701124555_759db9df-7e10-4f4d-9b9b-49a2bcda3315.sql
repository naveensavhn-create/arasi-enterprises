-- Lucky Draw module: draws, draw_entries, draw_winners

CREATE TYPE public.draw_status AS ENUM ('scheduled','open','closed','completed','cancelled');

-- draws
CREATE TABLE public.draws (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  prize TEXT NOT NULL,
  prize_value NUMERIC(12,2),
  status public.draw_status NOT NULL DEFAULT 'scheduled',
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  drawn_at TIMESTAMPTZ,
  winners_count INT NOT NULL DEFAULT 1 CHECK (winners_count > 0),
  plan_id UUID REFERENCES public.membership_plans(id) ON DELETE SET NULL,
  requires_active_membership BOOLEAN NOT NULL DEFAULT true,
  seed TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.draws TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.draws TO authenticated;
GRANT ALL ON public.draws TO service_role;
ALTER TABLE public.draws ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Draws readable by anyone" ON public.draws
  FOR SELECT USING (true);
CREATE POLICY "Admins manage draws" ON public.draws
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_draws_updated_at BEFORE UPDATE ON public.draws
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- draw_entries
CREATE TABLE public.draw_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draw_id UUID NOT NULL REFERENCES public.draws(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  entry_number BIGSERIAL,
  eligible BOOLEAN NOT NULL DEFAULT true,
  disqualified_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draw_id, customer_id)
);
GRANT SELECT, INSERT ON public.draw_entries TO authenticated;
GRANT UPDATE, DELETE ON public.draw_entries TO authenticated;
GRANT ALL ON public.draw_entries TO service_role;
ALTER TABLE public.draw_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view their own entries" ON public.draw_entries
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'promoter'));
CREATE POLICY "Customers create their own entries" ON public.draw_entries
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Admins manage entries" ON public.draw_entries
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX idx_draw_entries_draw ON public.draw_entries(draw_id);
CREATE INDEX idx_draw_entries_customer ON public.draw_entries(customer_id);

-- draw_winners
CREATE TABLE public.draw_winners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draw_id UUID NOT NULL REFERENCES public.draws(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.draw_entries(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position > 0),
  prize TEXT,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  drawn_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seed TEXT,
  notified_at TIMESTAMPTZ,
  UNIQUE (draw_id, position),
  UNIQUE (draw_id, entry_id)
);
GRANT SELECT ON public.draw_winners TO anon, authenticated;
GRANT ALL ON public.draw_winners TO service_role;
ALTER TABLE public.draw_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Winners publicly viewable" ON public.draw_winners
  FOR SELECT USING (true);
CREATE POLICY "Admins manage winners" ON public.draw_winners
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX idx_draw_winners_draw ON public.draw_winners(draw_id);

-- Secure random-winner picker
CREATE OR REPLACE FUNCTION public.pick_draw_winners(_draw_id UUID, _seed TEXT DEFAULT NULL)
RETURNS SETOF public.draw_winners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_effective_seed TEXT;
  v_actor UUID := auth.uid();
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draw FROM public.draws WHERE id = _draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw % not found', _draw_id;
  END IF;
  IF v_draw.status = 'completed' THEN
    RAISE EXCEPTION 'Draw already completed';
  END IF;
  IF v_draw.status = 'cancelled' THEN
    RAISE EXCEPTION 'Draw is cancelled';
  END IF;

  v_effective_seed := COALESCE(_seed, encode(gen_random_bytes(16), 'hex'));

  -- Deterministic randomness via setseed on a hash of the seed
  PERFORM setseed(
    ((('x' || substr(md5(v_effective_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
  );

  -- Clear any prior partial winners for this draw
  DELETE FROM public.draw_winners WHERE draw_id = _draw_id;

  INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
  SELECT
    _draw_id,
    e.id,
    e.customer_id,
    row_number() OVER () AS position,
    v_draw.prize,
    v_actor,
    v_effective_seed
  FROM (
    SELECT de.id, de.customer_id
    FROM public.draw_entries de
    LEFT JOIN public.memberships m ON m.id = de.membership_id
    WHERE de.draw_id = _draw_id
      AND de.eligible = true
      AND (
        NOT v_draw.requires_active_membership
        OR (m.id IS NOT NULL AND m.status = 'active')
      )
    ORDER BY random()
    LIMIT v_draw.winners_count
  ) e;

  UPDATE public.draws
     SET status = 'completed',
         drawn_at = now(),
         seed = v_effective_seed
   WHERE id = _draw_id;

  RETURN QUERY SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_draw_winners(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_draw_winners(UUID, TEXT) TO authenticated;