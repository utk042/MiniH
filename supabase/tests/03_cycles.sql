-- ---------------------------------------------------------------------------
-- The cycle search. These are the assertions the demo depends on.
-- ---------------------------------------------------------------------------
begin;

create temporary table cycles on commit drop as
select * from public.find_swap_cycles(null, 4, 500);

select tests.ok((select count(*) from cycles) > 0, 'the seeded graph contains trades at all');

-- === the three staged trades ===============================================
select tests.eq(
  (select count(*)::int from cycles c
    where c.leg_count = 3
      and tests.sorted(c.participants) = tests.sorted(array[
            tests.uid('ada.chen'), tests.uid('bo.mensah'), tests.uid('cy.okafor')])),
  1,
  'the staged three-way is found exactly once'
);

select tests.eq(
  (select count(*)::int from cycles c
    where c.leg_count = 4
      and tests.sorted(c.participants) = tests.sorted(array[
            tests.uid('dee.laurent'), tests.uid('eli.novak'),
            tests.uid('fern.abbott'), tests.uid('gus.iversen')])),
  1,
  'the staged four-way is found exactly once'
);

select tests.eq(
  (select count(*)::int from cycles c
    where c.leg_count = 2
      and tests.sorted(c.participants) = tests.sorted(array[
            tests.uid('hana.suzuki'), tests.uid('ike.brennan')])),
  1,
  'the staged direct swap is found exactly once'
);

-- The books actually change hands in the right direction.
select tests.ok(
  exists (
    select 1 from cycles c
    join public.books b on b.id = c.book_ids[array_position(c.participants, tests.uid('ada.chen'))]
    where c.leg_count = 3
      and tests.sorted(c.participants) = tests.sorted(array[
            tests.uid('ada.chen'), tests.uid('bo.mensah'), tests.uid('cy.okafor')])
      and b.canonical_key = 'morrison-boyd-organic-chemistry-3'
  ),
  'in the three-way, Ada is the one giving up the Morrison and Boyd'
);

-- === structural invariants ==================================================
select tests.eq(
  (select count(*)::int from cycles c
    where cardinality(c.participants) <> c.leg_count
       or cardinality(c.copy_ids)     <> c.leg_count
       or cardinality(c.book_ids)     <> c.leg_count
       or cardinality(c.want_ids)     <> c.leg_count),
  0,
  'every cycle has one participant, one copy and one want per leg'
);

select tests.eq(
  (select count(*)::int from cycles c
    where cardinality(tests.sorted(c.participants)) <> cardinality(array(select distinct unnest(c.participants)))),
  0,
  'nobody appears twice in a cycle'
);

select tests.eq(
  (select count(*)::int from cycles c
    where cardinality(c.copy_ids) <> cardinality(array(select distinct unnest(c.copy_ids)))),
  0,
  'no copy is handed over twice in one cycle'
);

select tests.eq(
  (select count(*)::int from cycles where leg_count > 4 or leg_count < 2),
  0,
  'cycles are between two and four people'
);

-- Each leg must be a real edge: the giver owns that copy and the receiver
-- wants it. This is what "everyone gives one and gets one" reduces to.
select tests.eq(
  (select count(*)::int
     from cycles c
     cross join lateral generate_series(1, c.leg_count) i
     left join public.copies cp on cp.id = c.copy_ids[i]
     left join public.wants  w  on w.id  = c.want_ids[i]
    where cp.owner_id is distinct from c.participants[i]
       or w.user_id   is distinct from c.participants[(i % c.leg_count) + 1]
       or cp.status <> 'open'
       or w.status  <> 'active'),
  0,
  'every leg is a real open-copy-to-active-want hand-off'
);

-- === no duplicate rotations =================================================
select tests.eq(
  (select count(*)::int from (select distinct signature from cycles) s),
  (select count(*)::int from cycles),
  'each cycle is returned under one signature'
);

select tests.eq(
  (select count(*)::int from (
     select tests.sorted(participants) as p, array(select distinct unnest(copy_ids) order by 1) as c
       from cycles group by 1, 2 having count(*) > 1) d),
  0,
  'the same trade is never returned twice as a rotation'
);

-- The anchor rule: the smallest participant id starts the array.
select tests.eq(
  (select count(*)::int from cycles where participants[1] <> (tests.sorted(participants))[1]),
  0,
  'every cycle is anchored at its smallest participant'
);

-- === depth cap ==============================================================
select tests.eq(
  (select coalesce(max(leg_count), 0)::int from public.find_swap_cycles(null, 9, 500)),
  4,
  'asking for depth 9 still caps at 4'
);

select tests.eq(
  (select coalesce(max(leg_count), 0)::int from public.find_swap_cycles(null, 2, 500)),
  2,
  'depth 2 returns direct swaps only'
);

-- === ordering ===============================================================
select tests.ok(
  (select bool_and(ok) from (
     select leg_count >= lag(leg_count) over (order by rn) as ok
       from (select leg_count, row_number() over () as rn
               from public.find_swap_cycles(null, 4, 500)) t
   ) s where ok is not null),
  'results come back shortest-cycle first'
);

-- === per-user filter ========================================================
select tests.eq(
  (select count(*)::int from public.find_swap_cycles(tests.uid('ada.chen'), 4, 500) c
    where not (tests.uid('ada.chen') = any (c.participants))),
  0,
  'filtering by user returns only that user''s trades'
);

select tests.eq(
  (select count(*)::int from public.find_swap_cycles(tests.uid('nia.walsh'), 4, 500)),
  0,
  'a student with no return path has no swap at all'
);

