# Calls and texts from (305) 280-5556: recommendation

**Keep Josh's number on Unicom Connect UC and connect ISO Desk to the API it already runs on. Port to Twilio only if Unicom won't give API access.** Josh does nothing either way except say yes.

## Why
- Connect UC is SkySwitch's white-label app, and SkySwitch runs on NetSapiens. The NetSapiens v2 API can place a call, send a text, read call history and contacts, and post webhooks for new calls and texts. Unicom says "open API" on its site but publishes no docs, so access is up to them.
- Staying means no port, no new app for Josh, no extra per-minute cost, and his call and text history comes over on its own.
- Porting works too, but Josh has to sign the port form, find a recent bill and get a port PIN, and he loses the Connect UC app on that number.

## Side by side

| | A. Stay on Connect UC, use its API | B. Port to Twilio |
|---|---|---|
| Monthly cost | His current Unicom plan (unlimited US calling), plus 10DLC at $1.50 to $10. Ask if API access costs extra. | About $60 to $75 at 1,500 talk minutes and 1,200 texts: $1.15 number, $0.014/min out (click-to-call bills two legs), $0.0085/min in, about $0.011 per text with carrier fees, plus 10DLC. Telnyx is about half that. |
| Setup time | 1 to 3 weeks, mostly waiting on Unicom for the key and on 10DLC review. | 2 to 4 weeks. The port takes 5 to 15 days (Telnyx FastPort: 1 to 4 business days). Texts stay off until 10DLC is approved. We'd also have to build voicemail and inbound call forwarding. |
| A2P 10DLC | Unicom registers through SkySwitch at cost: $4 brand, $15 review per campaign, $1.50 to $10 a month. He may already be registered, since he texts from Connect UC today. | Same registry fees through Twilio: $4.50 brand ($46 with standard vetting), $15 per campaign review, $1.50 to $10 a month. |
| Spam labels | One free form at the Free Caller Registry covers AT&T (Hiya), T-Mobile (First Orion) and Verizon (TNS). Spectrum has its own form. Works on any carrier. | Same, or Twilio Voice Integrity sends the number to all three from the console. Needs the funder's EIN. |
| Contacts and history | Comes over on its own: the API reads past calls, text threads and his Connect UC contacts. Load once, then webhooks keep it current. | Only the number moves. Export calls and contacts from Unicom before canceling. Phone contacts still import as a .vcf, which ISO Desk does today. |
| Spam calls (25 a day) | Blocking in the desk hides the number, but his phone still rings. Ask Unicom to block at the switch. | The desk can reject blocked numbers before the phone rings. |

Twilio over Telnyx for plan B: Twilio takes the call instructions in the same request, so click-to-call is one API call, and Voice Integrity targets the spam-label problem head on. Telnyx is cheaper and ports faster, but needs a second webhook for every call. At one seat the gap is about $30 a month. Splitting the line (texts on Twilio, calls on Unicom) only works if Unicom turns texting off on the number first, which breaks texting in Connect UC. Not worth it.

## Watch-outs
- **10DLC and MCA.** Carriers reject "high-risk financial services" and loan marketing, and Twilio's rejection code names cash advance outright. That rejection can't be resubmitted. Register the campaign as business-to-business partner updates with ISOs (deal status, paperwork, follow-ups), under the funder's legal name and EIN. Keep offers like "you qualify for $250k" out of the sample messages and out of ISO Desk's text templates.
- **Call recording in Florida.** Florida needs every party's consent (Fla. Stat. 934.03). Recording without it is a third-degree felony, and the other side can sue. Keep recording off by default. If it's turned on, play "this call is recorded" to both sides at the start of every call, in and out. A beep alone isn't enough. Have the funder's lawyer sign off.
- **Spam labels.** Registering doesn't change the name people see (that's paid branded caller ID) and doesn't guarantee the label comes off. Lots of short unanswered calls bring it back.

## Built (stubs, not live)
- [lib/phone.js](lib/phone.js): carrier adapters for Connect UC (NetSapiens v2) and Twilio, with webhook checks.
- [functions/api/phone/call.js](functions/api/phone/call.js): `POST /api/phone/call { phone }` rings Josh first, then dials the shop from his number. Only the line's owner can use it. US numbers only, no 900 or 976 lines.
- [functions/api/phone/inbound-sms.js](functions/api/phone/inbound-sms.js): `POST /api/phone/inbound-sms` saves each inbound text as an unread msgs record (same shape as `public/app.js`) in the owner's book and drops texts from blocked numbers. It saves through `saveMessages()` in `lib/book.js`, so each text also lands in the change log as "Phone line".
- Secrets to turn it on: `PHONE_PROVIDER` (`connectuc` or `twilio`), `PHONE_LINES` (`{"3052805556": {"ws": "...", "member": "u1"}}`), then `NS_API_BASE`, `NS_API_KEY`, `NS_SUBSCRIPTION_ID`, optional `NS_ORIG_USER`, or `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, optional `PHONE_WEBHOOK_URL`. Until they're set, both routes say not connected and the Call button keeps opening `tel:`.
- Next: point the Call button at `/api/phone/call` (fall back to `tel:` on 501), add outbound texts and a CDR webhook for inbound calls, and a one-time history and contacts backfill.

## Questions for Unicom (Yonatan to send)
1. Is Josh's line on SkySwitch/NetSapiens? Can you issue an API key scoped to his user (calls, messages, call history, contacts, event subscriptions), and what is the API host?
2. Is (305) 280-5556 registered for 10DLC? Under which brand and use case?
3. Is call recording on, and does it play a notice?
4. Can you block numbers or turn on robocall blocking at the switch?
5. In case we port later: account number, port-out PIN, and the name and address on the account record.

Sources: [SkySwitch ConnectUC](https://www.accessnewswire.com/newsroom/en/telecommunications/skyswitch-recognized-as-a-white-label-leader-in-2024-frost-and-sullivan-radar-rep-928347), [SkySwitch on NetSapiens](https://www.netsapiens.com/podcast-helping-skyswitch-deliver-ucaas/), [NetSapiens API](https://docs.ns-api.com/llms.txt), [SkySwitch 10DLC fees](https://docs.skyswitch.com/en/articles/859-10dlc-registration-fees-and-non-compliance-fines), [Twilio 10DLC fees](https://support.twilio.com/hc/en-us/articles/1260803965530-Pricing-and-Fees-for-A2P-10DLC-Service), [Twilio porting](https://www.twilio.com/en-us/guidelines/us/porting), [Twilio Voice Integrity](https://www.twilio.com/docs/trust-hub/registrations/voice-integrity), [Twilio hosted SMS](https://www.twilio.com/docs/numbers-and-senders/port-host), [Telnyx porting](https://telnyx.com/resources/how-long-does-number-porting-take), [Telnyx numbers](https://telnyx.com/pricing/numbers), [Twilio loan-marketing rejection](https://www.twilio.com/docs/api/errors/30942), [Hiya registration](https://blog.hiya.com/business-phone-number-registration-how-does-it-work), [Free Caller Registry guide](https://support.800.com/en-us/hc/articles/41086077816205-how-to-register-your-business-number-with-the-free-caller-registry-and-major-carriers). Prices checked October 2026; confirm before buying.
