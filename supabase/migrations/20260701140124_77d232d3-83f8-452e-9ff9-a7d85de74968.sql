
-- Extend draws with scheduled draw time and mode (manual vs automated)
ALTER TABLE public.draws
  ADD COLUMN IF NOT EXISTS draw_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.draws
  DROP CONSTRAINT IF EXISTS draws_mode_check;
ALTER TABLE public.draws
  ADD CONSTRAINT draws_mode_check CHECK (mode IN ('manual','automated'));

-- Security-definer helper for cron: auto-pick winners for automated draws
-- whose draw_at has passed. Bypasses the admin check inside pick_draw_winners
-- because it is executed by pg_cron, not a user.
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
    -- Close entries first so no last-second joins can slip in.
    UPDATE public.draws SET status = 'closed' WHERE id = v_draw.id AND status <> 'closed';

    v_seed := encode(gen_random_bytes(16), 'hex');
    PERFORM setseed(
      ((('x' || substr(md5(v_seed), 1, 8))::bit(32)::int) % 1000000)::float / 1000000.0
    );

    DELETE FROM public.draw_winners WHERE draw_id = v_draw.id;

    INSERT INTO public.draw_winners (draw_id, entry_id, customer_id, position, prize, drawn_by, seed)
    SELECT
      v_draw.id,
      e.id,
      e.customer_id,
      row_number() OVER () AS position,
      v_draw.prize,
      NULL,
      v_seed
    FROM (
      SELECT de.id, de.customer_id
        FROM public.draw_entries de
        LEFT JOIN public.memberships m ON m.id = de.membership_id
       WHERE de.draw_id = v_draw.id
         AND de.eligible = true
         AND (
           NOT v_draw.requires_active_membership
           OR (m.id IS NOT NULL AND m.status = 'active')
         )
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

REVOKE ALL ON FUNCTION public.auto_pick_due_draws() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_pick_due_draws() TO service_role;
