-- ---------------------------------------------------------------------------
-- 000500 — the matching engine
--
-- An edge giver -> receiver exists when the giver holds an open copy that the
-- receiver has an active want for. A trade is a simple directed cycle over
-- those edges: every participant gives exactly one copy and receives exactly
-- one copy. Length 2 is a direct swap; 3 and 4 are the interesting ones.
--
-- The whole search is one recursive CTE. Nothing about it runs in JS.
-- ---------------------------------------------------------------------------

-- --- edge list --------------------------------------------------------------
-- Not granted to anon/authenticated on purpose: it joins other people's wants,
-- which RLS keeps private. Only the SECURITY DEFINER functions below read it.
create view public.match_edges as
select
  c.owner_id                              as giver_id,
  w.user_id                               as receiver_id,
  c.id                                    as copy_id,
  b.id                                    as book_id,
  w.id                                    as want_id,
  b.canonical_key                         as offered_key,
  w.canonical_key                         as wanted_key,
  (b.canonical_key = w.canonical_key)     as exact,
  c.condition_score,
  w.priority,
  -- Deterministic, and readable when it shows up in a query plan:
  --   condition   10..50   physical quality of the copy
  --   exactness   +25      an exact edition beats a near edition, always
  --   urgency      3..15   priority 1 is the most urgent want
  (c.condition_score * 10)
    + (case when b.canonical_key = w.canonical_key then 25 else 0 end)
    + ((6 - w.priority) * 3)              as edge_score
from public.copies c
join public.books  b  on b.id = c.book_id
join public.wants  w  on w.status = 'active'
join public.books  wb on wb.canonical_key = w.canonical_key
where c.status = 'open'
  and c.owner_id <> w.user_id
  and (
        b.canonical_key = w.canonical_key
        -- Edition-tolerant fallback: same work, different edition, and the
        -- want did not insist on the exact edition.
        or (not w.edition_strict and wb.work_key = b.work_key)
      );

comment on view public.match_edges is
  'Directed want->copy edges. Reads private wants, so it is deliberately ungranted; reach it through find_swap_cycles() / find_cash_offers().';

-- One edge per ordered pair, best first. The cycle search walks this instead
-- of the full multigraph: it keeps the recursion small and makes the result
-- deterministic. The full edge list is still used to explain a match.
create view public.match_edges_best as
select distinct on (giver_id, receiver_id) *
from public.match_edges
order by giver_id, receiver_id, edge_score desc, exact desc, copy_id;

revoke all on public.match_edges      from anon, authenticated;
revoke all on public.match_edges_best from anon, authenticated;

