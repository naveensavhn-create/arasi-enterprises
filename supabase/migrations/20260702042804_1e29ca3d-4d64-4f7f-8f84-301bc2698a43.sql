
-- Shared eligibility resolver used by every winner-picking path.
-- An entry is eligible for a draw when:
--   1. It is marked eligible (not admin-disqualified),
--   2. If the draw requires an active membership, the pinned membership
--      belongs to the entrant and is currently 'active',
--   3. If the draw is scoped to a specific plan, the membership's plan
--      matches the draw's plan.
CREATE OR REPLACE FUNCTION public.eligible_draw_entries(_draw_id UUID)
RETURNS SETOF public.draw_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT de.*
    FROM public.draws d
    JOIN public.draw_entries de ON de.draw_id = d.id
    LEFT JOIN public.memberships m ON m.id = de.membership_id
   WHERE d.id = _draw_id
     AND de.eligible = true
     AND (
       NOT d.requires_active_membership
       OR (
         m.id IS NOT NULL
         AND m.user_id = de.customer_id
         AND m.status = 'active'
         AND (d.plan_id IS NULL OR m.plan_id = d.plan_id)
       )
     );
$$;

REVOKE EXECUTE ON FUNCTION public.eligible_draw_entries(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eligible_draw_entries(UUID) TO authenticated;

-- Rewire the automated cron picker to use the shared eligibility resolver.
CREATE OR REPLACE FUNCTION public.auto_pick_due_draws()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_count INT := 0;
  v_seed TEXT;
BEGIN
  FOR v_draw IN
    SELECT * FROM public.draws
     WHERE mode = 'automated'
       AND status NOT IN ('completed','cancelled')
       AND draw_at IS NOT NULL
       AND draw_at <= now()
     ORDER BY draw_at ASC
     LIMIT 25
  LOOP
    UPDATE public.draws SET status = 'closed' WHERE id = v_draw.id AND status <> 'closed';

    v_seed := encode(gen_random_bytes(16), 'hex');
    PERFORM setseed(
      ((('x' || substr(md5(v_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
    );

    DELETE FROM public.draw_winners WHERE draw_id = v_draw.id;

    INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
    SELECT
      v_draw.id, e.id, e.customer_id,
      row_number() OVER () AS position,
      v_draw.prize, NULL, v_seed
    FROM (
      SELECT ee.id, ee.customer_id
        FROM public.eligible_draw_entries(v_draw.id) ee
       ORDER BY random()
       LIMIT v_draw.winners_count
    ) e;

    UPDATE public.draws
       SET status = 'completed', drawn_at = now(), seed = v_seed
     WHERE id = v_draw.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Rewire admin random pick.
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Draw % not found', _draw_id; END IF;
  IF v_draw.status = 'cancelled' THEN RAISE EXCEPTION 'Draw is cancelled'; END IF;

  IF v_draw.status = 'completed'
     OR EXISTS (SELECT 1 FROM public.draw_winners WHERE draw_id = _draw_id) THEN
    RETURN QUERY SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
    RETURN;
  END IF;

  v_effective_seed := COALESCE(_seed, encode(gen_random_bytes(16), 'hex'));
  PERFORM setseed(
    ((('x' || substr(md5(v_effective_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
  );

  INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
  SELECT _draw_id, e.id, e.customer_id,
    row_number() OVER () AS position,
    v_draw.prize, v_actor, v_effective_seed
  FROM (
    SELECT ee.id, ee.customer_id
      FROM public.eligible_draw_entries(_draw_id) ee
     ORDER BY random()
     LIMIT v_draw.winners_count
  ) e;

  UPDATE public.draws
     SET status = 'completed', drawn_at = now(), seed = v_effective_seed
   WHERE id = _draw_id;

  RETURN QUERY SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
END;
$$;

-- Rewire manual admin pick to reuse the same eligibility rules for both
-- explicit entry selection and the random-by-count path.
CREATE OR REPLACE FUNCTION public.admin_pick_draw_winners_manual(
  _draw_id UUID,
  _entry_ids UUID[] DEFAULT NULL,
  _count INT DEFAULT NULL,
  _seed TEXT DEFAULT NULL
)
RETURNS SETOF public.draw_winners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_effective_seed TEXT;
  v_actor UUID := auth.uid();
  v_count INT;
  v_bad INT;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draw FROM public.draws WHERE id = _draw_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draw % not found', _draw_id; END IF;
  IF v_draw.status = 'cancelled' THEN RAISE EXCEPTION 'Draw is cancelled'; END IF;

  IF v_draw.status = 'completed'
     OR EXISTS (SELECT 1 FROM public.draw_winners WHERE draw_id = _draw_id) THEN
    RETURN QUERY SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
    RETURN;
  END IF;

  v_effective_seed := COALESCE(_seed, encode(gen_random_bytes(16), 'hex'));

  IF _entry_ids IS NOT NULL AND array_length(_entry_ids, 1) > 0 THEN
    -- Every supplied id must appear in the shared eligibility set.
    SELECT COUNT(*) INTO v_bad
      FROM unnest(_entry_ids) AS x(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.eligible_draw_entries(_draw_id) ee WHERE ee.id = x.id
     );
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'One or more selected entries are invalid or ineligible for this draw';
    END IF;

    INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
    SELECT _draw_id, de.id, de.customer_id,
      row_number() OVER (ORDER BY ord.rn) AS position,
      v_draw.prize, v_actor, v_effective_seed
    FROM unnest(_entry_ids) WITH ORDINALITY AS ord(entry_id, rn)
    JOIN public.draw_entries de ON de.id = ord.entry_id;

  ELSE
    v_count := GREATEST(COALESCE(_count, v_draw.winners_count), 1);
    PERFORM setseed(
      ((('x' || substr(md5(v_effective_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
    );
    INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
    SELECT _draw_id, e.id, e.customer_id,
      row_number() OVER () AS position,
      v_draw.prize, v_actor, v_effective_seed
    FROM (
      SELECT ee.id, ee.customer_id
        FROM public.eligible_draw_entries(_draw_id) ee
       ORDER BY random()
       LIMIT v_count
    ) e;
  END IF;

  UPDATE public.draws
     SET status = 'completed', drawn_at = now(), seed = v_effective_seed
   WHERE id = _draw_id;

  RETURN QUERY SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
END;
$$;
