-- Driver trip form (/entry), 31 Oct 2026.
-- New cost fields + attachments per field + Trip complete. Drivers (role 'entry') write ONLY through the
-- SECURITY DEFINER functions below, so they can never change the office (admin) fields or erase a file record:
-- a driver "Delete" only marks the file deleted (deleted_at / deleted_by), the Administrator still sees it.

alter table public.transport_entries
  add column if not exists gate_pass numeric not null default 0,
  add column if not exists exit_fee numeric not null default 0,
  add column if not exists empty_border_fee numeric not null default 0,
  add column if not exists container_wash numeric not null default 0,
  add column if not exists vehicle_wash numeric not null default 0,
  add column if not exists attachments jsonb not null default '{}'::jsonb,
  add column if not exists trip_completed boolean not null default false,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text;

-- drivers see the trips that are still open, and the ones completed in the last 3 days
create policy "entry read open trips" on public.transport_entries for select to authenticated
  using (public.app_role() = 'entry' and (not trip_completed or completed_at > now() - interval '3 days'));
-- (old policy "entry insert rows" kept; the form itself uses driver_save_trip())
create policy "entry read labels" on public.app_labels for select to authenticated using (public.app_role() = 'entry');

create or replace function public.entry_user_name() returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), 'driver');
$$;