-- --- cycle search -----------------------------------------------------------
create or replace function public.find_swap_cycles(
  p_user             uuid    default null,
  p_max_participants integer default 4,
  p_limit            integer default 25
)
returns table (
  leg_count       integer,
  participants    uuid[],
  copy_ids        uuid[],
  book_ids        uuid[],
  want_ids        uuid[],
  all_exact       boolean,
  total_condition integer,
  min_condition   integer,
  score           numeric,
  signature       text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  bounds as (
    -- Depth is capped at 4 participants no matter what the caller passes.
    select least(greatest(coalesce(p_max_participants, 4), 2), 4) as max_participants
  ),
  walk as (
    -- Anchor every path at the numerically smallest participant. A cycle then
    -- has exactly one representation, so rotations never show up as separate
    -- results and no post-hoc de-duplication is needed.
    select
      e.giver_id                        as start_id,
      e.receiver_id                     as node,
      array[e.giver_id, e.receiver_id]  as participants,
      array[e.copy_id]                  as copy_ids,
      array[e.book_id]                  as book_ids,
      array[e.want_id]                  as want_ids,
      e.exact                           as all_exact,
      e.condition_score                 as total_condition,
      e.condition_score                 as min_condition,
      e.edge_score::numeric             as score
    from public.match_edges_best e
    where e.receiver_id > e.giver_id

    union all

    select
      w.start_id,
      e.receiver_id,
      w.participants || e.receiver_id,
      w.copy_ids     || e.copy_id,
      w.book_ids     || e.book_id,
      w.want_ids     || e.want_id,
      w.all_exact and e.exact,
      w.total_condition + e.condition_score,
      least(w.min_condition, e.condition_score),
      w.score + e.edge_score
    from walk w
    join public.match_edges_best e on e.giver_id = w.node
    cross join bounds
    where cardinality(w.participants) < bounds.max_participants
      -- Stay anchored: never revisit the start, never repeat a participant.
      and e.receiver_id > w.start_id
      and not (e.receiver_id = any (w.participants))
  ),
  closed as (
    -- Close the loop back to the anchor. The closing edge adds a leg but no
    -- participant, so leg_count = number of participants.
    select
      cardinality(w.participants)          as leg_count,
      w.participants                       as participants,
      w.copy_ids  || e.copy_id             as copy_ids,
      w.book_ids  || e.book_id             as book_ids,
      w.want_ids  || e.want_id             as want_ids,
      w.all_exact and e.exact              as all_exact,
      w.total_condition + e.condition_score as total_condition,
      least(w.min_condition, e.condition_score) as min_condition,
      w.score + e.edge_score               as score
    from walk w
    join public.match_edges_best e
      on e.giver_id = w.node
     and e.receiver_id = w.start_id
  )
  select
    c.leg_count,
    c.participants,
    c.copy_ids,
    c.book_ids,
    c.want_ids,
    c.all_exact,
    c.total_condition,
    c.min_condition,
    round(c.score, 2) as score,
    'swap:' || c.leg_count::text || ':' || array_to_string(c.copy_ids, '>') as signature
  from closed c
  where p_user is null or p_user = any (c.participants)
  -- Shortest first (fewest people to coordinate), then best condition.
  order by c.leg_count asc, c.total_condition desc, c.score desc, c.copy_ids
  limit greatest(coalesce(p_limit, 25), 1);
$$;

comment on function public.find_swap_cycles(uuid, integer, integer) is
  'Simple directed cycles of 2..4 participants over the want->copy graph. Anchored at the smallest participant id so each cycle is returned once.';

grant execute on function public.find_swap_cycles(uuid, integer, integer) to authenticated;

-- --- deterministic price suggestion -----------------------------------------
-- No model involved. Campus median for that exact book if there is one,
-- otherwise a condition multiplier against list price.
create or replace function public.suggest_price_cents(
  p_book_id   uuid,
  p_condition public.copy_condition
)
returns integer
language sql
stable
set search_path = public
as $$
  with peer as (
    select percentile_cont(0.5) within group (order by c.ask_price_cents) as median_ask
    from public.copies c
    where c.book_id = p_book_id
      and c.status = 'open'
      and c.ask_price_cents is not null
  ),
  book as (
    select list_price_cents from public.books where id = p_book_id
  ),
  multiplier as (
    select case p_condition
             when 'new'      then 0.55
             when 'like_new' then 0.45
             when 'good'     then 0.35
             when 'fair'     then 0.25
             when 'poor'     then 0.15
           end::numeric as m
  )
  select case
           when peer.median_ask is not null then
             -- Nudge the campus median by how this copy compares to 'good'.
             greatest(
               100,
               round(peer.median_ask::numeric * (multiplier.m / 0.35))::integer
             )
           when book.list_price_cents is not null then
             greatest(100, round(book.list_price_cents * multiplier.m)::integer)
           else null
         end
  from peer, book, multiplier;
$$;

grant execute on function public.suggest_price_cents(uuid, public.copy_condition) to authenticated;

-- --- cash fallback ----------------------------------------------------------
-- Only for wants that no cycle can satisfy. If a swap exists, we do not show a
-- price.
create or replace function public.find_cash_offers(
  p_user  uuid,
  p_limit integer default 25
)
returns table (
  want_id               uuid,
  wanted_key            text,
  copy_id               uuid,
  book_id               uuid,
  owner_id              uuid,
  condition             public.copy_condition,
  ask_price_cents       integer,
  suggested_price_cents integer,
  exact                 boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with covered as (
    select unnest(c.want_ids) as want_id
    from public.find_swap_cycles(p_user, 4, 100) c
  )
  select
    e.want_id,
    e.wanted_key,
    e.copy_id,
    e.book_id,
    e.giver_id                                     as owner_id,
    c.condition,
    c.ask_price_cents,
    public.suggest_price_cents(e.book_id, c.condition) as suggested_price_cents,
    e.exact
  from public.match_edges e
  join public.copies c on c.id = e.copy_id
  where e.receiver_id = p_user
    and not exists (select 1 from covered where covered.want_id = e.want_id)
  order by e.exact desc, e.priority asc, e.condition_score desc, c.ask_price_cents nulls last
  limit greatest(coalesce(p_limit, 25), 1);
$$;

comment on function public.find_cash_offers(uuid, integer) is
  'Buy/sell fallback. Deliberately excludes wants already covered by a swap cycle — the cycle is always the better trade.';

grant execute on function public.find_cash_offers(uuid, integer) to authenticated;

-- --- who wants this? --------------------------------------------------------
-- Wants are private, so demand is exposed only as a count.
create or replace function public.book_demand(p_canonical_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.wants w
  where w.canonical_key = p_canonical_key
    and w.status = 'active';
$$;

grant execute on function public.book_demand(text) to authenticated;

-- --- materialization --------------------------------------------------------
-- Writes the current cycle set into matches/match_legs. Idempotent: the
-- signature is rotation-normalised, so a second run refreshes rather than
-- duplicates.
create or replace function public.materialize_matches(p_limit integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_written integer := 0;
begin
  -- 1. Expire matches whose copies are no longer available.
  update public.matches m
     set status = 'expired'
   where m.status = 'proposed'
     and exists (
       select 1
         from public.match_legs l
         join public.copies c on c.id = l.copy_id
        where l.match_id = m.id
          and c.status <> 'open'
     );

  -- 2. Snapshot the current cycle set. A temp table rather than one giant CTE:
  --    the upsert, the leg wipe and the leg rebuild must happen in that order,
  --    and data-modifying CTEs give no ordering guarantee.
  create temporary table _cycles on commit drop as
    select * from public.find_swap_cycles(null, 4, greatest(coalesce(p_limit, 200), 1));

  -- 3. Upsert the matches themselves.
  create temporary table _upserted on commit drop as
    with upserted as (
      insert into public.matches
        (kind, leg_count, signature, score, total_condition, min_condition, all_exact)
      select 'swap', c.leg_count, c.signature, c.score, c.total_condition, c.min_condition, c.all_exact
      from _cycles c
      on conflict (signature) do update
        set score           = excluded.score,
            total_condition = excluded.total_condition,
            min_condition   = excluded.min_condition,
            all_exact       = excluded.all_exact,
            -- A cycle that came back after expiring is live again.
            status          = case when matches.status = 'expired'
                                   then 'proposed'::public.match_status
                                   else matches.status end,
            refreshed_at    = now()
      returning id, signature
    )
    select id, signature from upserted;

  -- 4. Rebuild the legs for exactly those matches.
  delete from public.match_legs l
   where l.match_id in (select id from _upserted);

  insert into public.match_legs
    (match_id, position, giver_id, receiver_id, copy_id, book_id, want_id, exact)
  select
    u.id,
    i::smallint,
    c.participants[i],
    -- Wrap: the last giver hands to the anchor.
    c.participants[(i % c.leg_count) + 1],
    c.copy_ids[i],
    c.book_ids[i],
    c.want_ids[i],
    coalesce(
      (select e.exact
         from public.match_edges e
        where e.copy_id = c.copy_ids[i]
          and e.want_id = c.want_ids[i]),
      true
    )
  from _cycles c
  join _upserted u on u.signature = c.signature
  cross join lateral generate_series(1, c.leg_count) as i;

  select count(*)::integer into v_written from _upserted;

  drop table _cycles;
  drop table _upserted;

  return v_written;
end;
$$;

comment on function public.materialize_matches(integer) is
  'Refreshes public.matches from the live graph. Safe to run on every listing change; run it from a trigger or a server route, not from the client.';

revoke all on function public.materialize_matches(integer) from public, anon, authenticated;

-- --- responding to a match --------------------------------------------------
create or replace function public.respond_to_match(
  p_match_id uuid,
  p_status   public.match_status
)
returns public.match_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_status public.match_status;
begin
  if v_user is null then
    raise exception 'Not signed in.' using errcode = 'insufficient_privilege';
  end if;

  if not public.is_match_participant(p_match_id, v_user) then
    raise exception 'You are not part of that trade.' using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('accepted', 'declined', 'completed') then
    raise exception 'A participant may only accept, decline or complete a trade.'
      using errcode = 'check_violation';
  end if;

  update public.matches
     set status = p_status
   where id = p_match_id
  returning status into v_status;

  return v_status;
end;
$$;

grant execute on function public.respond_to_match(uuid, public.match_status) to authenticated;
