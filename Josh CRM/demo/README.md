# ISO Desk videos

- `public/tour/iso-desk-walkthrough.mp4`: Josh's 3 minute walkthrough, start to finish. Recorded with `scripts/record.js walkthrough` (narration: edge-tts, Microsoft "Andrew").
- `public/tour/iso-desk-promo.mp4`: the 67 second marketing cut for anyone. Made with the showcase-video skill (voice: Qwen3-TTS "Aiden", generated music, captions in `demo/iso-desk-promo.srt`).

What is real and what is staged in the promo:
- Every screen is the real app, filmed on a throwaway local copy with its own database.
- The rep (Alex Rivera), the shops, merchants and numbers are all made up.
- The filming copy adds `dev-login.js` (signs the recorder in) and nothing else. It is never deployed.
- "It pings your phone" is true once alerts are turned on, but the phone itself is not shown.

Re-shoot the promo: copy the deployed app to a scratch folder, add `promo-shoot/dev-login.js` under `functions/api/`, run it with `npx wrangler pages dev --port 8798`, apply `db/schema.sql` locally, run `node prep.mjs` there, then follow the showcase-video skill with the files in `promo-shoot/`.
