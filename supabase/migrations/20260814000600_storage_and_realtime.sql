-- ---------------------------------------------------------------------------
-- 000600 — copy photo storage + realtime publication
-- ---------------------------------------------------------------------------

-- --- bucket -----------------------------------------------------------------
-- One image per copy, max 4 MB, path is always '<owner uuid>/<filename>'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'copy-photos',
  'copy-photos',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Photos of textbooks are not sensitive and public reads keep the list view
-- fast (no signed-URL round trip per row). Writes are owner-scoped by path.
drop policy if exists copy_photos_read      on storage.objects;
drop policy if exists copy_photos_insert    on storage.objects;
drop policy if exists copy_photos_update    on storage.objects;
drop policy if exists copy_photos_delete    on storage.objects;

create policy copy_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'copy-photos');

create policy copy_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'copy-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy copy_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'copy-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'copy-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy copy_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'copy-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- --- realtime ---------------------------------------------------------------
-- A new listing must light up existing matches without a refresh. RLS still
-- applies to realtime payloads, so a client only ever receives rows it could
-- have selected.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach t in array array['copies', 'wants', 'matches', 'match_legs', 'messages'] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- Realtime needs the old row to compute deletes/updates for filtered
-- subscriptions.
alter table public.copies     replica identity full;
alter table public.matches    replica identity full;
alter table public.match_legs replica identity full;
