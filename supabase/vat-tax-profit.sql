-- VAT 5% per trip, 15% Govt tax per driver, Profit taken per driver (29 Oct 2026)
-- Run once in Supabase > SQL Editor. Safe to run again.

alter table public.transport_entries add column if not exists vat_included boolean not null default false;
alter table public.transport_drivers add column if not exists tax_on boolean not null default false;

create table if not exists public.transport_profit_taken (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.transport_drivers(id) on delete cascade,
  taken_on date not null default ((now() at time zone 'Asia/Muscat')::date),
  amount numeric not null default 0,
  note text,
  entered_by text,
  created_at timestamptz not null default now()
);
create index if not exists transport_profit_taken_driver on public.transport_profit_taken(driver_id, taken_on);
alter table public.transport_profit_taken enable row level security;
drop policy if exists ptk_read on public.transport_profit_taken;
drop policy if exists ptk_ins on public.transport_profit_taken;
drop policy if exists ptk_upd on public.transport_profit_taken;
drop policy if exists ptk_del on public.transport_profit_taken;
create policy ptk_read on public.transport_profit_taken for select using (public.can_read());
create policy ptk_ins on public.transport_profit_taken for insert with check (public.can_write());
create policy ptk_upd on public.transport_profit_taken for update using (public.can_write()) with check (public.can_write());
create policy ptk_del on public.transport_profit_taken for delete using (public.can_write());
grant select, insert, update, delete on public.transport_profit_taken to authenticated;

do $$ begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists trg_audit on public.transport_profit_taken;
    create trigger trg_audit after insert or update or delete on public.transport_profit_taken for each row execute function public.audit_row();
  end if;
end $$;
