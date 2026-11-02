-- 2 Nov 2026 (applied): Power Editor (app/admin/power) reads the table and column list from this RPC. Administrator only.
create or replace function public.power_tables()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', t.table_name,
      'pk', (select jsonb_agg(k.column_name order by k.ordinal_position) from information_schema.table_constraints tc
              join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
              where tc.table_schema = 'public' and tc.table_name = t.table_name and tc.constraint_type = 'PRIMARY KEY'),
      'cols', (select jsonb_agg(jsonb_build_object('name', c.column_name, 'type', c.data_type, 'null', c.is_nullable = 'YES', 'def', c.column_default is not null) order by c.ordinal_position)
               from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name)
    ) order by t.table_name)
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and t.table_name not in ('audit_log', 'user_events', 'user_sessions', 'alert_dismissals', 'slip_push_subs')
  ), '[]'::jsonb) else '[]'::jsonb end
$$;
revoke all on function public.power_tables() from public, anon;
grant execute on function public.power_tables() to authenticated;
