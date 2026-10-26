-- ISO Desk private workspaces, first version. Apply every migration with:
--   npx wrangler d1 migrations apply iso-desk --remote
-- Every statement is idempotent so the file can be re-run.

CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);

-- member is the person id the app data uses (repId, follow-up "by"), e.g. 'u1'.
-- pass holds 'v1$<salt>$<sha256 hex>' of the key the browser derives with PBKDF2.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, ws TEXT NOT NULL, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  member TEXT NOT NULL, phone TEXT, pass TEXT, role TEXT NOT NULL DEFAULT 'owner', created INTEGER NOT NULL);

-- token is the sha256 hex of the secret in the invite link. One use, then dead.
CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, ws TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
  member TEXT NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'owner', expires INTEGER NOT NULL, used_at INTEGER);

-- token is the sha256 hex of the session cookie value.
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, ws TEXT NOT NULL,
  created INTEGER NOT NULL, expires INTEGER NOT NULL, ua TEXT);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- One row per app record. updated_at is the editing device's clock and decides which edit wins.
-- server_at is when the row last changed here, so devices can ask for "everything since".
CREATE TABLE IF NOT EXISTS records (ws TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL,
  server_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, PRIMARY KEY (ws, kind, id));
CREATE INDEX IF NOT EXISTS records_sync ON records (ws, server_at);

-- Open follow-ups with a due time, kept in step with the records, read every minute by the alerts worker.
CREATE TABLE IF NOT EXISTS alerts (ws TEXT NOT NULL, fid TEXT NOT NULL, rec_kind TEXT NOT NULL, rec_id TEXT NOT NULL,
  at INTEGER NOT NULL, title TEXT, body TEXT, sent_at INTEGER, PRIMARY KEY (ws, fid));
CREATE INDEX IF NOT EXISTS alerts_due ON alerts (sent_at, at);
CREATE INDEX IF NOT EXISTS alerts_rec ON alerts (ws, rec_id);

CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, ws TEXT NOT NULL, user_id TEXT NOT NULL, p256dh TEXT NOT NULL,
  auth TEXT NOT NULL, ua TEXT, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS push_ws ON push_subs (ws);

-- Failed sign-in counter per email and per IP.
CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, ws TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL,
  page TEXT, created INTEGER NOT NULL);