-- === edition tolerance ======================================================
select tests.ok(
  exists (
    select 1 from cycles c
    where c.leg_count = 2
      and tests.sorted(c.participants) = tests.sorted(array[tests.uid('jun.park'), tests.uid('kira.osei')])
      and c.all_exact = false
  ),
  'a first edition fills a want for the second, and the trade is flagged inexact'
);

select tests.eq(
  (select count(*)::int from public.match_edges e
    where e.receiver_id = tests.uid('lena.ortiz')
      and e.wanted_key = 'stewart-calculus-early-transcendentals-9'),
  0,
  'a strict want does not match the wrong edition'
);

-- Prove it is strictness doing the work, not a missing copy.
update public.wants set edition_strict = false
 where user_id = tests.uid('lena.ortiz')
   and canonical_key = 'stewart-calculus-early-transcendentals-9';

select tests.ok(
  (select count(*) from public.match_edges e
    where e.receiver_id = tests.uid('lena.ortiz')
      and e.wanted_key = 'stewart-calculus-early-transcendentals-9'
      and e.exact = false) >= 1,
  'relaxing the same want immediately produces an inexact edge'
);

update public.wants set edition_strict = true
 where user_id = tests.uid('lena.ortiz')
   and canonical_key = 'stewart-calculus-early-transcendentals-9';

-- Different works never merge, however similar the author string.
select tests.eq(
  (select count(*)::int from public.match_edges e
     join public.books ob on ob.canonical_key = e.offered_key
     join public.books wb on wb.canonical_key = e.wanted_key
    where ob.work_key <> wb.work_key),
  0,
  'an inexact edge never crosses from one work to another'
);

-- === materialization ========================================================
select tests.eq(
  (select count(*)::int from public.matches where status = 'proposed'),
  (select count(*)::int from cycles),
  'the seed materialized every live cycle'
);

-- Every match ever written keeps its legs, whatever its status becomes
-- afterward — an expired match's legs are frozen at its last live shape, not
-- deleted, so this holds across the whole table, not just 'proposed' rows.
select tests.eq(
  (select count(*)::int from public.match_legs),
  (select sum(leg_count)::int from public.matches),
  'every match has exactly its legs, whatever its status'
);

create temporary table before_rerun on commit drop as
select id, signature, leg_count, status from public.matches;

select public.materialize_matches(500);

select tests.eq(
  (select count(*)::int from public.matches),
  (select count(*)::int from before_rerun),
  're-running materialization creates no duplicates'
);

select tests.eq(
  (select count(*)::int from public.matches m
     join before_rerun b on b.signature = m.signature
    where b.id <> m.id),
  0,
  're-running materialization keeps match ids stable'
);

-- === a copy leaving the pool expires its trades =============================
create temporary table ada_three_way on commit drop as
select m.id
  from public.matches m
 where m.leg_count = 3
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('ada.chen'))
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('bo.mensah'))
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('cy.okafor'));

select tests.eq((select count(*)::int from ada_three_way), 1, 'the staged three-way is in the match table');

update public.copies set status = 'traded'
 where owner_id = tests.uid('ada.chen')
   and book_id = (select id from public.books where canonical_key = 'morrison-boyd-organic-chemistry-3');

select public.materialize_matches(500);

select tests.eq(
  (select status::text from public.matches where id = (select id from ada_three_way)),
  'expired',
  'handing the book over expires the trade that depended on it'
);

select tests.eq(
  (select count(*)::int from public.find_swap_cycles(tests.uid('bo.mensah'), 4, 500) c
    where tests.sorted(c.participants) = tests.sorted(array[
            tests.uid('ada.chen'), tests.uid('bo.mensah'), tests.uid('cy.okafor')])),
  0,
  'and the cycle stops being found'
);

-- Putting it back brings the trade back to life on the same row.
update public.copies set status = 'open'
 where owner_id = tests.uid('ada.chen')
   and book_id = (select id from public.books where canonical_key = 'morrison-boyd-organic-chemistry-3');

select public.materialize_matches(500);

select tests.eq(
  (select status::text from public.matches where id = (select id from ada_three_way)),
  'proposed',
  'relisting revives the same match row rather than making a new one'
);

-- === a want disappearing expires its trade too, not just a copy ============
-- Regression: materialize_matches() used to expire a 'proposed' match only
-- when one of its copies stopped being open. A cycle can just as easily stop
-- existing because a WANT changed — archived, or an edition_strict flip that
-- removes the edge — with no copy involved at all. Before the fix, a match
-- like that stayed 'proposed' forever, and its legs were the ones left
-- dangling in the 'every match has exactly its legs' check above.
create temporary table hana_ike_swap on commit drop as
select m.id
  from public.matches m
 where m.leg_count = 2
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('hana.suzuki'))
   and exists (select 1 from public.match_legs l
                where l.match_id = m.id and l.giver_id = tests.uid('ike.brennan'));

select tests.eq((select count(*)::int from hana_ike_swap), 1, 'the staged direct swap is in the match table');

update public.wants set status = 'archived'
 where user_id = tests.uid('ike.brennan')
   and canonical_key = 'rudin-principles-of-mathematical-analysis-3';

select tests.eq(
  (select status::text from public.matches where id = (select id from hana_ike_swap)),
  'expired',
  'archiving the want alone — no copy touched — expires the match, via the wants trigger'
);

select tests.eq(
  (select leg_count::int from public.matches where id = (select id from hana_ike_swap)),
  (select count(*)::int from public.match_legs where match_id = (select id from hana_ike_swap)),
  'the expired match keeps its legs rather than losing them'
);

update public.wants set status = 'active'
 where user_id = tests.uid('ike.brennan')
   and canonical_key = 'rudin-principles-of-mathematical-analysis-3';

select tests.eq(
  (select status::text from public.matches where id = (select id from hana_ike_swap)),
  'proposed',
  'reactivating the want revives the same match row'
);

rollback;
