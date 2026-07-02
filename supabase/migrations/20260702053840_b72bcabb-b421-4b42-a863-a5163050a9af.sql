
-- 1. notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins insert notifications" ON public.notifications;
CREATE POLICY "Admins insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id) WHERE read_at IS NULL;

-- 2. Trigger: notify winner + their promoter when a draw winner row is inserted
CREATE OR REPLACE FUNCTION public.notify_on_draw_winner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _draw RECORD;
  _promoter UUID;
  _customer_name TEXT;
BEGIN
  SELECT id, name, prize INTO _draw FROM public.draws WHERE id = NEW.draw_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT referred_by_promoter_id, COALESCE(full_name, 'A member')
    INTO _promoter, _customer_name
  FROM public.profiles WHERE id = NEW.customer_id;

  -- Winner notification
  INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
  VALUES (
    NEW.customer_id,
    'draw_winner',
    'You won ' || _draw.name || '!',
    'Congratulations! You secured position #' || NEW.position ||
      COALESCE(' — Prize: ' || NEW.prize, COALESCE(' — Prize: ' || _draw.prize, '')) || '.',
    '/customer/draw-results',
    jsonb_build_object(
      'draw_id', NEW.draw_id,
      'winner_id', NEW.id,
      'position', NEW.position,
      'prize', COALESCE(NEW.prize, _draw.prize)
    )
  );

  -- Promoter notification (if the customer was referred by one)
  IF _promoter IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
    VALUES (
      _promoter,
      'referred_customer_won',
      'Your referral won ' || _draw.name,
      _customer_name || ' won position #' || NEW.position ||
        COALESCE(' (' || COALESCE(NEW.prize, _draw.prize) || ')', '') || '.',
      '/promoter/customers',
      jsonb_build_object(
        'draw_id', NEW.draw_id,
        'winner_id', NEW.id,
        'customer_id', NEW.customer_id,
        'position', NEW.position
      )
    );
  END IF;

  UPDATE public.draw_winners SET notified_at = now() WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_draw_winner ON public.draw_winners;
CREATE TRIGGER trg_notify_on_draw_winner
  AFTER INSERT ON public.draw_winners
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_draw_winner();

-- 3. Convenience RPCs
CREATE OR REPLACE FUNCTION public.mark_notification_read(_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = _id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications
     SET read_at = now()
   WHERE user_id = auth.uid() AND read_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
