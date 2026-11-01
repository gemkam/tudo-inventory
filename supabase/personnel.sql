-- Personnel module (1 Nov 2026). Applied via the Supabase connector (migration personnel_module).
-- Employees: Office / Site = exp_staff, Drivers = transport_drivers, Subcontractors = personnel_subcontractors.
alter table public.exp_staff
  add column if not exists designation text, add column if not exists contract text, add column if not exists passport text,
  add column if not exists mobile text, add column if not exists house_rent numeric not null default 0,
  add column if not exists utilities numeric not null default 0, add column if not exists transport_allow boolean not null default false,
  add column if not exists ticket text, add column if not exists files jsonb not null default '{}'::jsonb,
  add column if not exists slip_token uuid not null default gen_random_uuid(), add column if not exists slip_link_on boolean not null default true;
alter table public.transport_drivers
  add column if not exists company text default 'modern-city', add column if not exists contract text, add column if not exists passport text,
  add column if not exists salary numeric not null default 0, add column if not exists allowances numeric not null default 0,
  add column if not exists house_rent numeric not null default 0, add column if not exists utilities numeric not null default 0,
  add column if not exists ticket text, add column if not exists files jsonb not null default '{}'::jsonb,
  add column if not exists slip_token uuid not null default gen_random_uuid(), add column if not exists slip_link_on boolean not null default true;
create table if not exists public.personnel_subcontractors (
  id uuid primary key default gen_random_uuid(), name text not null default '', company_name text, contract text, contact text,
  files jsonb not null default '{}'::jsonb, sort integer not null default 0, created_at timestamptz not null default now());
alter table public.personnel_subcontractors enable row level security;
create policy personnel_sub_read on public.personnel_subcontractors for select using (public.can_read());
create policy personnel_sub_write on public.personnel_subcontractors for all using (public.can_write()) with check (public.can_write());
-- bucket staff-files (private): office read/write; anon can read only slip/<token>/ of an active link
insert into storage.buckets (id, name, public, file_size_limit) values ('staff-files', 'staff-files', false, 15728640) on conflict (id) do nothing;
create policy "staff files read" on storage.objects for select to authenticated using (bucket_id = 'staff-files' and public.can_read());
create policy "staff files add" on storage.objects for insert to authenticated with check (bucket_id = 'staff-files' and public.can_write());
create policy "staff files change" on storage.objects for update to authenticated using (bucket_id = 'staff-files' and public.can_write());
create policy "staff files remove" on storage.objects for delete to authenticated using (bucket_id = 'staff-files' and public.can_write());
-- functions slip_token_ok(text) and public_staff_slip(text): see migration personnel_module in Supabase
-- ＋ Add company (1 Nov 2026): extra companies for Personnel
create table if not exists public.personnel_companies (key text primary key, short text not null, name text, sort integer not null default 0, created_at timestamptz not null default now());
alter table public.personnel_companies enable row level security;
create policy personnel_co_read on public.personnel_companies for select using (public.can_read());
create policy personnel_co_write on public.personnel_companies for all using (public.can_write()) with check (public.can_write());
-- 1 Nov 2026: personnel_companies also feeds All Companies (＋ Add company), extra columns
alter table public.personnel_companies add column if not exists cr text, add column if not exists address text;
-- salary_slips, slip_push_subs, salary_credits, public_save_push, push_private_key: migrations salary_slips_monthly and salary_credits
alter table public.personnel_subcontractors add column if not exists company text; -- company the subcontractor works for (1 Nov 2026)
