ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.razorpay_webhook_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.installments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.memberships;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.razorpay_webhook_events REPLICA IDENTITY FULL;
ALTER TABLE public.installments REPLICA IDENTITY FULL;
ALTER TABLE public.memberships REPLICA IDENTITY FULL;