-- ---------------------------------------------------------------------------
-- RLS, exercised the way PostgREST exercises it: role `authenticated` with a
-- JWT sub claim. Everything here runs against the seeded data.
-- ---------------------------------------------------------------------------
begin;

-- Ground truth, read as the owner (postgres bypasses RLS).
create temporary table expected on commit drop as
select
  (select count(*)::int from public.copies where status = 'open')                      as open_copies,
  (select count(*)::int from public.books)                                             as books,
  (select count(*)::int from public.profiles)                                          as profiles,
  (select count(*)::int from public.wants where user_id = tests.uid('ada.chen'))       as ada_wants,
  (select count(*)::int from public.wants)                                             as all_wants,
  (select count(*)::int from public.matches m
     where exists (select 1 from public.match_legs l
                    where l.match_id = m.id
                      and (l.giver_id = tests.uid('ada.chen') or l.receiver_id = tests.uid('ada.chen')))
  )                                                                                     as ada_matches,
  (select count(*)::int from public.matches)                                           as all_matches;

grant select on expected to authenticated;

select tests.ok((select all_wants from expected) > (select ada_wants from expected),
  'sanity: the campus has more wants than Ada does');

-- === as Ada ================================================================
select tests.login('ada.chen');

select tests.eq((select count(*)::int from public.copies),
                (select open_copies from expected),
                'a student sees every open copy');

select tests.eq((select count(*)::int from public.books),
                (select books from expected),
                'the canonical book list is shared campus-wide');

select tests.eq((select count(*)::int from public.profiles),
                (select profiles from expected),
                'profiles are visible campus-wide');

-- Wants are private: they leak next semester's course schedule.
select tests.eq((select count(*)::int from public.wants),
                (select ada_wants from expected),
                'a student sees only their own wants');

select tests.eq((select count(*)::int from public.wants where user_id = tests.uid('bo.mensah')),
                0,
                'another student''s wants are invisible');

-- Demand is still available, but only as a count.
select tests.ok(public.book_demand('morrison-boyd-organic-chemistry-3') >= 1,
  'demand for a book is exposed as an anonymous count');

-- --- writes are scoped to the owner ----------------------------------------
select tests.raises(
  format($$insert into public.copies (owner_id, book_id, condition)
           values (%L, (select id from public.books limit 1), 'good')$$, tests.uid('bo.mensah')),
  'cannot list a copy under someone else''s name'
);

select tests.raises(
  format($$insert into public.wants (user_id, canonical_key)
           values (%L, 'spivak-calculus-4')$$, tests.uid('bo.mensah')),
  'cannot add a want to someone else''s list'
);

-- RLS filters rather than errors on UPDATE/DELETE, so assert on rows touched.
with touched as (
  update public.copies set notes = 'tampered'
   where owner_id = tests.uid('bo.mensah')
  returning 1
)
select tests.eq((select count(*)::int from touched), 0, 'cannot edit another student''s copy');

with touched as (
  delete from public.copies where owner_id = tests.uid('bo.mensah') returning 1
)
select tests.eq((select count(*)::int from touched), 0, 'cannot delete another student''s copy');

with touched as (
  update public.copies set ask_price_cents = 999
   where owner_id = tests.uid('ada.chen')
  returning 1
)
select tests.ok((select count(*)::int from touched) > 0, 'can edit your own copies');

-- --- matches and messages are participant-only ------------------------------
select tests.eq((select count(*)::int from public.matches),
                (select ada_matches from expected),
                'a student sees only the trades they are part of');

select tests.ok((select ada_matches from expected) < (select all_matches from expected),
  'sanity: the campus has trades Ada is not part of');

select tests.ok(
  not exists (
    select 1 from public.match_legs l
    where l.giver_id <> tests.uid('ada.chen') and l.receiver_id <> tests.uid('ada.chen')
      and l.match_id not in (
        select match_id from public.match_legs
         where giver_id = tests.uid('ada.chen') or receiver_id = tests.uid('ada.chen')
      )
  ),
  'no legs leak from trades Ada is not in'
);

select tests.eq((select count(*)::int from public.messages), 1,
  'Ada sees the one message on her three-way');

