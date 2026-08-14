-- ---------------------------------------------------------------------------
-- 000700 — catalogue resolution + the tag vocabulary
--
-- Canonicalization mints a key deterministically from {authors, title,
-- edition}, but a key that is merely deterministic is not enough: if the campus
-- already has a node for a book, a new listing has to land on THAT node, not on
-- a second one that happens to be spelled differently. resolve_book() is that
-- lookup, and it is deliberately conservative — a false match merges two
-- different books permanently, whereas a missed match only leaves a duplicate
-- that can be merged later.
-- ---------------------------------------------------------------------------

-- --- slugify, now accent-aware ---------------------------------------------
-- The original in 000100 dropped non-ASCII letters, turning "Diaz" written
-- with an acute into "d-az". That was tolerable while slugify only produced
-- account handles. From here it also backs the title_key column that catalogue
-- resolution matches on, and TypeScript folds accents, so the two would
-- disagree on any accented title and resolution would silently miss.
--
-- translate() rather than unaccent(): unaccent is only STABLE, and a generated
-- column needs IMMUTABLE. The multi-character cases go through replace().
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(
            translate(
              -- Letters with no decomposition, in both cases: lower() is
              -- locale-dependent for non-ASCII and does nothing under C.
              replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(p_text, ''), 'Æ', 'ae'), 'æ', 'ae'), 'Œ', 'oe'), 'œ', 'oe'), 'ẞ', 'ss'), 'ß', 'ss'), 'Ø', 'o'), 'ø', 'o'), 'Đ', 'd'), 'đ', 'd'), 'Ð', 'd'), 'ð', 'd'), 'Ł', 'l'), 'ł', 'l'), 'Ħ', 'h'), 'ħ', 'h'), 'ı', 'i'), 'Þ', 'th'), 'þ', 'th'),
              'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳ',
              'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyy'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        ),
        '(^-+|-+$)', '', 'g'
      ),
      '-'
    ),
    ''
  );
$$;

-- --- title_key --------------------------------------------------------------
-- The title, slugified, with a leading article dropped so "The Republic" and
-- "Republic" agree. Mirrors titleKey() in lib/canonicalize/slug.ts.
create or replace function public.title_key(p_title text)
returns text
language sql
immutable
parallel safe
as $$
  select public.slugify(regexp_replace(coalesce(p_title, ''), '^(the|a|an)\s+', '', 'i'));
$$;

alter table public.books
  add column title_key text generated always as (public.title_key(title)) stored;

create index books_title_key_idx on public.books (title_key, edition_number);

-- --- surname extraction -----------------------------------------------------
-- Enough to break a title tie. Two different books really can share a title and
-- an edition number ("Organic Chemistry" by Morrison and by McMurry), so the
-- author has to be part of the check.
create or replace function public.author_surnames(p_authors text[])
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(
    array_agg(distinct public.slugify(
      case
        -- "Morrison, Robert T." — the surname is what precedes the comma.
        when n.name like '%,%' then split_part(n.name, ',', 1)
        else coalesce(
          -- A surname preceded by particles: "Ludwig van Beethoven" gives
          -- "van beethoven". Postgres mixes greedy and non-greedy quantifiers
          -- unpredictably, so this is two anchored patterns rather than one
          -- clever one. Mirrors surnameOf() in lib/canonicalize/slug.ts, which
          -- scripts/db/parity.ts checks.
          substring(
            n.trimmed
            -- (?:^|\s) matters: without it "Emile Durkheim" matches on the
            -- "le" inside the given name.
            from '(?i)(?:^|\s)((?:(?:van|von|de|del|della|der|den|di|da|dos|du|la|le|les|ten|ter|st|san|mac|mc|al)[.]?\s+)+\S+)\s*$'
          ),
          -- Otherwise just the trailing token.
          regexp_replace(n.trimmed, '^.*\s', '')
        )
      end
    )) filter (where n.name is not null and btrim(n.name) <> ''),
    '{}'::text[]
  )
  from unnest(coalesce(p_authors, '{}'::text[])) as a,
       lateral (
         select
           btrim(regexp_replace(a, '\(.*?\)', ' ', 'g')) as name,
           btrim(regexp_replace(
             regexp_replace(a, '\(.*?\)', ' ', 'g'),
             '\s+(Jr\.?|Sr\.?|II|III|IV|PhD|Ph\.D\.|MD|M\.D\.|Esq)\s*$', '', 'i'
           )) as trimmed
       ) as n;
$$;

create index books_surnames_idx on public.books using gin (public.author_surnames(authors));

