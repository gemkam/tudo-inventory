-- Attendance part 2 (29 Oct 2026): Office or Site staff, leave reason.
-- Run once in Supabase SQL Editor (after attendance.sql).
alter table public.exp_staff add column if not exists staff_type text not null default 'Office';
-- Leave reason (Sick, Marketing, Outside meeting, Personal) is kept in exp_attendance.note
