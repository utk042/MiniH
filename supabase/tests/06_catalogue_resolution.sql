-- ---------------------------------------------------------------------------
-- Catalogue resolution: the lookup that stops two descriptions of one book
-- from becoming two nodes, and — just as importantly — stops two different
-- books from becoming one.
-- ---------------------------------------------------------------------------
begin;

-- === title_key ==============================================================
select tests.eq(
  (select title_key from public.books where canonical_key = 'riverside-shakespeare-complete-works-2'),
  'riverside-shakespeare',
  'a leading article is dropped, so "The X" and "X" agree'
);

select tests.eq(
  (select title_key from public.books where canonical_key = 'stewart-calculus-early-transcendentals-8'),
  'calculus-early-transcendentals',
  'a subtitle survives into title_key'
);

select tests.eq(
  (select count(distinct title_key)::int from public.books
    where canonical_key in ('stewart-calculus-early-transcendentals-8',
                            'stewart-calculus-early-transcendentals-9')),
  1,
  'two editions of one work share a title_key'
);

-- === author_surnames ========================================================
select tests.eq(
  public.author_surnames(array['Robert T. Morrison', 'Robert N. Boyd']),
  array['boyd', 'morrison'],
  'surnames come out of "Given Initial Surname"'
);

select tests.eq(
  public.author_surnames(array['William Strunk Jr.', 'E. B. White']),
  array['strunk', 'white'],
  'a generational suffix is not a surname'
);

select tests.eq(
  public.author_surnames('{}'::text[]),
  '{}'::text[],
  'no authors gives no surnames rather than null'
);

-- === resolve_book: the match we want ========================================
select tests.eq(
  (select canonical_key from public.resolve_book(
     'organic-chemistry', 3, array['morrison', 'boyd'], null)),
  'morrison-boyd-organic-chemistry-3',
  'title, edition and a shared author resolve to the existing book'
);

-- The case the whole function exists for: a derived key that would not match.
select tests.eq(
  (select canonical_key from public.resolve_book(
     'campbell-biology', 12, array['urry', 'cain', 'wasserman'], null)),
  'campbell-biology-12',
  'a listing whose derived key would be urry-campbell-biology-12 lands on the existing node'
);

select tests.eq(
  (select canonical_key from public.resolve_book(
     'university-physics-volume-1', 2, array['ling', 'sanny', 'moebs'], null)),
  'openstax-university-physics-volume-1-2',
  'the OpenStax book resolves even though nobody derives "openstax" from its authors'
);

-- === resolve_book: the matches we must not make =============================
-- Two different books really do share this title.
select tests.eq(
  (select canonical_key from public.resolve_book(
     'organic-chemistry', 9, array['mcmurry'], null)),
  'mcmurry-organic-chemistry-9',
  'the same title with a different author and edition resolves to the other book'
);

select tests.eq(
  (select count(*)::int from public.resolve_book(
     'organic-chemistry', 3, array['mcmurry'], null)),
  0,
  'a title and edition that match but an author that does not is NOT a match'
);

select tests.eq(
  (select count(*)::int from public.resolve_book(
     'calculus-early-transcendentals', 7, array['stewart'], null)),
  0,
  'the wrong edition is not a match'
);

select tests.eq(
  (select count(*)::int from public.resolve_book(
     'a-book-nobody-has-listed', null, array['nobody'], null)),
  0,
  'an unknown book returns nothing rather than a nearest guess'
);

-- === resolve_book: ISBN wins ================================================
update public.books set isbn13 = '9780134093413'
 where canonical_key = 'campbell-biology-12';

select tests.eq(
  (select canonical_key from public.resolve_book(
     'a-completely-different-title', 99, '{}'::text[], '9780134093413')),
  'campbell-biology-12',
  'a matching ISBN resolves regardless of how the title was typed'
);

-- === one row, always ========================================================
select tests.eq(
  (select count(*)::int from public.resolve_book('organic-chemistry', 3, array['morrison'], null)),
  1,
  'resolution returns at most one book'
);

-- === the hit counter ========================================================
select tests.eq(
  (select hits from public.cache_canonicalization limit 1),
  1,
  'the seeded cache entry starts at one hit'
);

select public.bump_canonicalization_hit(
  (select input_hash from public.cache_canonicalization limit 1));

select tests.eq(
  (select hits from public.cache_canonicalization limit 1),
  2,
  'a cache hit is counted'
);

select public.bump_canonicalization_hit('0000000000000000000000000000000000000000000000000000000000000000');
select tests.ok(true, 'counting a hit on an unknown hash is a no-op, not an error');

-- === tag vocabulary =========================================================
select tests.eq(
  (select count(*)::int from public.tag_vocabulary),
  80,
  'the controlled vocabulary is seeded'
);

select tests.eq(
  (select count(*)::int from public.tag_vocabulary where facet = 'subject'),
  26,
  'the subject facet is complete'
);

select tests.login('ada.chen');
select tests.eq(
  (select count(*)::int from public.tag_vocabulary),
  80,
  'a signed-in student can read the vocabulary'
);
select tests.raises(
  $$insert into public.tag_vocabulary (tag, facet) values ('my-own-tag', 'subject')$$,
  'a student cannot add to the controlled vocabulary'
);
select tests.logout();

rollback;
