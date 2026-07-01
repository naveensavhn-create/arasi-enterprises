
CREATE OR REPLACE FUNCTION public.admin_payments_totals(
  _status text DEFAULT NULL,
  _from timestamp with time zone DEFAULT NULL,
  _to timestamp with time zone DEFAULT NULL,
  _customer_ids uuid[] DEFAULT NULL,
  _membership_ids uuid[] DEFAULT NULL,
  _q text DEFAULT NULL,
  _order_id text DEFAULT NULL,
  _payment_id text DEFAULT NULL,
  _customer_ids_exact uuid[] DEFAULT NULL
)
RETURNS TABLE(total_count bigint, paid_count bigint, paid_sum numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT
    count(*)::bigint AS total_count,
    count(*) FILTER (WHERE p.status::text = 'paid')::bigint AS paid_count,
    COALESCE(sum(p.amount) FILTER (WHERE p.status::text = 'paid'), 0)::numeric AS paid_sum
  FROM public.payments p
  WHERE (_status IS NULL OR p.status::text = _status)
    AND (_from IS NULL OR p.created_at >= _from)
    AND (_to   IS NULL OR p.created_at <  _to)
    AND (_order_id   IS NULL OR p.provider_order_id   ILIKE '%' || _order_id   || '%')
    AND (_payment_id IS NULL OR p.provider_payment_id ILIKE '%' || _payment_id || '%')
    AND (_customer_ids_exact IS NULL OR p.customer_id = ANY(_customer_ids_exact))
    AND (
      _q IS NULL OR (
        p.provider_order_id   ILIKE '%' || _q || '%' OR
        p.provider_payment_id ILIKE '%' || _q || '%' OR
        (_customer_ids   IS NOT NULL AND p.customer_id   = ANY(_customer_ids)) OR
        (_membership_ids IS NOT NULL AND p.membership_id = ANY(_membership_ids))
      )
    );
END;
$function$;
