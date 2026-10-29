-- Office staff attendance for the three companies (29 Oct 2026)
-- Run once in Supabase SQL Editor.
-- One row per staff per day. Friday and Saturday are off by default and are not stored
-- (a row on Fri/Sat means the person worked that day or was marked otherwise).
-- marks: P = Present, A = Absent, L = Leave (paid), H = Half day

create table if not exists public.exp_attendance (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  staff_id uuid not null references public.exp_staff(id) on delete cascade,
  day date not null,
  mark text not null check (mark in ('P', 'A', 'L', 'H')),
  note text,
  entered_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, day)
);
create index if not exists exp_attendance_company_day on public.exp_attendance (company, day);

alter table public.exp_attendance enable row level security;
drop policy if exists exp_attendance_read on public.exp_attendance;
create policy exp_attendance_read on public.exp_attendance for select using (public.can_read());
drop policy if exists exp_attendance_write on public.exp_attendance;
create policy exp_attendance_write on public.exp_attendance for all using (public.can_write()) with check (public.can_write());

-- Salary sheet: which month the working days were filled from
alter table public.exp_staff add column if not exists attendance_month text;

-- Activity log (Changes tab)
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists trg_audit on public.exp_attendance;
    create trigger trg_audit after insert or update or delete on public.exp_attendance for each row execute function public.audit_row();
  end if;
end $$;
