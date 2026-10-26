-- Broker Desk: workspaces, logins, sessions and the change log. Same model as ISO Desk.
-- Apply with: npx wrangler d1 migrations apply broker-desk --local

-- One brokerage per workspace. brand holds { color, logoText } for the header and the public form.
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, brand TEXT, created INTEGER NOT NULL);

-- member is the short id used everywhere else (lead owner, call rep), e.g. 'u1'.
-- pass holds 'v1$<salt>$<sha256 hex>' of the key the browser derives with PBKDF2.
-- role: 'manager' sees every lead, 'rep' only their own.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, ws TEXT NOT NULL, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  member TEXT NOT NULL, phone TEXT, pass TEXT, role TEXT NOT NULL DEFAULT 'manager', created INTEGER NOT NULL, disabled_at INTEGER);
CREATE INDEX IF NOT EXISTS users_ws ON users (ws);

CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, ws TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
  member TEXT NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'manager', expires INTEGER NOT NULL, used_at INTEGER);

CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, ws TEXT NOT NULL,
  created INTEGER NOT NULL, expires INTEGER NOT NULL, ua TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);

-- Every change, who made it and what it was. Written by the server only.
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ws TEXT NOT NULL, at INTEGER NOT NULL, user_id TEXT,
  member TEXT, who TEXT, action TEXT NOT NULL, kind TEXT, rec_id TEXT, label TEXT, changes TEXT);
CREATE INDEX IF NOT EXISTS audit_ws ON audit (ws, id);
CREATE INDEX IF NOT EXISTS audit_rec ON audit (ws, kind, rec_id);
