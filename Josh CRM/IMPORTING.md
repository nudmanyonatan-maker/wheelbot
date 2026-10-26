# Bringing your shops and contacts into ISO Desk

For Josh. About ten minutes the first time.

## Before you start

- Sign in with the link Yonatan sends you. You are the manager: you see every rep's book.
- Add your reps: tap your name, then **Your team**. Write their name and email, pick **Rep**, and send them the link it gives you. A rep only ever sees their own shops.

## Do it in this order

1. **Your ISO list** (shops and the people at them). This sets up the shops.
2. **Your phone contacts.** People get matched to the shops from step 1.
3. **Your deal list**, if you want your history in.

## 1. Your ISO list from SmartMCA or Excel

1. In SmartMCA, export the ISO list. In Excel or Google Sheets, save the sheet as CSV.
2. In ISO Desk, tap your name, then **Import contacts or a spreadsheet**, then **Choose a file**.
3. Check the preview:
   - **Columns matched** says which columns it found (company, name, phone, email and so on). Tap it to fix any that are wrong.
   - Each company becomes a shop with its people. If the shop is already here, under any spelling ("Sunrise Capital LLC" and "Sunrise Capital" are the same shop), it adds only the people who are new.
   - **New shops go to**: pick yourself, a rep, or nobody yet. You can hand shops to someone else later.
4. Press **Import**. Right after, there is an **Undo** on the message at the bottom if something looks wrong.

## 2. Your phone contacts

- **iPhone:** Contacts app, **Lists** (top left), press and hold **All Contacts**, **Export**, save to Files. Then in ISO Desk on the phone: tap your name, **Import**, **Choose a file**, pick it from Files.
- **Android:** Contacts app, **Fix and manage**, **Export to file**. Then import it the same way.

What happens to each contact:

- A contact with a company becomes part of that shop, or a new shop.
- A contact with **no company** is matched to a shop when their **phone number** is already on that shop, or their **email** is at the same company domain (rita@sunrisecap.com goes to the shop where someone else has an @sunrisecap.com email). Gmail, Yahoo and the like never match.
- Anyone left over (family, your dentist) is skipped unless you choose **Add each as their own shop**.
- Untick anything personal before you press Import.

## 3. Your deal list (optional)

Export the deal list from SmartMCA as CSV and import it the same way. Each row becomes a deal under its shop, with its status (submitted, approved, funded, declined). Deals already here are skipped.

## Good to know

- **Nothing gets doubled.** Shops are matched by name, phone and company email domain across the whole team.
- **A rep importing** a shop that is already in someone else's book sees "Already in Josh's book, left alone". It is not copied into theirs.
- **Duplicates you already have** show a "Possible duplicate" tag on Shops, with a **Merge** button. Nothing is lost when you merge.
- **Every change is logged.** Tap your name, then **Every change**, to see who changed what and when. On any shop, the Activity tab has **Every change to this shop**.
- **Your data is yours.** Settings, Your data: download your shops, deals or a full backup any time.

---

## Going live (for Yonatan)

Josh is on the first version now, so ask before doing this. The preview runs on its own database, so testing there never touches his data. To move production onto this version:

```bash
npx wrangler d1 migrations apply iso-desk --remote
node scripts/migrate-records.mjs --prod
node scripts/migrate-records.mjs --prod --apply
npm run deploy
node scripts/migrate-records.mjs --prod --apply
node scripts/migrate-records.mjs --prod --verify
npm run deploy:alerts
```

1. Adds the new tables. Nothing existing is dropped, and the version live now keeps working on top of it.
2. Dry run: prints how many of Josh's saved records would move and writes the SQL to `.wrangler/` to read first.
3. Copies them into the new tables while the first version is still live. Each copy pauses the database for a few seconds; a save Josh makes in that moment is retried by the app.
4. Puts this version live.
5. Copies again, which picks up anything Josh saved between 3 and 4. A record already there with the same or a newer edit is skipped, so running it twice never doubles or overwrites anything.
6. Checks every old record against what the app now gets back, and that every open follow-up still has its alert at the same time. It exits with an error and lists any difference.
7. Follow-up alerts then go only to the phone of the person the follow-up is for. Do this last: the alerts worker live now does not know the new column, and this one needs it.

Josh's invite (role owner, which counts as manager) keeps working through all of this. His sessions, password, phone alert sign-ups and pending follow-up alerts are not touched.
