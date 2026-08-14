-- ---------------------------------------------------------------------------
-- 000800 — auto-refresh matches on listing/want changes
--
-- materialize_matches() is SECURITY DEFINER and revoked from authenticated —
-- a student cannot call it directly, and should not have to. Instead, adding a
-- copy or a want fires a statement-level trigger that rescans the graph, so
-- "a new listing lights up existing matches" is true at the data layer before
-- any realtime code exists. The realtime piece (step 5) only has to subscribe
-- to the matches table; it does not have to cause the refresh.
--
-- Statement-level, not row-level: materialize_matches() rescans the whole
-- graph regardless of which row changed, so firing it once per statement
-- (however many rows it touched) is correct and cheaper than firing it once
-- per row.
-- ---------------------------------------------------------------------------

create or replace function public.trg_refresh_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.materialize_matches(500);
  return null;
end;
$$;

revoke all on function public.trg_refresh_matches() from public, anon, authenticated;

drop trigger if exists copies_refresh_matches on public.copies;
create trigger copies_refresh_matches
  after insert or update of status on public.copies
  for each statement
  execute function public.trg_refresh_matches();

drop trigger if exists wants_refresh_matches on public.wants;
create trigger wants_refresh_matches
  after insert or update of status, edition_strict on public.wants
  for each statement
  execute function public.trg_refresh_matches();
