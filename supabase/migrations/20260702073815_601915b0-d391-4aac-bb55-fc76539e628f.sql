
CREATE TABLE IF NOT EXISTS public.reconciliation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  code text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  entity_type text NOT NULL,
  entity_id uuid,
  entity_ref text,
  description text NOT NULL,
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_findings_severity_chk CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT reconciliation_findings_status_chk CHECK (status IN ('open','resolved','ignored')),
  CONSTRAINT reconciliation_findings_category_chk CHECK (category IN ('membership','receipt','reward','draw','commission','audit'))
);

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_findings_open_uniq
  ON public.reconciliation_findings (category, code, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS reconciliation_findings_status_idx
  ON public.reconciliation_findings (status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_findings_category_idx
  ON public.reconciliation_findings (category, status);

GRANT SELECT, UPDATE ON public.reconciliation_findings TO authenticated;
GRANT ALL ON public.reconciliation_findings TO service_role;

ALTER TABLE public.reconciliation_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view reconciliation findings"
  ON public.reconciliation_findings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update reconciliation findings"
  ON public.reconciliation_findings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS reconciliation_findings_touch ON public.reconciliation_findings;
CREATE TRIGGER reconciliation_findings_touch
  BEFORE UPDATE ON public.reconciliation_findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public._recon_upsert_finding(
  p_category text,
  p_code text,
  p_severity text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_ref text,
  p_description text,
  p_expected jsonb,
  p_actual jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.reconciliation_findings AS f
    (category, code, severity, entity_type, entity_id, entity_ref, description, expected, actual)
  VALUES
    (p_category, p_code, p_severity, p_entity_type, p_entity_id, p_entity_ref, p_description, COALESCE(p_expected, '{}'::jsonb), COALESCE(p_actual, '{}'::jsonb))
  ON CONFLICT (category, code, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open'
  DO UPDATE SET
    last_seen_at = now(),
    occurrence_count = f.occurrence_count + 1,
    expected = EXCLUDED.expected,
    actual = EXCLUDED.actual,
    description = EXCLUDED.description,
    severity = EXCLUDED.severity;
END;
$$;

REVOKE ALL ON FUNCTION public._recon_upsert_finding(text,text,text,text,uuid,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recon_upsert_finding(text,text,text,text,uuid,text,text,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.run_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_membership_issues int := 0;
  v_receipt_issues int := 0;
  v_reward_issues int := 0;
  v_draw_issues int := 0;
  v_commission_issues int := 0;
  v_audit_issues int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT m.id, m.membership_number, m.paid_amount, m.total_amount, m.status,
           COALESCE(p.sum_paid, 0) AS sum_paid
    FROM public.memberships m
    LEFT JOIN (
      SELECT membership_id, SUM(amount) AS sum_paid
      FROM public.payments
      WHERE status = 'paid' AND membership_id IS NOT NULL
      GROUP BY membership_id
    ) p ON p.membership_id = m.id
    WHERE ABS(COALESCE(m.paid_amount,0) - COALESCE(p.sum_paid,0)) > 0.01
  LOOP
    PERFORM public._recon_upsert_finding(
      'membership','paid_amount_mismatch','critical','membership', r.id, r.membership_number,
      format('Membership %s paid_amount (%s) does not match sum of paid payments (%s)', r.membership_number, r.paid_amount, r.sum_paid),
      jsonb_build_object('sum_paid_payments', r.sum_paid),
      jsonb_build_object('paid_amount', r.paid_amount, 'total_amount', r.total_amount, 'status', r.status)
    );
    v_membership_issues := v_membership_issues + 1;
  END LOOP;

  FOR r IN
    SELECT m.id, m.membership_number, m.paid_amount, m.total_amount, m.status
    FROM public.memberships m
    WHERE m.status NOT IN ('cancelled')
      AND (
        (m.paid_amount >= m.total_amount AND m.total_amount > 0 AND m.status <> 'completed') OR
        (m.paid_amount > 0 AND m.paid_amount < m.total_amount AND m.status NOT IN ('active','pending')) OR
        (m.paid_amount = 0 AND m.status NOT IN ('pending','cancelled'))
      )
  LOOP
    PERFORM public._recon_upsert_finding(
      'membership','status_inconsistent','warning','membership', r.id, r.membership_number,
      format('Membership %s status "%s" inconsistent with paid_amount %s/%s', r.membership_number, r.status, r.paid_amount, r.total_amount),
      jsonb_build_object('expected_status',
        CASE
          WHEN r.paid_amount >= r.total_amount AND r.total_amount > 0 THEN 'completed'
          WHEN r.paid_amount > 0 THEN 'active'
          ELSE 'pending'
        END),
      jsonb_build_object('status', r.status, 'paid_amount', r.paid_amount, 'total_amount', r.total_amount)
    );
    v_membership_issues := v_membership_issues + 1;
  END LOOP;

  FOR r IN
    SELECT p.id, p.membership_id, p.amount, p.paid_at
    FROM public.payments p
    LEFT JOIN public.receipts rc ON rc.payment_id = p.id AND rc.voided_at IS NULL
    WHERE p.status = 'paid'
      AND p.paid_at > now() - interval '90 days'
      AND rc.id IS NULL
  LOOP
    PERFORM public._recon_upsert_finding(
      'receipt','missing_receipt','warning','payment', r.id, r.id::text,
      format('Paid payment %s has no receipt generated', r.id),
      jsonb_build_object('should_have_receipt', true),
      jsonb_build_object('payment_amount', r.amount, 'paid_at', r.paid_at)
    );
    v_receipt_issues := v_receipt_issues + 1;
  END LOOP;

  FOR r IN
    SELECT m.id AS membership_id, m.user_id, m.membership_number, t.id AS tier_id, t.name AS tier_name,
           t.trigger_type, t.threshold
    FROM public.memberships m
    JOIN public.reward_tiers t
      ON t.is_active = true
     AND (t.plan_id IS NULL OR t.plan_id = m.plan_id)
    LEFT JOIN public.customer_rewards cr ON cr.membership_id = m.id AND cr.tier_id = t.id
    WHERE cr.id IS NULL
      AND (
        (t.trigger_type = 'membership_completed' AND m.status = 'completed') OR
        (t.trigger_type = 'installments_paid' AND (
          SELECT COUNT(*) FROM public.installments i WHERE i.membership_id = m.id AND i.status = 'paid'
        ) >= t.threshold) OR
        (t.trigger_type = 'advance_paid' AND m.advance_paid >= t.threshold)
      )
  LOOP
    PERFORM public._recon_upsert_finding(
      'reward','missing_reward','warning','membership', r.membership_id, r.membership_number,
      format('Membership %s qualifies for tier "%s" but no reward row exists', r.membership_number, r.tier_name),
      jsonb_build_object('tier_id', r.tier_id, 'tier_name', r.tier_name, 'trigger_type', r.trigger_type, 'threshold', r.threshold),
      jsonb_build_object('customer_reward', null)
    );
    v_reward_issues := v_reward_issues + 1;
  END LOOP;

  FOR r IN
    SELECT cr.id, cr.reward_number, cr.membership_id
    FROM public.customer_rewards cr
    LEFT JOIN public.reward_events re
      ON re.reward_id = cr.id AND re.event_type = 'unlocked'
    WHERE re.id IS NULL
  LOOP
    PERFORM public._recon_upsert_finding(
      'audit','reward_missing_unlock_event','warning','reward', r.id, COALESCE(r.reward_number, r.id::text),
      format('Reward %s has no "unlocked" reward_event in the audit trail', COALESCE(r.reward_number, r.id::text)),
      jsonb_build_object('expected_event_type','unlocked'),
      jsonb_build_object('reward_events_count', 0)
    );
    v_audit_issues := v_audit_issues + 1;
  END LOOP;

  FOR r IN
    SELECT d.id AS draw_id, d.name AS draw_name, m.id AS membership_id, m.user_id, m.membership_number
    FROM public.draws d
    JOIN public.memberships m
      ON (d.plan_id IS NULL OR d.plan_id = m.plan_id)
     AND (NOT d.requires_active_membership OR m.status IN ('active','completed'))
    LEFT JOIN public.draw_entries de ON de.draw_id = d.id AND de.customer_id = m.user_id
    WHERE d.status IN ('scheduled','open')
      AND (d.closes_at IS NULL OR d.closes_at > now())
      AND de.id IS NULL
  LOOP
    PERFORM public._recon_upsert_finding(
      'draw','missing_draw_entry','warning','membership', r.membership_id, r.membership_number,
      format('Membership %s is eligible for draw "%s" but has no entry', r.membership_number, r.draw_name),
      jsonb_build_object('draw_id', r.draw_id, 'draw_name', r.draw_name),
      jsonb_build_object('draw_entry', null)
    );
    v_draw_issues := v_draw_issues + 1;
  END LOOP;

  FOR r IN
    SELECT p.id AS payment_id, p.amount, m.id AS membership_id, m.membership_number, m.promoter_id
    FROM public.payments p
    JOIN public.memberships m ON m.id = p.membership_id
    LEFT JOIN public.promoter_commissions pc ON pc.payment_id = p.id
    WHERE p.status = 'paid'
      AND m.promoter_id IS NOT NULL
      AND p.paid_at > now() - interval '180 days'
      AND pc.id IS NULL
  LOOP
    PERFORM public._recon_upsert_finding(
      'commission','missing_commission','critical','payment', r.payment_id, r.payment_id::text,
      format('Paid payment %s on membership %s (promoter attached) has no commission row', r.payment_id, r.membership_number),
      jsonb_build_object('promoter_id', r.promoter_id, 'membership_id', r.membership_id),
      jsonb_build_object('commission_rows', 0, 'payment_amount', r.amount)
    );
    v_commission_issues := v_commission_issues + 1;
  END LOOP;

  UPDATE public.reconciliation_findings
     SET status = 'resolved',
         resolved_at = now(),
         resolution_note = COALESCE(resolution_note, 'Auto-resolved: condition no longer detected')
   WHERE status = 'open'
     AND last_seen_at < v_started;

  RETURN jsonb_build_object(
    'started_at', v_started,
    'finished_at', now(),
    'membership_issues', v_membership_issues,
    'receipt_issues', v_receipt_issues,
    'reward_issues', v_reward_issues,
    'draw_issues', v_draw_issues,
    'commission_issues', v_commission_issues,
    'audit_issues', v_audit_issues,
    'total', v_membership_issues + v_receipt_issues + v_reward_issues + v_draw_issues + v_commission_issues + v_audit_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_reconciliation() TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_reconciliation_finding(
  p_finding_id uuid,
  p_status text,
  p_note text DEFAULT NULL
) RETURNS public.reconciliation_findings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.reconciliation_findings;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_status NOT IN ('resolved','ignored','open') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE public.reconciliation_findings
     SET status = p_status,
         resolution_note = p_note,
         resolved_by = CASE WHEN p_status = 'open' THEN NULL ELSE auth.uid() END,
         resolved_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END
   WHERE id = p_finding_id
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, action, reason, metadata)
  VALUES (auth.uid(), 'site_settings.updated',
          format('reconciliation.%s: %s', p_status, COALESCE(p_note,'')),
          jsonb_build_object('finding_id', v_row.id, 'category', v_row.category, 'code', v_row.code));

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_reconciliation_finding(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_reconciliation_finding(uuid, text, text) TO authenticated;
