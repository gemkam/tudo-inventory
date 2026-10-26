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

## AI assistants (Inventory and Transport)
- Each section has its own "Ask AI" button (bottom right) with a mic. Answers in English, Roman Urdu or Urdu script.
- Server-side key (Vercel > Settings > Environment Variables, type **Secret**):
  - `GROQ_API_KEY` (get it at console.groq.com). Optional: `AI_MODEL` (default `llama-3.3-70b-versatile`).
  - Alternatives: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
- Never prefix the key with NEXT_PUBLIC_.

## Users and access levels
Administrator manages logins on the **Users** page (no Supabase dashboard needed).
- Administrator: everything, plus users
- Full access: see and edit everything
- View only: see everything, change nothing
- Data entry: only the Transport data entry form (/entry); cannot read any saved data (enforced by database rules)

## Monthly transport report email
- On the 1st of every month at 9:00 (Muscat) Vercel Cron calls `/api/transport-report`, which builds the full Transport Expense PDF and emails it.
- Administrator / Full access can also press "✉ Email report" on the Transport page to send it now.
- Vercel env vars needed: `CRON_SECRET` (must match `private.app_secrets.report_key` in Supabase), `GMAIL_USER`, `GMAIL_APP_PASSWORD` (Gmail app password), optional `REPORT_TO` (comma separated, default mianrauf.altaf9@gmail.com).
