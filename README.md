# Jennuine Clean — Supply Room

A barcode-driven supply tracker for the cleaning business. Track what's on hand,
scan items as they're used, get a self-filling reorder list, and see monthly
spend-vs-used reports. Built with Vite + React and Supabase, deployable on Vercel.
Syncs live between your phone and Jenn's. No per-use costs — Supabase and Vercel
free tiers cover it, and the barcode lookup is the free Open Products Facts API.

---

## What you'll set up (about 20 minutes, one time)

1. A Supabase project (the database + login)
2. This app deployed to Vercel
3. Two logins — one for you, one for Jenn

---

## 1. Supabase

1. Go to supabase.com, create a new project. Pick a name like `jennuine-supply`
   and save the database password somewhere safe.
2. When it's ready, open **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql` from this project, and click **Run**. That creates the
   two tables, locks them to signed-in users, and turns on live sync.
3. Open **Project Settings → API**. Copy two values — you'll need them in step 2:
   - **Project URL**
   - **anon public** key
4. Create your two logins: **Authentication → Users → Add user**. Add yourself and
   Jenn with email + a password (tick "Auto-confirm" so no email step). That's the
   email/password you'll each use to sign in.

## 2. Run it locally first (optional but recommended)

```bash
npm install
cp .env.example .env      # then edit .env with your URL + anon key from step 1.3
npm run dev
```

Open the URL it prints, sign in with one of the users you made, and add a few
real supplies. Camera scanning works on a phone over HTTPS (see deploy below);
on a desktop you can type or paste barcodes.

## 3. Deploy to Vercel

Same flow as your schedule app:

1. Push this folder to a new GitHub repo (e.g. `jennuineclean/jennuine-supply`).
2. In Vercel, **Add New → Project**, import that repo. Vercel auto-detects Vite.
3. Before deploying, add two **Environment Variables** (Settings → Environment
   Variables), matching your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. You'll get a URL like `jennuine-supply.vercel.app`.

## 4. Put it on your phones

Open the Vercel URL in Safari on each iPhone, sign in, then **Share → Add to Home
Screen**. It opens full-screen like an app, and the camera scanner works because
the site is HTTPS. Anything one of you changes shows up on the other's phone live.

---

## How it works day to day

- **Take** — scan a bottle's barcode (or tap it in Quick pick) and the count drops
  by one. Scan something brand new and it offers to add it.
- **Add** — scan/type a barcode and tap **Look up** to try auto-filling the name and
  size from the free database. Cleaning supplies often aren't listed; if so, just
  type them in. The barcode binds to that item from then on.
- **Reorder** — fills itself when anything hits its reorder point.
- **Reports** — monthly Spent vs Used, spend by store, cost of what you used,
  month-over-month usage, and a next-restock estimate. **Export** pulls the month
  to CSV for QuickBooks.

A note on the numbers: restocking (the +1/+5/+10 buttons and adding stock) records a
**purchase**; taking an item records **usage** at the price you paid. Correcting an
on-hand count by hand is treated as a true-up and isn't counted as spending.

---

## Notes

- **Barcode lookup** uses Open Products Facts, then Open Food Facts as a backstop —
  free, no API key, one request per real scan.
- **Costs** are limited to Supabase and Vercel free tiers; nothing here charges per use.
- The data is shared between the two signed-in users. To add or remove who has
  access, manage users in the Supabase dashboard (Authentication → Users).
- This is operational — a complement to QuickBooks for running the supply room,
  not a replacement for your books.
