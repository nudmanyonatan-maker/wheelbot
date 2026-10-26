# ISO Desk, broker edition for Canada: what's missing

Goal: replace Close for Canadian MCA brokers, starting with Crown Merchant Funding (cmfunding.ca). Built from what Crown actually uses, not a copy of Close.

## What Crown uses in Close today (read-only look, 2026-10-15)
- **Inbox:** one combined list of emails, calls, texts and tasks. It's full of MCA application forms (Jotform) and bank statements.
- **Lead lists:** saved lists by month and source ("Fresh Leads 2026", about 480 leads; "Never reached out"). Statuses like "Leads to call".
- **Volume, one week:**
  - 723 outbound calls (39 seconds on average) and 45 inbound.
  - 2,930 emails sent and 534 received.
  - 0 leads created and 1 opportunity created.
- **Barely used:**
  - The pipeline: about 4,000 deals all sit in the first stage.
  - Workflows: one SMS workflow, with nothing active.
- **Not checked:** team size, phone setup and plan. Close blocked the settings pages.

## What ISO Desk already has
- Companies with their people, plus importing from CSV, phone contacts or SmartMCA.
- Follow-ups with phone and desktop alerts.
- Message templates. Call and text logging through `tel:`/`sms:`.
- A deal pipeline with:
  - a bank-statement checklist
  - offers
  - a closing checklist
  - funded deals and renewals at 50%
  - "who sent it first" warnings
- Logins and roles, being finished by the logins session.
- An audit log.
- Phone stubs in `lib/phone.js`. Twilio click-to-call and inbound SMS are written but not live. NANP numbers, so Canadian numbers already pass the dialable check.

## Everything missing

Effort is in build days with Claude, not counting waits for outside approvals.

| # | Piece | What it means | Build days | Outside wait or cost |
|---|---|---|---|---|
| 1 | Broker data model | Leads (a business before it applies) with statuses. A lender directory with each lender's rules (minimum revenue, industries, positions). Sending one deal to several lenders and tracking each answer and offer. Commission each lender owes and whether it was paid. ISO Desk today is the funder side, so this flips it. | 3 | |
| 2 | Big lists | ISO Desk loads the whole book into the browser. Cold lists run to tens of thousands of leads, so lists, search and filters must run on the server with paging. Biggest architecture change. | 4 | |
| 3 | Import from Close | Close CSV or API export: leads, contacts, statuses, notes, past calls and emails. This is how you win a customer. | 2 | Their Close export |
| 4 | Saved lists and bulk actions | Saved filters like Close's Smart Views. Bulk actions: assign, change status, start a sequence, export. | 2 | |
| 5 | Calling | Calls from the browser (Twilio Voice) on Canadian numbers. Inbound calls ring the rep. Voicemail. Every call logged with its outcome. Recording off by default, with a spoken notice when it's on. | 4 | About $1.15 a number a month. Calls about $0.014 a minute (confirm the Canadian rate). |
| 6 | Power and multi-line dialer | Work down a saved list. The rep picks how many lines to dial at once (1 to 5). The first person to answer connects, voicemails are detected and skipped or get a recorded drop, and the rest hang up. A guard keeps abandoned calls under 5% a month and lowers the line count on its own. | 6 | Voicemail detection about $0.0075 a call |
| 7 | Two-way texting | Texts on the same Canadian number, in the inbox, with templates and STOP handling. | 3 | Carrier registration review, 1 to 3 weeks. MCA wording gets rejected, so register it as business updates. Texts about $0.008 each plus carrier fees. |
| 8 | Email sync and sending | Connect Gmail or Outlook, see every email on the lead, reply and send from the desk, attachments saved. Use Nylas so we don't need Google's own security review. | 4 | Nylas about $1.20 to $2 a mailbox a month. Doing it ourselves needs Google's CASA review ($540 to $15k a year). |
| 9 | Bulk email and sequences | Send to a saved list, follow-up steps, stop when they reply. Daily send limits. CASL unsubscribe link on every message. | 3 | |
| 10 | Unified inbox | Emails, calls, texts and tasks waiting on you in one list, with done and snooze. | 2 | |
| 11 | Dashboards and analytics | Per rep: dials, connects, connect rate, talk time, texts, emails. Pipeline: applications in, submitted, approved, funded dollars, commission. Per lender: approval rate and time to offer. Per lead list: funded deals and cost. Renewals coming due. Per phone number: answer rate, to catch numbers going spam. | 4 | |
| 12 | Team | Finish logins and roles. Lead assignment and round-robin. Reps see only their own leads. | 2 | Waits on the logins session |
| 13 | Canadian compliance | CASL: consent, its source and date on every contact; unsubscribes and a suppression list. CRTC: an internal do-not-call list, calling-hour guard, say who you are. Recording notice. Law 25: export and delete a person's data. | 2 | Lawyer sign-off recommended |
| 14 | Application form and uploads | The broker's own application form and bank statement upload, landing as a lead with files. Replaces Jotform. | 2 | |
| 15 | Canadian hosting | Cloudflare D1 and R2 can't be pinned to Canada (EU and FedRAMP only). Move the database to Postgres and files to S3 in AWS Montreal (ca-central-1). Store call recordings in that bucket, not in Twilio. | 4 | About $30 to $60 a month to start |
| 16 | Billing and signup | Self-serve trial, Stripe in CAD per seat, GST/HST/QST through Stripe Tax, calls and texts billed at cost. | 3 | Stripe fees |
| 17 | French | Every screen in French for Quebec. Text is inline in app.js today, so it all has to be pulled out first. | 3 | |
| 18 | Running it | Backups, uptime alerts, error tracking, two-factor sign-in, a support inbox. | 2 | Small |

