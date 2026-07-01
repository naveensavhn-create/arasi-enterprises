-- Prevent duplicate winner selection: a customer can win a given draw at most once.
ALTER TABLE public.draw_winners
  ADD CONSTRAINT draw_winners_draw_customer_unique UNIQUE (draw_id, customer_id);