-- --- resolve_book -----------------------------------------------------------
create or replace function public.resolve_book(
  p_title_key      text,
  p_edition_number integer default null,
  p_surnames       text[]  default '{}',
  p_isbn13         text    default null
)
returns table (
  canonical_key  text,
  work_key       text,
  title          text,
  authors        text[],
  edition_number integer,
  edition_label  text,
  subject_tags   text[],
  course_codes   text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select
      b.*,
      case
        -- An ISBN is the book. Nothing else needs checking.
        when p_isbn13 is not null and b.isbn13 = p_isbn13 then 0
        -- Same title, same edition, and an author in common.
        when b.title_key = p_title_key
             and b.edition_number is not distinct from p_edition_number
             and public.author_surnames(b.authors) && p_surnames then 1
        -- Same title and edition, and neither side names an author to argue
        -- with. Weaker, but a titled book with no authors is usually the same
        -- book someone else already listed.
        when b.title_key = p_title_key
             and b.edition_number is not distinct from p_edition_number
             and (cardinality(p_surnames) = 0 or cardinality(b.authors) = 0) then 2
        else null
      end as confidence
    from public.books b
    where (p_isbn13 is not null and b.isbn13 = p_isbn13)
       or b.title_key = p_title_key
  )
  select
    c.canonical_key, c.work_key, c.title, c.authors,
    c.edition_number, c.edition_label, c.subject_tags, c.course_codes
  from candidate c
  where c.confidence is not null
  order by c.confidence, c.created_at
  limit 1;
$$;

comment on function public.resolve_book(text, integer, text[], text) is
  'Finds the existing canonical book a new listing describes, so two descriptions of one book land on one node. Returns nothing rather than guessing.';

grant execute on function public.resolve_book(text, integer, text[], text) to authenticated;

-- --- cache hit counter ------------------------------------------------------
-- A counter is not worth a round trip through the RLS-checked update path, and
-- a failed count must never fail a lookup.
create or replace function public.bump_canonicalization_hit(p_input_hash text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.cache_canonicalization
     set hits = hits + 1
   where input_hash = p_input_hash;
$$;

grant execute on function public.bump_canonicalization_hit(text) to authenticated;

-- --- tag vocabulary ---------------------------------------------------------
-- The controlled list, so tags stay a filter rather than decoration. Kept in
-- step with lib/tags/vocabulary.ts, which a test enforces.
create table public.tag_vocabulary (
  tag        text primary key check (tag ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  facet      text not null check (facet in ('subject', 'topic', 'level', 'format', 'exam')),
  created_at timestamptz not null default now()
);

alter table public.tag_vocabulary enable row level security;
grant select on public.tag_vocabulary to authenticated;

create policy tag_vocabulary_read on public.tag_vocabulary
  for select to authenticated
  using (true);

insert into public.tag_vocabulary (tag, facet) values
  ('anatomy', 'subject'),
  ('anthropology', 'subject'),
  ('art-history', 'subject'),
  ('biochemistry', 'subject'),
  ('biology', 'subject'),
  ('business', 'subject'),
  ('chemistry', 'subject'),
  ('computer-science', 'subject'),
  ('economics', 'subject'),
  ('engineering', 'subject'),
  ('finance', 'subject'),
  ('history', 'subject'),
  ('law', 'subject'),
  ('linguistics', 'subject'),
  ('literature', 'subject'),
  ('mathematics', 'subject'),
  ('music', 'subject'),
  ('neuroscience', 'subject'),
  ('philosophy', 'subject'),
  ('physics', 'subject'),
  ('physiology', 'subject'),
  ('political-science', 'subject'),
  ('psychology', 'subject'),
  ('sociology', 'subject'),
  ('statistics', 'subject'),
  ('writing', 'subject'),
  ('algorithms', 'topic'),
  ('american-history', 'topic'),
  ('american-literature', 'topic'),
  ('ancient-philosophy', 'topic'),
  ('artificial-intelligence', 'topic'),
  ('calculus', 'topic'),
  ('cell-biology', 'topic'),
  ('corporate-finance', 'topic'),
  ('derivatives', 'topic'),
  ('dynamical-systems', 'topic'),
  ('econometrics', 'topic'),
  ('electromagnetism', 'topic'),
  ('english-literature', 'topic'),
  ('genetics', 'topic'),
  ('international', 'topic'),
  ('linear-algebra', 'topic'),
  ('marketing', 'topic'),
  ('mechanics', 'topic'),
  ('metaphysics', 'topic'),
  ('microeconomics', 'topic'),
  ('networks', 'topic'),
  ('organic-chemistry', 'topic'),
  ('physical-chemistry', 'topic'),
  ('political-theory', 'topic'),
  ('probability', 'topic'),
  ('quantum-mechanics', 'topic'),
  ('real-analysis', 'topic'),
  ('shakespeare', 'topic'),
  ('systems', 'topic'),
  ('theory', 'topic'),
  ('twentieth-century', 'topic'),
  ('world-history', 'topic'),
  ('intro-level', 'level'),
  ('upper-division', 'level'),
  ('grad-level', 'level'),
  ('anthology', 'format'),
  ('annotated', 'format'),
  ('access-code-required', 'format'),
  ('edition-sensitive', 'format'),
  ('ex-library', 'format'),
  ('hardcover', 'format'),
  ('international-edition', 'format'),
  ('lab-required', 'format'),
  ('loose-leaf', 'format'),
  ('open-access', 'format'),
  ('paperback', 'format'),
  ('solutions-manual', 'format'),
  ('workbook-included', 'format'),
  ('required-all-majors', 'format'),
  ('exam-prep', 'exam'),
  ('mcat-prep', 'exam'),
  ('lsat-prep', 'exam'),
  ('gre-prep', 'exam'),
  ('interview-prep', 'exam');