select tests.logout();

-- === as an outsider to that thread =========================================
-- The target has to be captured here, as the owner. Read back as Yara it would
-- be filtered out, and she would end up posting into her own thread.
create temporary table foreign_match on commit drop as
select m.id
  from public.matches m
 where not exists (
   select 1 from public.match_legs l
    where l.match_id = m.id
      and (l.giver_id = tests.uid('yara.haddad') or l.receiver_id = tests.uid('yara.haddad'))
 )
 limit 1;

grant select on foreign_match to authenticated;

select tests.eq((select count(*)::int from foreign_match), 1,
  'sanity: there is a trade Yara is not part of');

select tests.login('yara.haddad');

select tests.eq((select count(*)::int from public.messages), 0,
  'a non-participant sees no messages');

select tests.eq((select count(*)::int from public.matches where id = (select id from foreign_match)), 0,
  'a non-participant cannot even see that trade');

select tests.raises(
  format($$insert into public.messages (match_id, sender_id, body)
           values ((select id from foreign_match), %L, 'let me in')$$,
         tests.uid('yara.haddad')),
  'a non-participant cannot post into a thread'
);

select tests.raises(
  format($$insert into public.messages (match_id, sender_id, body)
           values ((select id from public.matches limit 1), %L, 'not my name')$$,
         tests.uid('ada.chen')),
  'a message cannot be posted under someone else''s name'
);

select tests.logout();

-- === message immutability ===================================================
select tests.login('bo.mensah');

select tests.raises(
  $$update public.messages set body = 'rewritten history' where true$$,
  'a message body cannot be edited'
);

with touched as (
  update public.messages set read_at = now() where sender_id <> tests.uid('bo.mensah') returning 1
)
select tests.eq((select count(*)::int from touched), 1, 'a recipient can mark a message read');

select tests.logout();

-- === withdrawn copies drop out of the public list ===========================
update public.copies set status = 'withdrawn'
 where owner_id = tests.uid('bo.mensah')
   and book_id = (select id from public.books where canonical_key = 'axler-linear-algebra-done-right-4');

select tests.login('ada.chen');
select tests.eq((select count(*)::int from public.copies),
                (select open_copies from expected) - 1,
                'a withdrawn copy disappears for everyone else');
select tests.logout();

select tests.login('bo.mensah');
select tests.ok(
  exists (select 1 from public.copies
           where owner_id = tests.uid('bo.mensah') and status = 'withdrawn'),
  'the owner still sees their withdrawn copy'
);
select tests.logout();

-- === the cache is shared, and a human correction is final ===================
select tests.login('sara.mbeki');

select tests.eq((select count(*)::int from public.cache_canonicalization), 1,
  'the canonicalization cache is readable campus-wide');

update public.cache_canonicalization
   set source = 'human', overridden_by = tests.uid('sara.mbeki'), result = result || '{"edition":"3rd ed."}'::jsonb
 where canonical_key = 'morrison-boyd-organic-chemistry-3';

select tests.eq((select source::text from public.cache_canonicalization limit 1), 'human',
  'a student can correct a cached resolution');

select tests.raises(
  $$update public.cache_canonicalization set source = 'gemini' where true$$,
  'automated output cannot overwrite a human correction'
);

select tests.raises(
  format($$insert into public.cache_canonicalization
             (input_hash, raw_input, normalized_input, result, canonical_key, model, source, overridden_by)
           values (repeat('a', 64), 'x', 'x', '{}'::jsonb, 'x', 'm', 'human', %L)$$,
         tests.uid('ada.chen')),
  'a correction cannot be signed with someone else''s name'
);

select tests.logout();

-- === anon gets nothing ======================================================
select set_config('role', 'anon', true);

select tests.raises($$select count(*) from public.copies$$, 'anon cannot read copies at all');
select tests.raises($$select count(*) from public.books$$,  'anon cannot read books at all');
select tests.eq((select count(*)::int from public.app_config where key = 'campus_name'), 1,
  'anon can read app_config, which the sign-in page needs');

select set_config('role', 'none', true);

rollback;
