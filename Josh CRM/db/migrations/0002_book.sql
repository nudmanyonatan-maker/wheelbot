-- The book as real tables, so the server can tell whose shop is whose, match imports against
-- everything already here, and keep a log of every change.
--
-- The app still sends whole records ({ shops, deals, msgs, meta }). lib/book.js splits each one
-- into these rows and puts it back together on the way out. In every table `data` holds the
-- record itself; the other columns are copies kept for lookups and permission checks.
-- updated_at is the editing device's clock and decides which edit wins. server_at is when the
-- row last changed here, so a device can ask for "everything since".
-- Replaces the generic `records` table from 0001, which is left in place but no longer used.

-- rep_id is the member whose book the shop is in. NULL means nobody looks after it yet.
CREATE TABLE IF NOT EXISTS shops (ws TEXT NOT NULL, id TEXT NOT NULL, rep_id TEXT, name TEXT NOT NULL, norm_name TEXT NOT NULL,
  state TEXT, updated_at INTEGER NOT NULL, server_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
  PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS shops_rep ON shops (ws, rep_id);
CREATE INDEX IF NOT EXISTS shops_norm ON shops (ws, norm_name);
CREATE INDEX IF NOT EXISTS shops_sync ON shops (ws, server_at);

-- The people at a shop. phone_key and phone2_key are the last 10 digits; email_domain is blank
-- for free mail (gmail and the like) so it only ever matches a company's own domain.
CREATE TABLE IF NOT EXISTS contacts (ws TEXT NOT NULL, shop_id TEXT NOT NULL, id TEXT NOT NULL, pos INTEGER NOT NULL,
  name TEXT, role TEXT, phone_key TEXT, phone2_key TEXT, email TEXT, email_domain TEXT, data TEXT NOT NULL,
  PRIMARY KEY (ws, shop_id, id));
CREATE INDEX IF NOT EXISTS contacts_phone ON contacts (ws, phone_key);
CREATE INDEX IF NOT EXISTS contacts_phone2 ON contacts (ws, phone2_key);
CREATE INDEX IF NOT EXISTS contacts_domain ON contacts (ws, email_domain);

-- A deal is in whichever book its shop is in.
CREATE TABLE IF NOT EXISTS deals (ws TEXT NOT NULL, id TEXT NOT NULL, shop_id TEXT NOT NULL, stage TEXT, merchant TEXT,
  merchant_norm TEXT, submitted_at TEXT, updated_at INTEGER NOT NULL, server_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL, PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS deals_shop ON deals (ws, shop_id);
CREATE INDEX IF NOT EXISTS deals_merchant ON deals (ws, merchant_norm);
CREATE INDEX IF NOT EXISTS deals_sync ON deals (ws, server_at);

-- Follow-ups on a shop or a deal. at is the due moment in ms, worked out on the device.
CREATE TABLE IF NOT EXISTS follow_ups (ws TEXT NOT NULL, parent_kind TEXT NOT NULL, parent_id TEXT NOT NULL, id TEXT NOT NULL,
  pos INTEGER NOT NULL, by_member TEXT, due TEXT, time TEXT, at INTEGER, done_at TEXT, note TEXT, data TEXT NOT NULL,
  PRIMARY KEY (ws, parent_kind, parent_id, id));
CREATE INDEX IF NOT EXISTS follow_ups_open ON follow_ups (ws, done_at, at);

-- Calls and texts. rep_id is the member whose line it was on.
CREATE TABLE IF NOT EXISTS messages (ws TEXT NOT NULL, id TEXT NOT NULL, rep_id TEXT, phone_key TEXT, dir TEXT, kind TEXT, at TEXT,
  updated_at INTEGER NOT NULL, server_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
  PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS messages_rep ON messages (ws, rep_id);
CREATE INDEX IF NOT EXISTS messages_phone ON messages (ws, phone_key);
CREATE INDEX IF NOT EXISTS messages_sync ON messages (ws, server_at);

-- Each person's own settings: their number, text templates, alert timing, blocked numbers.
CREATE TABLE IF NOT EXISTS settings (ws TEXT NOT NULL, member TEXT NOT NULL, updated_at INTEGER NOT NULL, server_at INTEGER NOT NULL,
  data TEXT NOT NULL, PRIMARY KEY (ws, member));

-- Every change, who made it and what it was. Written by the server, never by the app.
-- action: create, update, delete, sign-in, invite, role, remove, password.
-- changes: JSON list of { f, from, to } or { f, added, removed, changed } for lists.
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ws TEXT NOT NULL, at INTEGER NOT NULL, user_id TEXT,
  member TEXT, who TEXT, action TEXT NOT NULL, kind TEXT, rec_id TEXT, label TEXT, changes TEXT);
CREATE INDEX IF NOT EXISTS audit_ws ON audit (ws, id);
CREATE INDEX IF NOT EXISTS audit_rec ON audit (ws, kind, rec_id);
CREATE INDEX IF NOT EXISTS audit_member ON audit (ws, member, id);

-- Roles: 'manager' sees and edits every book, 'rep' only their own. The first version called
-- the manager 'owner', which still counts as manager. Removed people keep their history.
ALTER TABLE users ADD COLUMN disabled_at INTEGER;

-- Follow-up alerts go only to the devices of the person whose follow-up it is.
ALTER TABLE alerts ADD COLUMN member TEXT;
