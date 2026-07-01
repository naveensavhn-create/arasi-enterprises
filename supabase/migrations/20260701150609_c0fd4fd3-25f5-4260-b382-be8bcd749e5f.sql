-- Make pick_draw_winners idempotent: if the draw is already completed,
-- return the existing winners instead of raising, while still preventing
-- duplicate selection via the row-lock and unique constraints on draw_winners.
CREATE OR REPLACE FUNCTION public.pick_draw_winners(_draw_id uuid, _seed text DEFAULT NULL::text)
 RETURNS SETOF public.draw_winners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_draw public.draws%ROWTYPE;
  v_effective_seed TEXT;
  v_actor UUID := auth.uid();
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent pick attempts for the same draw. Any second caller
  -- blocks until the first COMMITs; after that, the completed-branch returns
  -- the already-recorded winners rather than re-drawing.
  SELECT * INTO v_draw FROM public.draws WHERE id = _draw_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draw % not found', _draw_id;
  END IF;

  IF v_draw.status = 'cancelled' THEN
    RAISE EXCEPTION 'Draw is cancelled';
  END IF;

  -- Idempotency: winners already exist for this draw. Return them unchanged.
  IF v_draw.status = 'completed'
     OR EXISTS (SELECT 1 FROM public.draw_winners WHERE draw_id = _draw_id) THEN
    RETURN QUERY
      SELECT * FROM public.draw_winners
       WHERE draw_id = _draw_id
       ORDER BY position;
    RETURN;
  END IF;

  v_effective_seed := COALESCE(_seed, encode(gen_random_bytes(16), 'hex'));

  PERFORM setseed(
    ((('x' || substr(md5(v_effective_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
  );

  -- Belt-and-braces: even though the status guard above blocks re-draws,
  -- the unique indexes draw_winners_draw_customer_unique and
  -- draw_winners_draw_id_position_key prevent duplicate winners at the
  -- storage layer.
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
$function$;

REVOKE EXECUTE ON FUNCTION public.pick_draw_winners(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_draw_winners(uuid, text) TO authenticated, service_role;