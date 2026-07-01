
CREATE TABLE public.payment_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  stored_status TEXT NOT NULL,
  provider_status TEXT,
  provider_amount NUMERIC(12,2),
  provider_method TEXT,
  provider_error TEXT,
  mismatch BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  checked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_reconciliations_payment ON public.payment_reconciliations(payment_id);
CREATE INDEX idx_payment_reconciliations_open ON public.payment_reconciliations(created_at DESC) WHERE mismatch = true AND resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_reconciliations TO authenticated;
GRANT ALL ON public.payment_reconciliations TO service_role;

ALTER TABLE public.payment_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage reconciliations"
  ON public.payment_reconciliations
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
