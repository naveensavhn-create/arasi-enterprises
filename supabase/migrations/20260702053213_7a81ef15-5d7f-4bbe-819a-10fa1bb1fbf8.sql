
-- Receipts module
CREATE SEQUENCE IF NOT EXISTS public.receipt_number_seq START WITH 1;

CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES public.installments(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promoter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_method TEXT,
  transaction_id TEXT,
  collected_by TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_customer   ON public.receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_receipts_membership ON public.receipts(membership_id);
CREATE INDEX IF NOT EXISTS idx_receipts_issued_at  ON public.receipts(issued_at DESC);

GRANT SELECT ON public.receipts TO authenticated;
GRANT ALL ON public.receipts TO service_role;

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- Customers see their own receipts
CREATE POLICY "Customers view own receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

-- Promoters see receipts for customers they referred
CREATE POLICY "Promoters view referred receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'promoter')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = receipts.customer_id
         AND p.referred_by_promoter_id = auth.uid()
    )
  );

-- Admins see everything
CREATE POLICY "Admins view all receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_receipts_updated_at
  BEFORE UPDATE ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Receipt number generator: ARASI-YYYY-000001
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := nextval('public.receipt_number_seq');
  RETURN 'ARASI-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');
END $$;

-- Auto-create receipt when a payment moves to 'paid'
CREATE OR REPLACE FUNCTION public.create_receipt_for_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoter UUID;
BEGIN
  IF NEW.status::text <> 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'paid' THEN RETURN NEW; END IF;

  SELECT promoter_id INTO v_promoter FROM public.memberships WHERE id = NEW.membership_id;

  INSERT INTO public.receipts (
    receipt_number, payment_id, membership_id, installment_id, customer_id,
    promoter_id, amount, currency, payment_method, transaction_id, issued_at
  ) VALUES (
    public.generate_receipt_number(), NEW.id, NEW.membership_id, NEW.installment_id, NEW.customer_id,
    v_promoter, NEW.amount, NEW.currency, NEW.method, NEW.provider_payment_id,
    COALESCE(NEW.paid_at, now())
  )
  ON CONFLICT (payment_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_receipt ON public.payments;
CREATE TRIGGER trg_payment_receipt
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.create_receipt_for_payment();

-- Backfill receipts for existing paid payments
INSERT INTO public.receipts (
  receipt_number, payment_id, membership_id, installment_id, customer_id,
  promoter_id, amount, currency, payment_method, transaction_id, issued_at
)
SELECT
  public.generate_receipt_number(),
  p.id, p.membership_id, p.installment_id, p.customer_id,
  m.promoter_id, p.amount, p.currency, p.method, p.provider_payment_id,
  COALESCE(p.paid_at, p.created_at)
FROM public.payments p
JOIN public.memberships m ON m.id = p.membership_id
LEFT JOIN public.receipts r ON r.payment_id = p.id
WHERE p.status::text = 'paid' AND r.id IS NULL;

-- Admin void receipt RPC (soft delete — keeps audit trail)
CREATE OR REPLACE FUNCTION public.admin_void_receipt(_receipt_id UUID, _reason TEXT)
RETURNS public.receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.receipts%ROWTYPE;
  v_actor UUID := auth.uid();
  v_actor_email TEXT;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Void reason is required';
  END IF;

  UPDATE public.receipts
     SET voided_at = now(), voided_by = v_actor, void_reason = btrim(_reason), updated_at = now()
   WHERE id = _receipt_id AND voided_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found or already voided';
  END IF;

  SELECT email INTO v_actor_email FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.admin_audit_log
    (actor_id, actor_email, action, target_user_id, target_email, reason, metadata)
  VALUES (
    v_actor, v_actor_email, 'receipt.voided', v_row.customer_id, NULL, btrim(_reason),
    jsonb_build_object('receipt_id', v_row.id, 'receipt_number', v_row.receipt_number, 'payment_id', v_row.payment_id)
  );

  RETURN v_row;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_void_receipt(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_void_receipt(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_receipt_number() FROM PUBLIC;
