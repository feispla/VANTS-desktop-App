CREATE TABLE IF NOT EXISTS anonymous_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL CHECK (event_name IN ('session_start', 'feature_used')),
  feature TEXT CHECK (feature IS NULL OR feature IN ('dashboard', 'matches', 'tournaments', 'profile', 'settings')),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (event_name = 'session_start' AND feature IS NULL)
    OR (event_name = 'feature_used' AND feature IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_anonymous_analytics_event_time
  ON anonymous_analytics (event_name, occurred_at);
