-- ---------------------------------------------------------------------------
-- Cash fallback and price suggestion. No model is involved in either; these
-- are the deterministic paths.
-- ---------------------------------------------------------------------------
begin;

-- === cash fallback ==========================================================
select tests.ok(
  exists (
    select 1 from public.find_cash_offers(tests.uid('nia.walsh'), 25) o
    where o.wanted_key = 'hull-options-futures-and-other-derivatives-11'
      and o.owner_id = tests.uid('omar.diallo')
  ),
  'a student with no possible swap is offered the book for cash'
);

select tests.ok(
  (select suggested_price_cents from public.find_cash_offers(tests.uid('nia.walsh'), 25) o
    where o.wanted_key = 'hull-options-futures-and-other-derivatives-11') > 0,
  'the cash offer carries a suggested price'
);

-- A want already covered by a cycle must not appear as something to buy.
select tests.eq(
  (select count(*)::int from public.find_cash_offers(tests.uid('ada.chen'), 50) o
    where o.wanted_key = 'mankiw-principles-of-economics-9'),
  0,
  'a want that a swap already covers is not offered for sale'
);

select tests.eq(
  (select count(*)::int from public.find_cash_offers(tests.uid('ada.chen'), 50) o
    where o.owner_id = tests.uid('ada.chen')),
  0,
  'you are never offered your own copy'
);

-- Take the swap away and the same want becomes a purchase.
update public.copies set status = 'withdrawn'
 where owner_id = tests.uid('ada.chen')
   and book_id = (select id from public.books where canonical_key = 'morrison-boyd-organic-chemistry-3');

select tests.ok(
  exists (
    select 1 from public.find_cash_offers(tests.uid('ada.chen'), 50) o
    where o.wanted_key = 'mankiw-principles-of-economics-9'
  ),
  'once the swap collapses, the cash fallback appears'
);

update public.copies set status = 'open'
 where owner_id = tests.uid('ada.chen')
   and book_id = (select id from public.books where canonical_key = 'morrison-boyd-organic-chemistry-3');

-- === price suggestion =======================================================
-- Same book, better copy, higher suggestion. Always.
select tests.ok(
  public.suggest_price_cents(
    (select id from public.books where canonical_key = 'campbell-biology-12'), 'new')
  >
  public.suggest_price_cents(
    (select id from public.books where canonical_key = 'campbell-biology-12'), 'poor'),
  'condition moves the suggested price monotonically'
);

-- With no campus comparables, fall back to list price times a condition factor.
select tests.eq(
  public.suggest_price_cents(
    (select id from public.books where canonical_key = 'stewart-calculus-early-transcendentals-9'), 'good'),
  (select round(list_price_cents * 0.35)::int from public.books
    where canonical_key = 'stewart-calculus-early-transcendentals-9'),
  'with no copies on campus, the suggestion is list price times the condition factor'
);

select tests.ok(
  public.suggest_price_cents(
    (select id from public.books where canonical_key = 'campbell-biology-12'), 'good') > 0,
  'with copies on campus, the suggestion is driven by the campus median'
);

select tests.eq(
  public.suggest_price_cents(gen_random_uuid(), 'good'),
  null::int,
  'an unknown book has no suggested price rather than a made-up one'
);

-- === demand counts ==========================================================
select tests.eq(
  public.book_demand('campbell-biology-12'),
  (select count(*)::int from public.wants
    where canonical_key = 'campbell-biology-12' and status = 'active'),
  'demand count matches the underlying wants'
);

select tests.eq(
  public.book_demand('a-book-nobody-has-heard-of-1'),
  0,
  'an unknown key has zero demand, not an error'
);

-- === the edge view stays private ===========================================
select tests.login('ada.chen');

select tests.raises(
  $$select count(*) from public.match_edges$$,
  'the edge list is not readable over the API'
);

select tests.raises(
  $$select count(*) from public.match_edges_best$$,
  'neither is the reduced edge list'
);

select tests.raises(
  $$select public.materialize_matches(10)$$,
  'a client cannot rewrite the match table'
);

-- Responding to a trade is allowed, but only for participants.
select tests.raises(
  format($$select public.respond_to_match(
            (select m.id from public.matches m
              where not exists (select 1 from public.match_legs l
                                 where l.match_id = m.id
                                   and (l.giver_id = %L or l.receiver_id = %L))
              limit 1), 'accepted')$$,
         tests.uid('ada.chen'), tests.uid('ada.chen')),
  'you cannot accept a trade you are not part of'
);

select tests.eq(
  public.respond_to_match(
    (select m.id from public.matches m
       join public.match_legs l on l.match_id = m.id
      where l.giver_id = tests.uid('ada.chen')
      limit 1),
    'accepted')::text,
  'accepted',
  'a participant can accept their own trade'
);

select tests.raises(
  format($$select public.respond_to_match(
            (select m.id from public.matches m
               join public.match_legs l on l.match_id = m.id
              where l.giver_id = %L limit 1), 'expired')$$, tests.uid('ada.chen')),
  'a participant cannot force an arbitrary status'
);

select tests.logout();

rollback;
