-- Transport Expense module (already applied to the live database)
create table if not exists public.transport_drivers (
  id uuid primary key default gen_random_uuid(), name text not null, vehicle_no text,
  sort int not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.transport_entries (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.transport_drivers(id) on delete cascade,
  entry_date date not null default current_date, description text, cargo text, consignee text,
  from_place text, to_place text, rent numeric(12,3) not null default 0, received numeric(12,3) not null default 0,
  driver_allowance numeric(12,3) not null default 0, allowance_status text, diesel numeric(12,3) not null default 0,
  toll numeric(12,3) not null default 0, maintenance numeric(12,3) not null default 0, payment_status text,
  remarks text, credit_in text, sort int not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.transport_salaries (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.transport_drivers(id) on delete cascade, month date not null,
  basic numeric(12,3) not null default 0, room_rent numeric(12,3) not null default 0, utilities numeric(12,3) not null default 0,
  mobile numeric(12,3) not null default 0, travel_food numeric(12,3) not null default 0, trip_allowance numeric(12,3) not null default 0,
  advance_deduction numeric(12,3) not null default 0, special_allowance numeric(12,3) not null default 0,
  created_at timestamptz not null default now(), unique (driver_id, month)
);
create table if not exists public.transport_extras (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.transport_drivers(id) on delete cascade, month date not null,
  description text not null default 'Other expense', amount numeric(12,3) not null default 0,
  created_at timestamptz not null default now()
);
-- RLS: everyone logged in can read; only Administrator (app_metadata.role = 'admin') can change data.
-- Same "read all" / "admin insert|update|delete" policies as the inventory tables, using public.is_admin().
