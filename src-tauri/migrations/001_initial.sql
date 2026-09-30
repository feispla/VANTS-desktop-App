CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches_cache (
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cache_key, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_matches_cache_user_synced
  ON matches_cache (user_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications (created_at DESC);
