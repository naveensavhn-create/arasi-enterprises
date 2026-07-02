
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw % not found', _draw_id;
  END IF;
  IF v_draw.status = 'cancelled' THEN
    RAISE EXCEPTION 'Draw is cancelled';
  END IF;

  -- Idempotency: if already picked, return existing winners.
  IF v_draw.status = 'completed'
     OR EXISTS (SELECT 1 FROM public.draw_winners WHERE draw_id = _draw_id) THEN
    RETURN QUERY
      SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
    RETURN;
  END IF;

  v_effective_seed := COALESCE(_seed, encode(gen_random_bytes(16), 'hex'));

  IF _entry_ids IS NOT NULL AND array_length(_entry_ids, 1) > 0 THEN
    -- Validate every provided entry belongs to this draw, is eligible, and (if
    -- the draw requires it) has an active membership.
    SELECT COUNT(*) INTO v_bad
      FROM unnest(_entry_ids) AS x(id)
      LEFT JOIN public.draw_entries de ON de.id = x.id AND de.draw_id = _draw_id
      LEFT JOIN public.memberships m ON m.id = de.membership_id
     WHERE de.id IS NULL
        OR de.eligible = false
        OR (v_draw.requires_active_membership
            AND (m.id IS NULL OR m.status <> 'active'));
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'One or more selected entries are invalid or ineligible';
    END IF;

    INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
    SELECT
      _draw_id,
      de.id,
      de.customer_id,
      row_number() OVER (ORDER BY ord.rn) AS position,
      v_draw.prize,
      v_actor,
      v_effective_seed
    FROM unnest(_entry_ids) WITH ORDINALITY AS ord(entry_id, rn)
    JOIN public.draw_entries de ON de.id = ord.entry_id;

  ELSE
    v_count := GREATEST(COALESCE(_count, v_draw.winners_count), 1);
    PERFORM setseed(
      ((('x' || substr(md5(v_effective_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
    );
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
      LIMIT v_count
    ) e;
  END IF;

  UPDATE public.draws
     SET status = 'completed', drawn_at = now(), seed = v_effective_seed
   WHERE id = _draw_id;

  RETURN QUERY
    SELECT * FROM public.draw_winners WHERE draw_id = _draw_id ORDER BY position;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_pick_draw_winners_manual(UUID, UUID[], INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_pick_draw_winners_manual(UUID, UUID[], INT, TEXT) TO authenticated;
