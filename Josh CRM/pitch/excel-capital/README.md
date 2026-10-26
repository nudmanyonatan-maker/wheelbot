# Excel Capital pitch video

`excel-capital-crm.mp4` (62s, 1080p) shows the ISO Desk CRM set up as a UK lender edition for Excel Capital, on top of the repayments app already built for them. Captions: `excel-capital-crm.srt`. Cover: `poster.jpg`.

## What is real and what is staged
- Every screen is the real CRM, running locally from a copy. Nothing here touches Josh's desk or Excel's repayments app.
- All brokers, businesses and people are made up. Phone numbers use Ofcom's drama range (07700 900xxx).
- The repayments link is a demo. The "Repayments" tab, the missed repayments on Today, and the "Send bank link" checklist item read sample data shaped like the repayments app's records. When the business "approves", the recording calls `window.EXCEL.approveBank()`. Building it for real needs an API on the repayments app (create borrower, send setup link, report each payment).
- Website applications are shown arriving as deals from "Your website". Wiring excelcapital.co.uk's form into the CRM is not built.

## Re-shooting
1. Rebuild the copy: copy the CRM to a scratch folder, add `source/app/lender.js` to `public/`, apply the two patches, then run `npx wrangler pages dev --port 8799` (local database only).
2. `node prep-excel.mjs <video project>` writes a fresh invite into `config.json` before each take.
3. Run the showcase-video pipeline with `source/video` as the project folder: `voice_gen.py`, `pick.py`, `record.js`, `assets.js`, `compose.py`.
