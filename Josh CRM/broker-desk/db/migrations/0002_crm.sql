-- Broker Desk CRM tables. Times are milliseconds since 1970 unless named *_day.
-- Leads are queried on the server with paging, so a brokerage can hold tens of thousands of them.

-- A lead is a business before (and after) it applies. The primary contact is copied onto the row
-- (contact_name, phone_key, email_lc) so lists can show and search it without a join.
-- consent: 'express' (they opted in), 'implied' (existing business relationship or published
-- address), 'none'. CASL needs one of the first two before any bulk email or text.
CREATE TABLE IF NOT EXISTS leads (ws TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, name TEXT NOT NULL, name_norm TEXT NOT NULL,
  status TEXT NOT NULL, source TEXT, list_tag TEXT, province TEXT, city TEXT, industry TEXT,
  contact_name TEXT, phone_key TEXT, email_lc TEXT, monthly_revenue INTEGER, requested INTEGER,
  consent TEXT NOT NULL DEFAULT 'none', consent_source TEXT, consent_at INTEGER,
  dnc INTEGER NOT NULL DEFAULT 0, sms_opt_out INTEGER NOT NULL DEFAULT 0, email_opt_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_contact_at INTEGER, last_call_at INTEGER, calls INTEGER NOT NULL DEFAULT 0,
  next_task_at INTEGER, deal_id TEXT, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS leads_status ON leads (ws, deleted, status, created_at);
CREATE INDEX IF NOT EXISTS leads_owner ON leads (ws, owner, created_at);
CREATE INDEX IF NOT EXISTS leads_list ON leads (ws, list_tag, created_at);
CREATE INDEX IF NOT EXISTS leads_name ON leads (ws, name_norm);
CREATE INDEX IF NOT EXISTS leads_phone ON leads (ws, phone_key);
CREATE INDEX IF NOT EXISTS leads_email ON leads (ws, email_lc);
CREATE INDEX IF NOT EXISTS leads_contacted ON leads (ws, last_contact_at);
CREATE INDEX IF NOT EXISTS leads_created ON leads (ws, created_at);

-- Everyone at a lead. Inbound calls, texts and emails are matched to a lead through these.
CREATE TABLE IF NOT EXISTS contacts (ws TEXT NOT NULL, lead_id TEXT NOT NULL, id TEXT NOT NULL, pos INTEGER NOT NULL,
  name TEXT, title TEXT, phone TEXT, phone_key TEXT, phone2 TEXT, phone2_key TEXT, email TEXT, email_lc TEXT,
  PRIMARY KEY (ws, lead_id, id));
CREATE INDEX IF NOT EXISTS contacts_phone ON contacts (ws, phone_key);
CREATE INDEX IF NOT EXISTS contacts_phone2 ON contacts (ws, phone2_key);
CREATE INDEX IF NOT EXISTS contacts_email ON contacts (ws, email_lc);

-- Calls, texts, emails, voicemails, notes and system events, on a lead and optionally a deal.
-- kind: call, sms, email, note, status, form, submission, system. dir: in, out, or NULL.
-- status for calls: ringing, answered, completed, no-answer, busy, failed, voicemail, missed, abandoned.
-- unread marks inbound items the inbox should show until someone handles them.
CREATE TABLE IF NOT EXISTS activities (ws TEXT NOT NULL, id TEXT NOT NULL, lead_id TEXT, deal_id TEXT, kind TEXT NOT NULL, dir TEXT,
  member TEXT, at INTEGER NOT NULL, status TEXT, duration INTEGER, outcome TEXT, subject TEXT, body TEXT, other TEXT, via TEXT,
  provider_id TEXT, thread_key TEXT, unread INTEGER NOT NULL DEFAULT 0, handled_at INTEGER, cost_cents INTEGER, data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS act_lead ON activities (ws, lead_id, at);
CREATE INDEX IF NOT EXISTS act_deal ON activities (ws, deal_id, at);
CREATE INDEX IF NOT EXISTS act_member ON activities (ws, member, at);
CREATE INDEX IF NOT EXISTS act_kind ON activities (ws, kind, at);
CREATE INDEX IF NOT EXISTS act_provider ON activities (ws, provider_id);
CREATE INDEX IF NOT EXISTS act_unread ON activities (ws, unread, at);

CREATE TABLE IF NOT EXISTS tasks (ws TEXT NOT NULL, id TEXT NOT NULL, lead_id TEXT, deal_id TEXT, member TEXT, due_at INTEGER NOT NULL,
  note TEXT, kind TEXT NOT NULL DEFAULT 'follow-up', done_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS tasks_open ON tasks (ws, member, done_at, due_at);
CREATE INDEX IF NOT EXISTS tasks_lead ON tasks (ws, lead_id);

-- A deal is one funding request for a lead. data holds the statements checklist, the lenders it
-- went to (submissions), their offers, the closing checklist and renewal links.
CREATE TABLE IF NOT EXISTS deals (ws TEXT NOT NULL, id TEXT NOT NULL, lead_id TEXT NOT NULL, owner TEXT, stage TEXT NOT NULL,
  business TEXT NOT NULL, requested INTEGER, funded_amount INTEGER, funded_at INTEGER, lender_id TEXT, commission INTEGER,
  commission_paid_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, stage_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS deals_stage ON deals (ws, deleted, stage);
CREATE INDEX IF NOT EXISTS deals_owner ON deals (ws, owner);
CREATE INDEX IF NOT EXISTS deals_lead ON deals (ws, lead_id);

-- The funders a brokerage sends files to, with each one's rules.
CREATE TABLE IF NOT EXISTS lenders (ws TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (ws, id));

-- Workspace settings by key: statuses, lists, templates, compliance, phone, brand, form, dialer.
CREATE TABLE IF NOT EXISTS settings (ws TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ws, key));
-- Each person's own settings: pinned lists, dialer line count, signature.
CREATE TABLE IF NOT EXISTS member_settings (ws TEXT NOT NULL, member TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ws, member));

-- ---------- phone ----------
-- One phone account per brokerage: a sub-account at the carrier, the texting registration, and a
-- prepaid wallet that calls, texts and numbers draw from. provider 'sim' is the built-in demo line.
CREATE TABLE IF NOT EXISTS phone_accounts (ws TEXT PRIMARY KEY, provider TEXT NOT NULL, sub_sid TEXT, sub_secret TEXT,
  registration TEXT NOT NULL DEFAULT '{}', balance_cents INTEGER NOT NULL DEFAULT 0, auto_recharge TEXT NOT NULL DEFAULT '{}',
  spend_cap_cents INTEGER, markup_pct INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS numbers (ws TEXT NOT NULL, id TEXT NOT NULL, e164 TEXT NOT NULL, label TEXT, member TEXT, provider_sid TEXT,
  area_code TEXT, monthly_cents INTEGER NOT NULL, created_at INTEGER NOT NULL, released_at INTEGER, PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS numbers_e164 ON numbers (e164);
-- Money in and out of the wallet. cents is negative for usage. kind: topup, number, call, sms, amd, recording, refund.
CREATE TABLE IF NOT EXISTS wallet (ws TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, cents INTEGER NOT NULL,
  ref TEXT, note TEXT, PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS wallet_at ON wallet (ws, at);

-- Dialer sessions. queue is the lead ids still to call, in order.
CREATE TABLE IF NOT EXISTS dial_sessions (ws TEXT NOT NULL, id TEXT NOT NULL, member TEXT NOT NULL, list_id TEXT, title TEXT,
  lines INTEGER NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, queue TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (ws, id));
-- Calls placed by the multi-line dialer per calendar month, for the 5% abandoned-call rule.
CREATE TABLE IF NOT EXISTS dial_month (ws TEXT NOT NULL, month TEXT NOT NULL, placed INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0, abandoned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ws, month));
-- Live dialer legs on the real carrier, so the first answer wins and the rest are dropped.
CREATE TABLE IF NOT EXISTS dial_legs (ws TEXT NOT NULL, sid TEXT NOT NULL, session_id TEXT NOT NULL, lead_id TEXT, activity_id TEXT,
  status TEXT, answered_by TEXT, connected INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (ws, sid));
CREATE INDEX IF NOT EXISTS dial_legs_session ON dial_legs (ws, session_id);

-- Internal do-not-call list (CRTC) and email suppression list (CASL).
CREATE TABLE IF NOT EXISTS dnc (ws TEXT NOT NULL, phone_key TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL, PRIMARY KEY (ws, phone_key));
CREATE TABLE IF NOT EXISTS suppress (ws TEXT NOT NULL, email_lc TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL, PRIMARY KEY (ws, email_lc));

-- ---------- email ----------
CREATE TABLE IF NOT EXISTS mailboxes (ws TEXT NOT NULL, member TEXT NOT NULL, provider TEXT NOT NULL, address TEXT NOT NULL,
  grant_id TEXT, status TEXT NOT NULL, connected_at INTEGER NOT NULL, daily_cap INTEGER NOT NULL DEFAULT 400, PRIMARY KEY (ws, member));
CREATE TABLE IF NOT EXISTS sequences (ws TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  steps TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ws, id));
-- status: active, replied, done, stopped, unsubscribed.
CREATE TABLE IF NOT EXISTS enrollments (ws TEXT NOT NULL, id TEXT NOT NULL, seq_id TEXT NOT NULL, lead_id TEXT NOT NULL, member TEXT,
  step INTEGER NOT NULL DEFAULT 0, next_at INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS enroll_due ON enrollments (status, next_at);
CREATE INDEX IF NOT EXISTS enroll_lead ON enrollments (ws, lead_id);
CREATE INDEX IF NOT EXISTS enroll_seq ON enrollments (ws, seq_id);

-- Files people upload or send in: bank statements, applications, ID.
CREATE TABLE IF NOT EXISTS files (ws TEXT NOT NULL, id TEXT NOT NULL, lead_id TEXT, deal_id TEXT, name TEXT NOT NULL, type TEXT,
  size INTEGER, r2_key TEXT NOT NULL, kind TEXT, at INTEGER NOT NULL, PRIMARY KEY (ws, id));
CREATE INDEX IF NOT EXISTS files_lead ON files (ws, lead_id);
CREATE INDEX IF NOT EXISTS files_deal ON files (ws, deal_id);
