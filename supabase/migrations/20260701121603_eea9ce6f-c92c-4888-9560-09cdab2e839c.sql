
CREATE TABLE public.export_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'payments_csv',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','expired','cancelled')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer,
  byte_size bigint,
  storage_path text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz,
  notified_at timestamptz
);

CREATE INDEX export_jobs_status_created_idx ON public.export_jobs (status, created_at);
CREATE INDEX export_jobs_requested_by_idx ON public.export_jobs (requested_by, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.export_jobs TO authenticated;
GRANT ALL ON public.export_jobs TO service_role;

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own export jobs"
  ON public.export_jobs FOR SELECT
  TO authenticated
  USING (
    requested_by = auth.uid()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Admins insert own export jobs"
  ON public.export_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Admins update own export jobs"
  ON public.export_jobs FOR UPDATE
  TO authenticated
  USING (
    requested_by = auth.uid()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    requested_by = auth.uid()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );
