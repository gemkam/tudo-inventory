-- Bills verification (6 Nov 2026). Applied via Supabase connector.
alter table public.company_docs add column if not exists ai_check jsonb, add column if not exists verify jsonb;
create or replace function public.guard_bill_verify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.verify is not null) or (tg_op = 'UPDATE' and new.verify is distinct from old.verify) then
    if not public.is_admin() then
      raise exception 'Only the Administrator can verify bills.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_bill_verify before insert or update on public.company_docs for each row execute function public.guard_bill_verify();

-- 6 Nov 2026: chairman approval column (button comes later). Guard also covers approval (admin only for now; change to the chairman role when it exists).
alter table public.company_docs add column if not exists approval jsonb;
create or replace function public.guard_bill_verify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and (new.verify is not null or new.approval is not null))
     or (tg_op = 'UPDATE' and (new.verify is distinct from old.verify or new.approval is distinct from old.approval)) then
    if not public.is_admin() then
      raise exception 'Only the Administrator can verify bills.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
