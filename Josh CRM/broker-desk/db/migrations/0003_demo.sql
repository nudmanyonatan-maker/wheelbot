-- Guest sign-in for demo workspaces, and the feedback people send from inside the desk.
ALTER TABLE sessions ADD COLUMN kind TEXT;
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ws TEXT NOT NULL, at INTEGER NOT NULL, member TEXT, who TEXT,
  guest INTEGER NOT NULL DEFAULT 0, route TEXT, text TEXT NOT NULL, ua TEXT, done_at INTEGER);
CREATE INDEX IF NOT EXISTS feedback_ws ON feedback (ws, at);
