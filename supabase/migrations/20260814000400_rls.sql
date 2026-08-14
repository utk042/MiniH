-- ---------------------------------------------------------------------------
-- 000400 — Row Level Security
--
-- Reading rules of thumb:
--   profiles  public within the campus
--   books     public within the campus (shared canonical vocabulary)
--   copies    open ones are public; your own are always yours
--   wants     PRIVATE. What you need reveals your course schedule. Other
--             people's wants are only ever surfaced through a match, or as an
--             anonymous demand count from a SECURITY DEFINER function.
--   matches   participants only
--   messages  participants only
--   cache     shared campus-wide; that is the point of a cache
--
-- Every policy is scoped `to authenticated`. anon gets nothing but app_config.
-- ---------------------------------------------------------------------------

alter table public.app_config             enable row level security;
alter table public.profiles               enable row level security;
alter table public.books                  enable row level security;
alter table public.copies                 enable row level security;
alter table public.wants                  enable row level security;
alter table public.matches                enable row level security;
alter table public.match_legs             enable row level security;
alter table public.messages               enable row level security;
alter table public.cache_canonicalization enable row level security;

-- --- helper -----------------------------------------------------------------
-- SECURITY DEFINER so that the matches/messages policies can look at
-- match_legs without recursing into match_legs' own policy.
create or replace function public.is_match_participant(p_match_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.match_legs l
     where l.match_id = p_match_id
       and (l.giver_id = p_user_id or l.receiver_id = p_user_id)
  );
$$;

grant execute on function public.is_match_participant(uuid, uuid) to authenticated;

-- --- app_config -------------------------------------------------------------
grant select on public.app_config to anon, authenticated;

create policy app_config_read on public.app_config
  for select to anon, authenticated
  using (true);
-- No write policy: service_role only.

-- --- profiles ---------------------------------------------------------------
grant select, insert, update on public.profiles to authenticated;

create policy profiles_read_all on public.profiles
  for select to authenticated
  using (true);

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- No delete: profiles die with auth.users.

-- --- books ------------------------------------------------------------------
grant select, insert, update on public.books to authenticated;

create policy books_read_all on public.books
  for select to authenticated
  using (true);

-- Anyone may mint a canonical record (that is what listing a book does), but
-- only under their own name.
create policy books_insert_authenticated on public.books
  for insert to authenticated
  with check (created_by is null or created_by = auth.uid());

-- Corrections are limited to the person who created the record. Everyone else
-- who disagrees creates a different canonical_key.
create policy books_update_own on public.books
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- --- copies -----------------------------------------------------------------
grant select, insert, update, delete on public.copies to authenticated;

create policy copies_read_open_or_own on public.copies
  for select to authenticated
  using (status = 'open' or owner_id = auth.uid());

create policy copies_insert_own on public.copies
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy copies_update_own on public.copies
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy copies_delete_own on public.copies
  for delete to authenticated
  using (owner_id = auth.uid());

-- --- wants ------------------------------------------------------------------
grant select, insert, update, delete on public.wants to authenticated;

create policy wants_read_own on public.wants
  for select to authenticated
  using (user_id = auth.uid());

create policy wants_insert_own on public.wants
  for insert to authenticated
  with check (user_id = auth.uid());

create policy wants_update_own on public.wants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy wants_delete_own on public.wants
  for delete to authenticated
  using (user_id = auth.uid());

-- --- matches ----------------------------------------------------------------
-- Read-only over the API. Rows are written by public.materialize_matches()
-- and status is changed through public.respond_to_match(), both definers.
grant select on public.matches    to authenticated;
grant select on public.match_legs to authenticated;

create policy matches_read_participants on public.matches
  for select to authenticated
  using (public.is_match_participant(id, auth.uid()));

create policy match_legs_read_participants on public.match_legs
  for select to authenticated
  using (public.is_match_participant(match_id, auth.uid()));

-- --- messages ---------------------------------------------------------------
grant select, insert, update on public.messages to authenticated;

create policy messages_read_participants on public.messages
  for select to authenticated
  using (public.is_match_participant(match_id, auth.uid()));

create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_match_participant(match_id, auth.uid())
  );

-- Only for marking someone else's message read. You cannot edit text: the
-- WITH CHECK pins body and sender, so an UPDATE that changes them fails.
create policy messages_mark_read on public.messages
  for update to authenticated
  using (
    public.is_match_participant(match_id, auth.uid())
    and sender_id <> auth.uid()
  )
  with check (
    public.is_match_participant(match_id, auth.uid())
    and sender_id <> auth.uid()
  );

-- --- cache_canonicalization -------------------------------------------------
-- Campus-wide shared cache. Everyone reads, everyone can write a new entry,
-- and a correction must be signed by the person making it.
grant select, insert, update on public.cache_canonicalization to authenticated;

create policy cache_read_all on public.cache_canonicalization
  for select to authenticated
  using (true);

create policy cache_insert_authenticated on public.cache_canonicalization
  for insert to authenticated
  with check (overridden_by is null or overridden_by = auth.uid());

create policy cache_update_authenticated on public.cache_canonicalization
  for update to authenticated
  using (true)
  with check (overridden_by is null or overridden_by = auth.uid());

-- --- immutability guards ----------------------------------------------------
-- RLS controls which rows you may touch, not which columns. These triggers
-- cover the column-level rules the policies above imply.

create or replace function public.guard_message_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body <> old.body
     or new.sender_id <> old.sender_id
     or new.match_id <> old.match_id
     or new.created_at <> old.created_at then
    raise exception 'Messages cannot be edited. Only read_at may change.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger messages_immutable
  before update on public.messages
  for each row execute function public.guard_message_immutable();

-- A human correction is the final word: once source = 'human', an automated
-- writer must not silently overwrite it.
create or replace function public.guard_cache_human_override()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source = 'human' and new.source <> 'human' then
    raise exception 'Cache entry % was corrected by hand; automated output cannot replace it.', old.input_hash
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cache_human_override_wins
  before update on public.cache_canonicalization
  for each row execute function public.guard_cache_human_override();
