-- ---------------------------------------------------------------------------
-- The path a real user takes: sign in, list a book, and have a trade appear
-- that did not exist a moment earlier — with no explicit call to
-- materialize_matches() anywhere in this file. That call is revoked from
-- `authenticated` (see 000500) precisely because a student should never need
-- to make it: the copies_refresh_matches trigger (000800) does it for them.
-- ---------------------------------------------------------------------------
begin;

-- Nia can buy but not swap: nothing leads back to her inside four hops.
select tests.eq(
  (select count(*)::int from public.find_swap_cycles(tests.uid('nia.walsh'), 4, 100)),
  0,
  'before: Nia has no swap'
);

-- Captured before she lists anything, and as postgres (RLS would otherwise
-- hide every match she is not yet part of).
create temporary table before_count on commit drop as
select count(*)::int as n from public.matches;

-- === as Nia, over the API ===================================================
select tests.login('nia.walsh');

-- A signed-in student can run the search for themselves.
select tests.eq(
  (select count(*)::int from public.find_swap_cycles(auth.uid(), 4, 100)),
  0,
  'the search is callable by a signed-in student'
);

-- She lists the book Omar has been looking for. Nothing else in this file
-- touches the matches table — whatever happens next, happens because of this
-- one insert.
insert into public.copies (owner_id, book_id, condition, notes, ask_price_cents)
select auth.uid(), b.id, 'good', 'Found it in a box over the summer.', 4800
  from public.books b
 where b.canonical_key = 'horngren-cost-accounting-17';

select tests.eq(
  (select count(*)::int from public.copies where owner_id = tests.uid('nia.walsh')),
  3,
  'the listing is written under her own name'
);

select tests.logout();

-- === the graph has changed ==================================================
-- Nia gives Horngren to Omar, Omar gives Hull to Nia.
select tests.ok(
  exists (
    select 1 from public.find_swap_cycles(tests.uid('nia.walsh'), 4, 100) c
    where c.leg_count = 2
      and tests.sorted(c.participants)
          = tests.sorted(array[tests.uid('nia.walsh'), tests.uid('omar.diallo')])
  ),
  'after: one listing turns her cash-only want into a direct swap'
);

-- And the cash fallback withdraws, because a swap is the better trade.
select tests.eq(
  (select count(*)::int from public.find_cash_offers(tests.uid('nia.walsh'), 25) o
    where o.wanted_key = 'hull-options-futures-and-other-derivatives-11'),
  0,
  'the cash offer for that want disappears once a swap exists'
);

-- === the trigger already materialized it, unprompted ========================
select tests.ok(
  (select count(*)::int from public.matches) > (select n from before_count),
  'listing the book alone — with no materialize_matches() call in this file — recorded the new trade'
);

create temporary table new_match on commit drop as
select m.id
  from public.matches m
 where m.leg_count = 2
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('nia.walsh'))
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('omar.diallo'));

select tests.eq((select count(*)::int from new_match), 1, 'the new trade is in the match table exactly once');

-- A student cannot call materialize_matches() themselves (000500 revokes it),
-- so the only way to prove the trigger already reached a fixed point is to
-- run it again as postgres and confirm nothing changes.
select public.materialize_matches(500);
select tests.eq(
  (select count(*)::int from public.matches),
  (select n from before_count) + 1,
  're-running materialization by hand adds nothing further'
);

grant select on new_match to authenticated;

-- === and both participants, and only they, can see it =======================
select tests.login('nia.walsh');
select tests.ok(
  exists (select 1 from public.matches where id = (select id from new_match)),
  'Nia can see her new trade'
);
select tests.logout();

select tests.login('omar.diallo');
select tests.ok(
  exists (select 1 from public.matches where id = (select id from new_match)),
  'so can Omar'
);

-- Opening the thread is the next thing the UI does.
insert into public.messages (match_id, sender_id, body)
values ((select id from new_match), tests.uid('omar.diallo'),
        'I have the Hull here. Business school lobby tomorrow at 4?');

select tests.eq(
  (select count(*)::int from public.messages where match_id = (select id from new_match)),
  1,
  'a participant can open the thread'
);
select tests.logout();

select tests.login('yara.haddad');
select tests.eq(
  (select count(*)::int from public.matches where id = (select id from new_match)),
  0,
  'nobody else can see it'
);
select tests.eq(
  (select count(*)::int from public.messages where match_id = (select id from new_match)),
  0,
  'nor read the thread'
);
select tests.logout();

rollback;
