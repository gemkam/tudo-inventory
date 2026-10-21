-- Tudo Office Inventory System: database schema
-- Run once in Supabase SQL Editor (or applied automatically by Claude)

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  unit text not null default 'pcs',
  quantity numeric not null default 0 check (quantity >= 0),
  min_qty numeric not null default 0 check (min_qty >= 0),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists items_category_idx on public.items(category_id);

create table if not exists public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  move_type text not null check (move_type in ('in','out')),
  qty numeric not null check (qty > 0),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stock_moves_item_idx on public.stock_moves(item_id);
create index if not exists stock_moves_created_idx on public.stock_moves(created_at desc);

create table if not exists public.bill_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  payment_type text check (payment_type in ('Prepaid','Postpaid')),
  account_no text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bill_accounts(id) on delete cascade,
  amount numeric(12,3) not null check (amount >= 0),
  paid_on date not null default current_date,
  period text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists bill_payments_account_idx on public.bill_payments(account_id);

-- Row Level Security: only logged-in admin can read or write
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.stock_moves enable row level security;
alter table public.bill_accounts enable row level security;
alter table public.bill_payments enable row level security;

create policy "admin all" on public.categories for all to authenticated using (true) with check (true);
create policy "admin all" on public.items for all to authenticated using (true) with check (true);
create policy "admin all" on public.stock_moves for all to authenticated using (true) with check (true);
create policy "admin all" on public.bill_accounts for all to authenticated using (true) with check (true);
create policy "admin all" on public.bill_payments for all to authenticated using (true) with check (true);

-- Stock in / out: updates quantity and writes the log in one step
create or replace function public.record_move(p_item uuid, p_type text, p_qty numeric, p_note text default null)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_qty numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;

  if p_type = 'in' then
    update items set quantity = quantity + p_qty where id = p_item returning quantity into new_qty;
    if new_qty is null then raise exception 'Item not found'; end if;
  elsif p_type = 'out' then
    update items set quantity = quantity - p_qty where id = p_item and quantity >= p_qty returning quantity into new_qty;
    if new_qty is null then raise exception 'Not enough stock for this quantity'; end if;
  else
    raise exception 'Type must be in or out';
  end if;

  insert into stock_moves (item_id, move_type, qty, note) values (p_item, p_type, p_qty, nullif(trim(p_note), ''));
  return new_qty;
end;
$$;

revoke execute on function public.record_move(uuid, text, numeric, text) from public, anon;
grant execute on function public.record_move(uuid, text, numeric, text) to authenticated;

-- Starting data
insert into public.categories (name, sort) values
  ('Office Supplies', 1), ('Kitchen', 2), ('Sanitary', 3)
on conflict (name) do nothing;

insert into public.items (category_id, name, sort)
select c.id, v.name, v.sort
from (values
  ('Office Supplies','Paper A4',1),('Office Supplies','Staplers',2),('Office Supplies','Pen',3),
  ('Office Supplies','Pencil',4),('Office Supplies','Hole punch',5),('Office Supplies','Files',6),
  ('Office Supplies','Folders',7),('Office Supplies','Sheet protectors',8),('Office Supplies','Toner',9),
  ('Office Supplies','Visiting cards',10),('Office Supplies','Sticky notes',11),('Office Supplies','Envelopes',12),
  ('Office Supplies','Clips',13),('Office Supplies','Bulbs',14),('Office Supplies','Plastics',15),
  ('Office Supplies','Batteries',16),('Office Supplies','Eraser',17),
  ('Kitchen','Water',1),('Kitchen','Sugar',2),('Kitchen','Tea',3),('Kitchen','Coffee',4),
  ('Kitchen','Milk powder',5),('Kitchen','Green tea',6),('Kitchen','Plastic spoons',7),('Kitchen','Paper cups',8),
  ('Sanitary','Brush',1),('Sanitary','Dettol',2),('Sanitary','Toilet rolls',3),('Sanitary','Tissue paper',4),
  ('Sanitary','Clorox',5),('Sanitary','Mop',6),('Sanitary','Garbage bags',7),
  ('Sanitary','Room freshener (automatic)',8),('Sanitary','Room freshener (simple)',9)
) as v(cat, name, sort)
join public.categories c on c.name = v.cat
where not exists (select 1 from public.items i where i.category_id = c.id and i.name = v.name);

insert into public.bill_accounts (name, payment_type, sort) values
  ('Electricity','Prepaid',1), ('Water','Postpaid',2), ('Dispenser',null,3), ('Internet',null,4)
on conflict (name) do nothing;
