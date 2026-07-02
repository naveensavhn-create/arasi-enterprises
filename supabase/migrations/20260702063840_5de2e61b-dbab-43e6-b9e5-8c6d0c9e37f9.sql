
-- Post-payment orchestrator: runs after any payment transitions to 'paid'
CREATE OR REPLACE FUNCTION public.orchestrate_post_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_membership public.memberships%ROWTYPE;
  v_inst public.installments%ROWTYPE;
  v_paid_installments INT := 0;
  v_total_installments INT := 0;
  v_new_status TEXT;
  v_rewards_unlocked INT := 0;
  v_draws_enrolled INT := 0;
  v_draw_id UUID;
  v_actions JSONB := '[]'::jsonb;
BEGIN
  -- Only fire for paid transitions
  IF NEW.status::text <> 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'paid' THEN RETURN NEW; END IF;
  IF NEW.membership_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_membership FROM public.memberships WHERE id = NEW.membership_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- 1) Mark the linked installment as paid (idempotent)
  IF NEW.installment_id IS NOT NULL THEN
    SELECT * INTO v_inst FROM public.installments WHERE id = NEW.installment_id;
    IF FOUND AND v_inst.status <> 'paid' THEN
      UPDATE public.installments
         SET status = 'paid',
             paid_at = COALESCE(NEW.paid_at, now()),
             paid_amount = NEW.amount,
             payment_id = NEW.id,
             payment_reference = NEW.provider_payment_id,
             updated_at = now()
       WHERE id = NEW.installment_id;
      v_actions := v_actions || jsonb_build_object('installment_marked_paid', NEW.installment_id);
    END IF;
  END IF;

  -- 2) Recompute membership paid_amount and status
  UPDATE public.memberships m
     SET paid_amount = COALESCE((
           SELECT SUM(p.amount) FROM public.payments p
            WHERE p.membership_id = m.id AND p.status::text = 'paid'
         ), 0),
         updated_at = now()
   WHERE id = NEW.membership_id
   RETURNING * INTO v_membership;

  SELECT COUNT(*) FILTER (WHERE status = 'paid'), COUNT(*)
    INTO v_paid_installments, v_total_installments
    FROM public.installments WHERE membership_id = NEW.membership_id;

  -- Activate on first payment; mark completed when all installments paid
  IF v_membership.status = 'pending' THEN
    UPDATE public.memberships SET status = 'active', updated_at = now()
     WHERE id = NEW.membership_id;
    v_new_status := 'active';
    v_actions := v_actions || jsonb_build_object('membership_activated', true);
  END IF;

  IF v_total_installments > 0 AND v_paid_installments >= v_total_installments THEN
    UPDATE public.memberships SET status = 'completed', updated_at = now()
     WHERE id = NEW.membership_id AND status <> 'completed';
    v_new_status := 'completed';
    v_actions := v_actions || jsonb_build_object('membership_completed', true);
  END IF;

  -- 3) Recompute reward eligibility
  BEGIN
    v_rewards_unlocked := public.recompute_customer_rewards(NEW.membership_id);
    IF v_rewards_unlocked > 0 THEN
      v_actions := v_actions || jsonb_build_object('rewards_unlocked', v_rewards_unlocked);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_actions := v_actions || jsonb_build_object('rewards_error', SQLERRM);
  END;

  -- 4) Auto-enroll into eligible open automated draws
  FOR v_draw_id IN
    SELECT d.id FROM public.draws d
     WHERE d.mode = 'automated'
       AND d.status IN ('scheduled','open')
       AND (d.closes_at IS NULL OR d.closes_at > now())
       AND (d.plan_id IS NULL OR d.plan_id = v_membership.plan_id)
  LOOP
    IF public.auto_enroll_customer_in_draw(v_draw_id, NEW.customer_id) IS NOT NULL THEN
      v_draws_enrolled := v_draws_enrolled + 1;
    END IF;
  END LOOP;
  IF v_draws_enrolled > 0 THEN
    v_actions := v_actions || jsonb_build_object('draws_enrolled', v_draws_enrolled);
  END IF;

  -- 5) Audit log
  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    NULL, 'system@arasi', 'payment.post_processed', NEW.customer_id, NULL,
    'Automated post-payment workflow',
    jsonb_build_object(
      'payment_id', NEW.id,
      'membership_id', NEW.membership_id,
      'installment_id', NEW.installment_id,
      'amount', NEW.amount,
      'paid_installments', v_paid_installments,
      'total_installments', v_total_installments,
      'membership_status', COALESCE(v_new_status, v_membership.status::text),
      'actions', v_actions
    )
  );

  -- 6) Notify customer of successful payment
  INSERT INTO public.notifications(user_id, type, title, body, link, metadata)
  VALUES (
    NEW.customer_id, 'payment_received', 'Payment received',
    'We received your payment of ₹' || NEW.amount || '. Thank you!',
    '/customer/installments',
    jsonb_build_object('payment_id', NEW.id, 'membership_id', NEW.membership_id)
  );

  RETURN NEW;
END;
$$;

-- Run AFTER the existing receipt + commission triggers (alphabetical ordering: z_ prefix ensures last)
DROP TRIGGER IF EXISTS z_trg_payment_post_orchestrator ON public.payments;
CREATE TRIGGER z_trg_payment_post_orchestrator
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.orchestrate_post_payment();
