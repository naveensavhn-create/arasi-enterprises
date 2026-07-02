
-- Make period columns optional and switch uniqueness to one-time per promoter+rank
ALTER TABLE public.promoter_incentives
  ALTER COLUMN period_month DROP NOT NULL,
  ALTER COLUMN period_year DROP NOT NULL;

ALTER TABLE public.promoter_incentives
  DROP CONSTRAINT IF EXISTS promoter_incentives_promoter_id_period_year_period_month_key;

-- Deduplicate existing rows (keep earliest) before adding the new unique constraint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY promoter_id, rank_id ORDER BY created_at ASC) AS rn
    FROM public.promoter_incentives
)
DELETE FROM public.promoter_incentives i USING ranked r
 WHERE i.id = r.id AND r.rn > 1;

ALTER TABLE public.promoter_incentives
  ADD CONSTRAINT promoter_incentives_promoter_rank_unique UNIQUE (promoter_id, rank_id);

-- Drop the old monthly generator
DROP FUNCTION IF EXISTS public.admin_generate_monthly_incentives(INT, INT);

-- New one-time generator: awards missing incentives for every promoter at their current rank
CREATE OR REPLACE FUNCTION public.admin_generate_rank_incentives()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings public.commission_settings%ROWTYPE;
  r RECORD;
  v_count INT := 0;
  v_status TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_settings FROM public.commission_settings WHERE id = TRUE;
  v_status := CASE WHEN v_settings.incentive_mode = 'automatic' THEN 'approved' ELSE 'pending' END;

  FOR r IN
    SELECT s.promoter_id, s.current_rank_id, pr.monthly_incentive AS amount
      FROM public.promoter_rank_state s
      JOIN public.promoter_ranks pr ON pr.id = s.current_rank_id
     WHERE pr.monthly_incentive > 0
       AND NOT s.frozen
       AND NOT EXISTS (
         SELECT 1 FROM public.promoter_incentives i
          WHERE i.promoter_id = s.promoter_id AND i.rank_id = s.current_rank_id
       )
  LOOP
    INSERT INTO public.promoter_incentives(
      promoter_id, rank_id, period_year, period_month, amount, status, approved_by, approved_at
    ) VALUES (
      r.promoter_id, r.current_rank_id, NULL, NULL, r.amount, v_status,
      CASE WHEN v_status='approved' THEN auth.uid() END,
      CASE WHEN v_status='approved' THEN now() END
    ) ON CONFLICT (promoter_id, rank_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_generate_rank_incentives() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_generate_rank_incentives() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_rank_incentives() TO authenticated;

-- Auto-award one-time incentive on rank promotion (parallel to the gift auto-award)
CREATE OR REPLACE FUNCTION public.recompute_promoter_rank(_promoter UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_prev_rank UUID;
  v_new_rank public.promoter_ranks%ROWTYPE;
  v_prev_row public.promoter_rank_state%ROWTYPE;
  v_settings public.commission_settings%ROWTYPE;
  v_status TEXT;
BEGIN
  IF _promoter IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_count FROM public.memberships
   WHERE promoter_id = _promoter AND status = 'active';

  SELECT * INTO v_prev_row FROM public.promoter_rank_state WHERE promoter_id = _promoter;
  v_prev_rank := v_prev_row.current_rank_id;

  SELECT * INTO v_new_rank FROM public.promoter_ranks
   WHERE is_active AND min_active_customers <= v_count
   ORDER BY min_active_customers DESC LIMIT 1;

  INSERT INTO public.promoter_rank_state(promoter_id, active_customer_count, current_rank_id, rank_since, updated_at)
  VALUES(_promoter, v_count, v_new_rank.id, CASE WHEN v_new_rank.id IS NOT NULL THEN now() END, now())
  ON CONFLICT (promoter_id) DO UPDATE
    SET active_customer_count = EXCLUDED.active_customer_count,
        current_rank_id = EXCLUDED.current_rank_id,
        rank_since = CASE WHEN public.promoter_rank_state.current_rank_id IS DISTINCT FROM EXCLUDED.current_rank_id
                          THEN now() ELSE public.promoter_rank_state.rank_since END,
        updated_at = now();

  IF v_prev_rank IS DISTINCT FROM v_new_rank.id THEN
    INSERT INTO public.promoter_rank_history(promoter_id, from_rank_id, to_rank_id, active_customer_count, reason)
    VALUES(_promoter, v_prev_rank, v_new_rank.id, v_count,
           CASE WHEN v_prev_rank IS NULL THEN 'initial_assignment'
                WHEN v_new_rank.id IS NULL THEN 'demoted_below_threshold'
                ELSE 'threshold_reached' END);

    IF v_new_rank.id IS NOT NULL AND v_new_rank.gift_name IS NOT NULL THEN
      INSERT INTO public.promoter_gifts(promoter_id, rank_id, gift_name)
      VALUES(_promoter, v_new_rank.id, v_new_rank.gift_name)
      ON CONFLICT (promoter_id, rank_id) DO NOTHING;
    END IF;

    -- One-time incentive on reaching this rank (idempotent via UNIQUE(promoter_id, rank_id))
    IF v_new_rank.id IS NOT NULL AND COALESCE(v_new_rank.monthly_incentive, 0) > 0 THEN
      SELECT * INTO v_settings FROM public.commission_settings WHERE id = TRUE;
      v_status := CASE WHEN COALESCE(v_settings.incentive_mode,'manual') = 'automatic' THEN 'approved' ELSE 'pending' END;
      INSERT INTO public.promoter_incentives(promoter_id, rank_id, period_year, period_month, amount, status, approved_by, approved_at)
      VALUES(_promoter, v_new_rank.id, NULL, NULL, v_new_rank.monthly_incentive, v_status,
             CASE WHEN v_status='approved' THEN _promoter END,
             CASE WHEN v_status='approved' THEN now() END)
      ON CONFLICT (promoter_id, rank_id) DO NOTHING;
    END IF;

    IF v_new_rank.id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, link, metadata)
      VALUES(_promoter, 'rank_upgraded', 'Congratulations — new rank: ' || v_new_rank.name,
             'You have been promoted to ' || v_new_rank.name || ' with ' || v_count || ' active customers.',
             '/promoter/rank',
             jsonb_build_object('rank_id', v_new_rank.id, 'active_customers', v_count));
    END IF;
  END IF;
END; $$;
