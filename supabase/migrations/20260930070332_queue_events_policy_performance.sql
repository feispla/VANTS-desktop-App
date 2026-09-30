-- Supabase recommends evaluating auth.uid() once per query instead of once per row.
ALTER POLICY queue_events_read_own
  ON public.queue_events
  USING (user_id = (SELECT auth.uid()));
