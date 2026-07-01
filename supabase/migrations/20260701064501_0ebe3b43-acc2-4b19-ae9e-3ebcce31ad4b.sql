CREATE TYPE public.payment_status AS ENUM ('created', 'attempted', 'paid', 'failed', 'refunded');
CREATE TYPE public.payment_provider AS ENUM ('razorpay', 'manual', 'cash');

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES public.installments(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider public.payment_provider NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT UNIQUE,
  provider_signature TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status public.payment_status NOT NULL DEFAULT 'created',
  method TEXT,
  error_code TEXT,
  error_description TEXT,
  raw_webhook JSONB,
  notes JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_membership ON public.payments(membership_id);
CREATE INDEX idx_payments_installment ON public.payments(installment_id);
CREATE INDEX idx_payments_customer ON public.payments(customer_id);
CREATE INDEX idx_payments_status ON public.payments(status);

GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own payments"
  ON public.payments FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY "Admins view all payments"
  ON public.payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Promoters view assigned payments"
  ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.id = payments.membership_id
      AND m.promoter_id = auth.uid()
  ));

CREATE POLICY "Admins manage payments"
  ON public.payments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.installments
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mark_installment_paid(
  _installment_id UUID,
  _payment_id UUID,
  _paid_at TIMESTAMPTZ DEFAULT now()
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.installments
  SET status = 'paid',
      paid_at = _paid_at,
      payment_id = _payment_id
  WHERE id = _installment_id AND status <> 'paid';

  UPDATE public.memberships m
  SET paid_amount = COALESCE(paid_amount, 0) + i.amount
  FROM public.installments i
  WHERE i.id = _installment_id AND m.id = i.membership_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_installment_paid(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;