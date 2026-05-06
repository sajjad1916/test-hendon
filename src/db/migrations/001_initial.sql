-- Hendon Signal Agent — initial schema
-- Tables: agencies, signal_events, daily_drop, surface_history, settings, uploads
-- Designed to be Postgres-portable for the production handoff.

CREATE TABLE IF NOT EXISTS agencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  phone TEXT,
  email TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_age INTEGER,
  license_type TEXT NOT NULL DEFAULT 'unknown',
  segment TEXT,
  tam_status TEXT NOT NULL DEFAULT 'active',
  is_icp INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_in_upload_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agencies_state ON agencies (state);
CREATE INDEX IF NOT EXISTS idx_agencies_is_icp ON agencies (is_icp);
CREATE INDEX IF NOT EXISTS idx_agencies_tam_status ON agencies (tam_status);
CREATE INDEX IF NOT EXISTS idx_agencies_license_type ON agencies (license_type);

CREATE TABLE IF NOT EXISTS signal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES agencies (id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  evidence TEXT,
  is_internal INTEGER NOT NULL DEFAULT 0,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signal_events_agency ON signal_events (agency_id);
CREATE INDEX IF NOT EXISTS idx_signal_events_type ON signal_events (signal_type);
CREATE INDEX IF NOT EXISTS idx_signal_events_detected_at ON signal_events (detected_at);

CREATE TABLE IF NOT EXISTS daily_drop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES agencies (id) ON DELETE CASCADE,
  drop_date TEXT NOT NULL,
  tier TEXT NOT NULL,
  reason TEXT,
  key_signals TEXT,
  signal_event_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agency_id, drop_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_drop_date ON daily_drop (drop_date);
CREATE INDEX IF NOT EXISTS idx_daily_drop_tier ON daily_drop (tier);

CREATE TABLE IF NOT EXISTS surface_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES agencies (id) ON DELETE CASCADE,
  surfaced_at TEXT NOT NULL DEFAULT (datetime('now')),
  tier TEXT NOT NULL,
  drop_id INTEGER REFERENCES daily_drop (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_surface_history_agency ON surface_history (agency_id);
CREATE INDEX IF NOT EXISTS idx_surface_history_surfaced_at ON surface_history (surfaced_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  conflict_mode TEXT,
  row_count_in INTEGER,
  row_count_inserted INTEGER,
  row_count_updated INTEGER,
  row_count_errors INTEGER,
  icp_pass_count INTEGER,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_at ON uploads (uploaded_at);
CREATE INDEX IF NOT EXISTS idx_uploads_file_hash ON uploads (file_hash);
