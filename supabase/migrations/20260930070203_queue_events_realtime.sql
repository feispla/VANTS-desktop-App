-- VANTSBETA already owns its players, profiles, ranked_queue and tournaments schema.
-- This additive migration provides a private event stream for the desktop client.

CREATE TYPE public.vantcall_game AS ENUM ('valorant', 'cs2', 'lol');

CREATE TABLE public.queue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game public.vantcall_game,
  event_type text NOT NULL CHECK (event_type IN ('queue_joined', 'match_found', 'queue_cancelled', 'queue_timed_out')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX queue_events_user_created_at_idx
  ON public.queue_events (user_id, created_at DESC);

ALTER TABLE public.queue_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.queue_events TO authenticated;
GRANT USAGE ON TYPE public.vantcall_game TO authenticated;

CREATE POLICY queue_events_read_own
  ON public.queue_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE FUNCTION public.emit_vantcall_queue_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_game public.vantcall_game;
  v_event_type text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
  END IF;

  v_event_type := CASE NEW.status
    WHEN 'waiting' THEN 'queue_joined'
    WHEN 'matched' THEN 'match_found'
    WHEN 'cancelled' THEN 'queue_cancelled'
    WHEN 'timed_out' THEN 'queue_timed_out'
    ELSE NULL
  END;
  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.auth_user_id,
    CASE pg_catalog.lower(p.main_game)
      WHEN 'valorant' THEN 'valorant'::public.vantcall_game
      WHEN 'cs2' THEN 'cs2'::public.vantcall_game
      WHEN 'lol' THEN 'lol'::public.vantcall_game
      ELSE NULL
    END
  INTO v_user_id, v_game
  FROM public.players AS p
  WHERE p.id = NEW.player_id;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.queue_events (user_id, game, event_type, payload)
  VALUES (
    v_user_id,
    v_game,
    v_event_type,
    pg_catalog.jsonb_build_object(
      'queue_id', NEW.id,
      'season_id', NEW.season_id,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_vantcall_queue_event() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ranked_queue_emit_queue_event
  AFTER INSERT OR UPDATE OF status ON public.ranked_queue
  FOR EACH ROW EXECUTE FUNCTION public.emit_vantcall_queue_event();

ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_events;
