# Broker Desk

A CRM for Canadian MCA brokers, built first for Crown Merchant Funding. It replaces Close: leads in big saved lists, calling and a multi-line dialer, two-way texting, email and sequences, deals sent to lenders, and dashboards. The phone setup lives inside the desk, like GoHighLevel's.

It runs on Cloudflare Pages Functions with D1 and R2. There is no build step and no front-end framework. Sign-in works like ISO Desk's: invite links, and passwords stretched in the browser.

## What is in it

| Area | What it does |
|---|---|
| Inbox | Missed calls and voicemails, texts, emails, new website applications, lender replies and tasks due today, in one list. Handle each one there: call back, reply, mark done or snooze. |
| Leads | Lists, search and filters run on the server, 50 at a time, so tens of thousands of leads stay fast. You can save lists and pin them to the sidebar. Select everyone matching a filter, then assign, change status, mark do-not-call, add to a sequence, email or export. Import reads Close exports and other CSVs. |
| Lead page | Details, people, and CASL consent with its source. Write a note, text, email or logged call from one box. The full history sits underneath, next to the lead's tasks, deal, sequences and files. |
| Calling | Calls go out from the browser on each rep's own Canadian number. Incoming calls ring in the desk, and the rep's cell if they forward. Missed calls go to voicemail and land in the inbox. One click leaves a voicemail drop. A wrap-up after every call saves the outcome, notes, the next follow-up and a status change. Picking "Send application" texts the lead the form link. Reaching someone clears their missed calls and voicemails from the inbox. |
| Dialer | Pick a saved list and 1 to 5 lines. With more than one line, it dials that many people at once, puts the first live answer through and hangs up the rest. It leaves voicemail drops, then moves to the next round when you save. A guard keeps abandoned calls under the CRTC's 5% a month and lowers the line count as you get close. Leaving the dialer pauses it and hangs up the lines still ringing. |
| Texting | Two-way texts with templates. STOP and ARRET turn texts off for that number. Replies stop any sequence the lead is in. |
| Email | Each rep connects their own Gmail or Outlook through Nylas. You can send, reply, and see every email on the lead. Bulk email has a daily limit per mailbox. |
| Sequences | Email, text and task steps spaced out in days. Only leads with consent join. Anyone who replies, unsubscribes or texts STOP comes out. Every email carries the sender's company details and an unsubscribe link. |
| Deals | A board by stage. Each deal has a checklist for the application and statements. When you send it out, it shows which lenders fit the file and why the rest don't. It records offers with payments and your commission, then the offer taken, closing, funding and commission received. It tells you when the business can renew at 50%. |
| Lenders | Each lender's rules, plus their approval rate, how fast they answer, and what they funded. |
| Dashboard | Per rep: dials, conversations, talk time, texts and emails. The funnel from lead to funded, with commission still owed. Lender and list results. Phone-number health, which flags a number whose answer rate drops (likely marked as spam). Renewals coming due and the dialer's abandoned-call rate. |
| Settings | **Phone:** buy numbers by area code, send the texting registration in, a wallet with auto top-up and a monthly cap, voicemail, forwarding, recording. **Email:** mailbox and CASL sender details. **Team:** roles and round-robin for new leads. **Contact rules:** calling hours and the do-not-call list. Also statuses, templates, the application form, brand, import and the change log. |
| Application form | `/apply/<slug>`, in the brokerage's colours. It records express consent with the date. It creates or updates the lead, opens a deal, stores uploaded statements, routes the lead to the next rep, and puts it in the inbox. |
| Privacy | Download everything held about a business, or erase it (Quebec Law 25, PIPEDA). Every change goes in the change log. |

## The demo line

Until Twilio keys are set, every brokerage is on the built-in demo line. Calls ring and connect in the browser and texts are delivered, but nothing is actually dialed or sent. Some leads text or email back after a while so the inbox fills like a real one. Leads can carry `custom.demoAnswer`, `demoRing` and `demoReply` to script the walkthrough. Email has a matching demo mailbox. The seeded workspace (`crown-demo`) stays on the demo line even after keys are added.

## The walkthrough video

`demo/` (not committed) holds the Crown walkthrough video and how to re-shoot it. See `demo/README.md`.

## Run it

```bash
npm run db:local
npm run seed
npm run dev
npm test
```

- `npm run db:local` creates the local database.
- `npm run seed` loads the made-up Crown Merchant Funding book. Sign in as nathan@crown.example / Walkthrough-2026.
- `npm run dev` serves it at http://localhost:8810.
- `npm test` runs the Twilio, API and browser checks.

## The live site

**https://broker-desk-1w3.pages.dev** is Cloudflare Pages project `broker-desk`, with D1 database `broker-desk` in eastern North America. Josh's ISO Desk (`iso-desk-josh`) is a separate project and database, **but on the free plan both share the account's 100,000 database writes a day.**

- **Demo:** **https://broker-desk-1w3.pages.dev/#demo** signs straight in, no password. So does "Open the demo" on the sign-in page. The guest lands in the made-up `crown-demo` workspace as its manager, on the demo line. The guest login can't invite people or change passwords, and is on only while `DEMO_GUEST` names a workspace flagged demo.
- **The Demo bar** (bottom left) has **Send feedback** (read it under Settings, then Feedback) and **Reload data**. A reload puts the demo back with fresh dates, keeps logins and feedback, writes about 25,000 rows, and is capped at 2 a day (`DEMO_RESETS_PER_DAY`). The book is about 550 leads to keep reloads cheap. `node scripts/seed-demo.mjs --full` brings back the 2,500-lead book for local filming.
- **Its calling hours are open all day,** so people can try calls at night. Real workspaces start on the CRTC hours.
- **Files** go to Workers KV until R2 is turned on (see `env.production` in `wrangler.jsonc`).
- **Deploy:** `npm run deploy` builds the reload data (`public/demo-data/`), applies migrations and deploys.
- **Not on yet:** the minute cron worker (sequences run whenever someone opens the inbox) and a custom domain.

## To go live (needs accounts)

1. **Cloudflare:** create the D1 database and the R2 bucket, put their ids in `wrangler.jsonc`, run the migrations, set `SECRET_KEY` and `CRON_SECRET`, then deploy. Deploy `cron-worker/` with the same `CRON_SECRET`.
2. **Twilio** (calls and texts): set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` for the master account. Each brokerage gets a sub-account the first time it opens Phone settings. Set `TWILIO_ADDRESS_SID` if Canadian numbers ask for an address. The registration form collects everything the carriers need. Until the Trust Hub calls are automated, it is sent in by hand in the Twilio console.
3. **Nylas** (email): set `NYLAS_API_KEY`, `NYLAS_CLIENT_ID` and `NYLAS_WEBHOOK_SECRET`. Point the Nylas webhook at `/api/email/webhook`.
4. **Moving Crown's numbers from Close:** email support@close.com for the Twilio sub-account ID. Then ask Twilio for an internal transfer into Crown's sub-account.
5. **Card payments for the wallet** (Stripe) are not wired yet. On the real line, top-ups are refused until they are.

## Not built yet

- French screens.
- Hosting in Canada: D1 and R2 can only be pinned to the EU or FedRAMP. Moving the data to Montreal (AWS ca-central-1) means swapping D1 for Postgres behind Hyperdrive.
- Self-serve signup and per-seat billing.
- AI call notes.
- Mobile-app calling.

**Tested on the demo line only:** the real Twilio paths (browser calling, incoming calls, the multi-line conference dialer and webhooks) and Nylas email. Each one needs its account before it can be tried.