-- driver fields only. p_id null = new trip. Returns the trip id.
create or replace function public.driver_save_trip(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  k text;
  n numeric;
  v_driver uuid := nullif(p_data ->> 'driver_id', '')::uuid;
begin
  if public.app_role() not in ('entry', 'admin', 'editor') then raise exception 'Not allowed'; end if;
  foreach k in array array['rent','driver_allowance','diesel','toll','gate_pass','exit_fee','empty_border_fee','container_wash','vehicle_wash'] loop
    n := coalesce(nullif(p_data ->> k, '')::numeric, 0);
    if n < 0 or n > 100000 then raise exception 'Check the amount in %', replace(k, '_', ' '); end if;
  end loop;
  if v_id is null then
    if v_driver is null or not exists (select 1 from transport_drivers where id = v_driver) then raise exception 'Choose the driver.'; end if;
    insert into transport_entries (driver_id, entry_date, from_place, to_place, rent, driver_allowance, allowance_status, diesel, toll,
      gate_pass, exit_fee, empty_border_fee, container_wash, vehicle_wash, entered_by, sort)
    values (v_driver, coalesce(nullif(p_data ->> 'entry_date', '')::date, (now() at time zone 'Asia/Muscat')::date),
      left(nullif(trim(p_data ->> 'from_place'), ''), 120), left(nullif(trim(p_data ->> 'to_place'), ''), 120),
      coalesce(nullif(p_data ->> 'rent', '')::numeric, 0), coalesce(nullif(p_data ->> 'driver_allowance', '')::numeric, 0), 'Not paid',
      coalesce(nullif(p_data ->> 'diesel', '')::numeric, 0), coalesce(nullif(p_data ->> 'toll', '')::numeric, 0),
      coalesce(nullif(p_data ->> 'gate_pass', '')::numeric, 0), coalesce(nullif(p_data ->> 'exit_fee', '')::numeric, 0),
      coalesce(nullif(p_data ->> 'empty_border_fee', '')::numeric, 0), coalesce(nullif(p_data ->> 'container_wash', '')::numeric, 0),
      coalesce(nullif(p_data ->> 'vehicle_wash', '')::numeric, 0), left(public.entry_user_name(), 80), extract(epoch from now())::int)
    returning id into v_id;
  else
    if public.app_role() = 'entry' and exists (select 1 from transport_entries where id = v_id and trip_completed) then
      raise exception 'This trip is completed. Ask the office to change it.';
    end if;
    update transport_entries set
      entry_date = coalesce(nullif(p_data ->> 'entry_date', '')::date, entry_date),
      from_place = left(nullif(trim(p_data ->> 'from_place'), ''), 120), to_place = left(nullif(trim(p_data ->> 'to_place'), ''), 120),
      rent = coalesce(nullif(p_data ->> 'rent', '')::numeric, 0), driver_allowance = coalesce(nullif(p_data ->> 'driver_allowance', '')::numeric, 0),
      diesel = coalesce(nullif(p_data ->> 'diesel', '')::numeric, 0), toll = coalesce(nullif(p_data ->> 'toll', '')::numeric, 0),
      gate_pass = coalesce(nullif(p_data ->> 'gate_pass', '')::numeric, 0), exit_fee = coalesce(nullif(p_data ->> 'exit_fee', '')::numeric, 0),
      empty_border_fee = coalesce(nullif(p_data ->> 'empty_border_fee', '')::numeric, 0),
      container_wash = coalesce(nullif(p_data ->> 'container_wash', '')::numeric, 0), vehicle_wash = coalesce(nullif(p_data ->> 'vehicle_wash', '')::numeric, 0)
    where id = v_id;
    if not found then raise exception 'Trip not found'; end if;
  end if;
  return v_id;
end $$;

-- add one file record to a field (kind = diesel, toll, gate_pass, exit_fee, empty_border, container_wash, vehicle_wash, delivery_order)
create or replace function public.driver_add_file(p_id uuid, p_kind text, p_file jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if public.app_role() not in ('entry', 'admin', 'editor') then raise exception 'Not allowed'; end if;
  if p_kind !~ '^[a-z_]{2,30}$' then raise exception 'Bad field'; end if;
  if public.app_role() = 'entry' and exists (select 1 from transport_entries where id = p_id and trip_completed) then
    raise exception 'This trip is completed. Ask the office to add papers.';
  end if;
  update transport_entries set attachments = jsonb_set(coalesce(attachments, '{}'::jsonb), array[p_kind],
      coalesce(attachments -> p_kind, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('path', p_file ->> 'path', 'name', left(p_file ->> 'name', 150), 'size', p_file -> 'size',
          'type', left(coalesce(p_file ->> 'type', ''), 80), 'at', now(), 'by', public.entry_user_name())))
   where id = p_id returning attachments into v;
  if not found then raise exception 'Trip not found'; end if;
  return v;
end $$;

-- p_action: 'delete' (mark deleted, kept for the Administrator), 'rename' (p_name), 'restore' and 'purge' (Administrator only)
create or replace function public.driver_file_action(p_id uuid, p_kind text, p_path text, p_action text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; arr jsonb; out_arr jsonb := '[]'::jsonb; f jsonb;
begin
  if public.app_role() not in ('entry', 'admin', 'editor') then raise exception 'Not allowed'; end if;
  if p_action in ('restore', 'purge') and public.app_role() not in ('admin', 'editor') then raise exception 'Only the office can do this'; end if;
  if public.app_role() = 'entry' and exists (select 1 from transport_entries where id = p_id and trip_completed) then
    raise exception 'This trip is completed. Ask the office to change papers.';
  end if;
  select coalesce(attachments -> p_kind, '[]'::jsonb) into arr from transport_entries where id = p_id;
  if arr is null then raise exception 'Trip not found'; end if;
  for f in select * from jsonb_array_elements(arr) loop
    if f ->> 'path' = p_path then
      if p_action = 'delete' then f := f || jsonb_build_object('deleted_at', now(), 'deleted_by', public.entry_user_name());
      elsif p_action = 'restore' then f := f - 'deleted_at' - 'deleted_by';
      elsif p_action = 'rename' and length(trim(coalesce(p_name, ''))) > 0 then f := f || jsonb_build_object('name', left(trim(p_name), 150), 'renamed_by', public.entry_user_name());
      elsif p_action = 'purge' then continue;
      end if;
    end if;
    out_arr := out_arr || jsonb_build_array(f);
  end loop;
  update transport_entries set attachments = jsonb_set(coalesce(attachments, '{}'::jsonb), array[p_kind], out_arr) where id = p_id returning attachments into v;
  return v;
end $$;

-- Trip complete: driver or office. p_done false = reopen (office only)
create or replace function public.trip_complete(p_id uuid, p_done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() not in ('entry', 'admin', 'editor') then raise exception 'Not allowed'; end if;
  if not p_done and public.app_role() not in ('admin', 'editor') then raise exception 'Only the office can open a completed trip again'; end if;
  update transport_entries set trip_completed = p_done,
    completed_at = case when p_done then now() else null end,
    completed_by = case when p_done then public.entry_user_name() else null end,
    remarks = case when p_done then 'Completed' else remarks end
   where id = p_id;
  if not found then raise exception 'Trip not found'; end if;
end $$;

revoke all on function public.driver_save_trip(uuid, jsonb), public.driver_add_file(uuid, text, jsonb),
  public.driver_file_action(uuid, text, text, text, text), public.trip_complete(uuid, boolean) from public, anon;
grant execute on function public.driver_save_trip(uuid, jsonb), public.driver_add_file(uuid, text, jsonb),
  public.driver_file_action(uuid, text, text, text, text), public.trip_complete(uuid, boolean), public.entry_user_name() to authenticated;

-- trip papers: private bucket. Read: office and drivers. Upload: office and drivers. Remove for good: office only.
insert into storage.buckets (id, name, public, file_size_limit) values ('trip-files', 'trip-files', false, 15728640) on conflict (id) do nothing;
create policy "trip files read" on storage.objects for select to authenticated using (bucket_id = 'trip-files' and (public.can_read() or public.app_role() = 'entry'));
create policy "trip files add" on storage.objects for insert to authenticated with check (bucket_id = 'trip-files' and (public.can_write() or public.app_role() = 'entry'));
create policy "trip files remove" on storage.objects for delete to authenticated using (bucket_id = 'trip-files' and public.can_write());

-- 31 Oct 2026 (later): old trips marked Completed / Done in the sheets count as completed trips;
-- drivers read ONLY open trips; completed trips are counted for them, details only for the office.
update public.transport_entries set trip_completed = true,
  completed_at = coalesce(completed_at, (entry_date::timestamp at time zone 'Asia/Muscat') + interval '18 hours'),
  completed_by = coalesce(completed_by, 'Old trip sheet')
 where not trip_completed and remarks in ('Completed', 'Done');
alter policy "entry read open trips" on public.transport_entries using (public.app_role() = 'entry' and not trip_completed);
create or replace function public.driver_trip_counts(p_driver uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.app_role() in ('entry', 'admin', 'editor', 'viewer') then jsonb_build_object(
    'completed', count(*) filter (where trip_completed),
    'this_month', count(*) filter (where trip_completed and date_trunc('month', completed_at at time zone 'Asia/Muscat') = date_trunc('month', now() at time zone 'Asia/Muscat')),
    'open', count(*) filter (where not trip_completed)) end
  from transport_entries where driver_id = p_driver;
$$;
revoke all on function public.driver_trip_counts(uuid) from public, anon;
grant execute on function public.driver_trip_counts(uuid) to authenticated;
