CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE browser_targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  channel TEXT NOT NULL,
  requested_version TEXT NOT NULL,
  target_os TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('minimum', 'exact', 'newest-provisioned')),
  required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, family, channel, requested_version, target_os, kind)
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  os TEXT,
  architecture TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_seen TEXT,
  status TEXT NOT NULL
);

CREATE TABLE browser_builds (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  channel TEXT NOT NULL,
  requested_version TEXT NOT NULL,
  actual_version TEXT,
  driver_version TEXT,
  os TEXT,
  arch TEXT,
  image_ref TEXT,
  image_digest TEXT,
  worker_id TEXT,
  last_verified_at TEXT,
  verified_status TEXT NOT NULL DEFAULT 'unverified',
  verification_message TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
  browser_build_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  requested_version TEXT NOT NULL,
  actual_browser_version TEXT,
  actual_os TEXT,
  actual_arch TEXT,
  grid_session_id TEXT,
  state TEXT NOT NULL,
  driver_state TEXT NOT NULL DEFAULT 'none',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_activity_at TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  navigation_error TEXT,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER NOT NULL,
  effective_width INTEGER,
  effective_height INTEGER,
  build_label TEXT,
  tester TEXT,
  verification_json TEXT
);
CREATE INDEX sessions_project_time ON sessions (project_id, started_at DESC);
CREATE INDEX sessions_state ON sessions (state);
CREATE INDEX sessions_build ON sessions (browser_build_id, started_at DESC);

-- One final result per session; saving again replaces it (checked_at records the latest save).
CREATE TABLE results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('not-run', 'passed', 'failed', 'blocked', 'skipped')),
  notes TEXT NOT NULL DEFAULT '',
  checklist TEXT NOT NULL DEFAULT '',
  tester TEXT,
  checked_at TEXT NOT NULL
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_basename TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  actual_browser_version TEXT,
  source TEXT NOT NULL CHECK (source IN ('webdriver-viewport', 'vnc-desktop', 'browser-download'))
);
CREATE INDEX evidence_session ON evidence (session_id);