| 19 | Phone setup inside the desk (like GoHighLevel) | One master Twilio account. Each brokerage gets its own sub-account, created at signup. In Settings: search numbers by area code and buy in one click, a texting registration form the desk submits for them, a wallet they top up by card with auto-recharge and your markup, voicemail greeting, forwarding to a cell, and business hours. Moving numbers from Close becomes an internal Twilio transfer into their sub-account. | 5 | Your Twilio account and Twilio's partner setup |

Later, not needed to replace Close: call transcripts and AI notes, predictive dialer, local-presence numbers, phone calling inside a mobile app, Zapier and an API, e-signatures.

## Phases
- **Step 0, this week:**
  - Ask your friend how many seats they pay for, which plan, and their top three likes and hates in Close.
  - Get their Close export.
  - Check Close's terms, since they likely forbid using an account to build a competitor.
- **Phase 1, replace Close for Crown:** pieces 1 to 8, 10 to 13 and 19. About 43 build days. That's about 9 weeks for one session, or 5 to 6 weeks with two sessions on separate pieces (phones in one, lists and dashboards in the other). Start texting registration on day one, because that review is the slowest part.
- **Phase 2, sell to other brokers:** pieces 9, 14, 15, 16 and 18. About 14 build days, roughly 3 weeks.
- **Phase 3:** piece 17 (French) once there are Quebec prospects, then the "later" list.

## Money
- **Running cost:**
  - Calls: at Crown's pace (about 3,000 billed minutes a month team-wide), roughly $45 a month.
  - Mailboxes: about $1.50 each.
  - Hosting: tens of dollars a month in total.
  - Altogether, under about $15 a seat a month before Stripe fees.
- **Close today:** Growth (power dialer and sequences) is $99 to $109 USD a seat, about CAD $135 to $150.
- **Suggested price:** CAD $79 to $99 a seat, with calls and texts at cost.

## Biggest risks
1. **Texting approval.** Carriers reject cash advance and loan marketing, and Canada bans third-party lead generation on long codes.
2. **Big-list rework.** It touches most of the app (piece 2).
3. **Email.** Deliverability at about 3,000 emails a week, and dependence on Nylas.
4. **Canadian hosting** means leaving Cloudflare's database for the main data.
5. **Close's terms.** Build from what the customer tells you, not by copying Close's screens.

## What could go wrong, and the guard for each
| Risk | Prevention |
|---|---|
| Numbers get labelled spam at 700+ calls a week | Verified business profile and STIR/SHAKEN attestation on every number. Local numbers by region. The dashboard watches answer rate per number, and the desk retires a number that drops. Pace calls. |
| Texts get filtered or blocked | Register each brokerage properly. Templates written as deal updates, not loan offers. No link shorteners. STOP honoured. Delivery failures flagged on the lead. |
| Multi-line dialer breaks CRTC rules | Cap on lines, a 5% monthly abandonment guard that lowers lines on its own, calling-hours guard, do-not-call check before every dial. |
| CASL complaints from bulk email or text | Consent and its source on every contact. One-click unsubscribe, processed right away (the law allows 10 business days). Suppression list checked before every send. |
| Bad call quality in the browser | Network and mic check before a session. Headset recommended. Fallback that rings the rep's cell. |
| Surprise phone bills or toll fraud | Calls limited to Canada and the US. A spend cap and alerts per brokerage. Prepaid wallet with auto-recharge. |
| Losing history moving off Close | Test import first, compare counts with Close, then a week running side by side before cancelling. |
| Email stops syncing | Reconnect banner, automatic retries, alert to the admin. |
| Reps see each other's leads | Roles, reps see only their own leads, audit log. |
| Data loss or downtime | Daily backups and restore tests, uptime and error alerts, a status page. |
| Reps don't switch | Short walkthrough video, their own lists and statuses set up before day one. |

## What Crown will complain about that we can fix
- The pipeline doesn't fit MCA: they leave everything in the first stage. Ours follows their real flow: lead, application, statements, lenders, offers, funded, renewal.
- Applications and statements arrive as emails from Jotform. Ours creates the deal and ticks the checklist when the form comes in.
- An inbox of 600+ items. Ours puts what needs action first: application in, lender replied, missed call.
- Monthly lead lists made by hand. Ours tracks source and date on every lead and keeps "Never contacted" up to date.
- 39-second average calls. The multi-line dialer, voicemail drop and local numbers raise connects per hour.
- Reports only count activity. Ours shows funded volume, commission, and approval rate per lender.
- No renewal tracking. Ours flags renewals at 50% paid back.
- Paying in USD. Ours bills in CAD.

## How to fit it to them
- Their statuses, lists and stages, set up from the Close export before day one.
- Their lenders, each with that lender's rules, so the desk suggests where to send each file.
- Their application form on their own website, with their logo.
- Their email and text templates, rewritten so they pass carrier review.
- Commission splits per rep.
- Their phone numbers moved over from Close.
- Their branding on the desk, which also opens a white-label version for other brokers later.
