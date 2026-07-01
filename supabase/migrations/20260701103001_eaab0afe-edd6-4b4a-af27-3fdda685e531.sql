
-- Seed 3 payment fixtures for UI regression coverage (advance, monthly, refunded)
INSERT INTO public.payments (id, membership_id, installment_id, customer_id, provider, provider_order_id, provider_payment_id, amount, currency, status, method, paid_at, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'e5195588-f9b2-448a-937e-457e86a88884', NULL,                                    '8176ae0d-67e4-4a7b-9267-b9bc8d72db4b', 'razorpay', 'order_TESTADV0001', 'pay_TESTADV0001', 5000, 'INR', 'paid',     'upi',  now() - interval '30 days', now() - interval '30 days'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'e5195588-f9b2-448a-937e-457e86a88884', 'fb6e2f8e-9495-4a0e-9097-1a9ae4193e6d', '8176ae0d-67e4-4a7b-9267-b9bc8d72db4b', 'razorpay', 'order_TESTMON0001', 'pay_TESTMON0001', 2500, 'INR', 'paid',     'card', now() - interval '5 days',  now() - interval '5 days'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'e5195588-f9b2-448a-937e-457e86a88884', 'bb116a8e-3781-406c-bb98-c88fbee4a016', '8176ae0d-67e4-4a7b-9267-b9bc8d72db4b', 'razorpay', 'order_TESTREF0001', 'pay_TESTREF0001', 2500, 'INR', 'refunded', 'card', now() - interval '2 days',  now() - interval '10 days')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  provider_order_id = EXCLUDED.provider_order_id,
  provider_payment_id = EXCLUDED.provider_payment_id,
  amount = EXCLUDED.amount,
  paid_at = EXCLUDED.paid_at;
