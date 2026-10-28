-- User activity tracking (Administrator only). Run once in Supabase SQL editor.
-- Logins (user_sessions), pages / buttons (user_events), every data change (audit_log).

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  username text,
  display_name text,
  role text,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  device text,
  user_agent text
);
create index if not exists user_sessions_user_idx on public.user_sessions(user_id, started_at desc);
create index if not exists user_sessions_seen_idx on public.user_sessions(last_seen desc);

create table if not exists public.user_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.user_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  at timestamptz not null default now(),
  kind text not null,
  path text,
  label text,
  detail jsonb
);
create index if not exists user_events_session_idx on public.user_events(session_id, at);
create index if not exists user_events_user_idx on public.user_events(user_id, at desc);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  username text,
  role text,
  table_name text not null,
  action text not null,
  row_id text,
  changed text[],
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_at_idx on public.audit_log(at desc);
create index if not exists audit_log_user_idx on public.audit_log(user_id, at desc);

alter table public.user_sessions enable row level security;
alter table public.user_events enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists us_admin_read on public.user_sessions;
create policy us_admin_read on public.user_sessions for select to authenticated using (public.is_admin());
drop policy if exists ue_admin_read on public.user_events;
create policy ue_admin_read on public.user_events for select to authenticated using (public.is_admin());
drop policy if exists al_admin_read on public.audit_log;
create policy al_admin_read on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.activity_start(p_device text default null, p_agent text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text;
begin
  if auth.uid() is null then return null; end if;
  v_email := coalesce(auth.jwt() ->> 'email', '');
  insert into public.user_sessions(user_id, username, display_name, role, device, user_agent)
  values (auth.uid(), split_part(v_email, '@', 1),
          coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', split_part(v_email, '@', 1)),
          coalesce(auth.jwt() -> 'app_metadata' ->> 'role', ''),
          left(p_device, 80), left(p_agent, 400))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.activity_ping(p_session uuid, p_kind text default null, p_path text default null, p_label text default null, p_detail jsonb default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  update public.user_sessions set last_seen = now(), ended_at = null, end_reason = null
   where id = p_session and user_id = auth.uid() and (ended_at is null or ended_at > now() - interval '30 minutes');
  if not found then return false; end if;
  if p_kind is not null then
    insert into public.user_events(session_id, user_id, kind, path, label, detail)
    values (p_session, auth.uid(), left(p_kind, 20), left(p_path, 300), left(p_label, 300), p_detail);
  end if;
  return true;
end $$;

create or replace function public.activity_end(p_session uuid, p_reason text default 'closed')
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.user_sessions set last_seen = now(), ended_at = now(), end_reason = left(p_reason, 30)
   where id = p_session and user_id = auth.uid() and ended_at is null;
end $$;

revoke execute on function public.activity_start(text, text) from anon, public;
revoke execute on function public.activity_ping(uuid, text, text, text, jsonb) from anon, public;
revoke execute on function public.activity_end(uuid, text) from anon, public;
grant execute on function public.activity_start(text, text) to authenticated;
grant execute on function public.activity_ping(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.activity_end(uuid, text) to authenticated;

-- Every add / edit / delete. Rows changed automatically by other triggers are skipped.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_changed text[]; v_id text; v_email text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at') and (v_old -> k) is distinct from (v_new -> k);
    if v_changed is null then return null; end if;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key');
  v_email := coalesce(auth.jwt() ->> 'email', '');
  insert into public.audit_log(user_id, username, role, table_name, action, row_id, changed, old_data, new_data)
  values (auth.uid(),
          case when auth.uid() is null then 'Share link / system' else split_part(v_email, '@', 1) end,
          coalesce(auth.jwt() -> 'app_metadata' ->> 'role', ''),
          tg_table_name, tg_op, v_id, v_changed, v_old, v_new);
  return null;
end $$;
revoke execute on function public.audit_row() from anon, authenticated, public;

do $$
declare t text;
begin
  foreach t in array array['app_labels','bill_accounts','bill_payments','categories','company_docs','doc_checklist','entry_links','exp_budgets','exp_entries','exp_staff','items','stock_moves','transport_drivers','transport_entries','transport_extras','transport_invoices','transport_salaries','transport_vehicles','vehicle_maintenance']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;
