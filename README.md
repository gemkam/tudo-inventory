# Tudo Office Inventory System

Next.js + Supabase web app for Tudo office stock (Office Supplies, Kitchen, Sanitary) and bills (Electricity, Water, Dispenser, Internet).

## Features
- Home page with square category buttons that lift on hover and show items with quantities
- Stock quantity, minimum level and low stock alerts
- Stock in / out with notes, full stock log
- Bills: payment records in OMR, monthly and yearly totals
- Settings: add, rename, delete categories and bills (items are managed inside each category)
- Admin login only (Supabase Auth)

## Setup
1. Supabase: run `supabase/schema.sql` in the SQL Editor (skip if Claude already applied it).
2. Supabase > Authentication > Users > Add user: create the admin email and password (tick Auto Confirm).
3. Supabase > Authentication > Sign In / Providers: turn OFF "Allow new users to sign up".
4. Copy `.env.local.example` to `.env.local` and fill in the URL and key (Supabase > Project Settings > API).
5. GitHub Desktop: add this folder as a new repository and publish it.
6. Vercel: import the repo, add the two environment variables, deploy.

## Local run
```
npm install
npm run dev
```
