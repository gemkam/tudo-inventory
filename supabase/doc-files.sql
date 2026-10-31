-- Documents Checklist uploads (applied 31 Oct 2026 via Supabase connector)
alter table public.doc_checklist add column if not exists files jsonb not null default '[]'::jsonb;
insert into storage.buckets (id, name, public, file_size_limit) values ('doc-files', 'doc-files', false, 15728640) on conflict (id) do nothing;
create policy "doc files read" on storage.objects for select to authenticated using (bucket_id = 'doc-files' and public.can_read());
create policy "doc files add" on storage.objects for insert to authenticated with check (bucket_id = 'doc-files' and public.can_write());
create policy "doc files change" on storage.objects for update to authenticated using (bucket_id = 'doc-files' and public.can_write());
create policy "doc files remove" on storage.objects for delete to authenticated using (bucket_id = 'doc-files' and public.can_write());
