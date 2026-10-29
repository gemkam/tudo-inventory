-- Unpaid balance on every salary sheet (29 Oct 2026). Run once in Supabase > SQL Editor.
-- Drivers: amount paid per monthly salary (null = nothing paid yet).
alter table public.transport_salaries add column if not exists paid_amount numeric(12,3);
alter table public.transport_salaries add column if not exists paid_on date;

-- Salaries before October 2026 are taken as fully paid (change in the app if not true).
update public.transport_salaries
set paid_amount = basic + room_rent + utilities + mobile + travel_food + trip_allowance + coalesce(allowance_carried, 0)
                  - advance_deduction + special_allowance,
    paid_on = (month + interval '1 month')::date
where month < date '2026-10-01' and paid_amount is null;

-- Office staff (3 companies): paid this month, date, and unpaid carried from earlier months.
alter table public.exp_staff add column if not exists paid_amount numeric(12,3);
alter table public.exp_staff add column if not exists paid_on date;
alter table public.exp_staff add column if not exists prev_balance numeric(12,3) not null default 0;
