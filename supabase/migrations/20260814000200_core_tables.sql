-- ---------------------------------------------------------------------------
-- 000200 — core tables
--
-- The graph this whole product is built on:
--
--   copies (what I have)  --edge-->  wants (what you need)
--
-- Both sides key off books.canonical_key, so two people describing the same
-- book in different words land on the same node.
-- ---------------------------------------------------------------------------

-- --- profiles ---------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique
                check (email = lower(email) and email like '%@%.%'),
  handle      text not null unique
                check (handle ~ '^[a-z0-9][a-z0-9._-]{1,38}$'),
  display_name text not null
                check (char_length(btrim(display_name)) between 1 and 80),
  pickup_spot text
                check (pickup_spot is null or char_length(pickup_spot) <= 80),
  bio         text
                check (bio is null or char_length(bio) <= 280),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.profiles.pickup_spot is
  'Free text, e.g. "Ellery Hall lobby". Where this student prefers to hand books over.';

-- --- books (canonical) ------------------------------------------------------
create table public.books (
  id              uuid primary key default gen_random_uuid(),
  -- Deterministic slug: <authors>-<title>-<edition>. Two descriptions of the
  -- same physical edition must produce the same key or the graph fragments.
  canonical_key   text not null unique
                    check (canonical_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Edition-agnostic prefix of canonical_key. Two editions of one work share
  -- it, which is what makes edition-tolerant matching possible.
  work_key        text not null
                    check (work_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title           text not null
                    check (char_length(btrim(title)) between 1 and 300),
  authors         text[] not null default '{}',
  edition_number  integer
                    check (edition_number is null or edition_number between 1 and 60),
  edition_label   text
                    check (edition_label is null or char_length(edition_label) <= 60),
  isbn13          text
                    check (isbn13 is null or isbn13 ~ '^[0-9]{13}$'),
  subject_tags    text[] not null default '{}',
  course_codes    text[] not null default '{}',
  -- Publisher list price in cents. Nullable; only used as an input to the
  -- deterministic price suggestion, never shown as a real offer.
  list_price_cents integer
                    check (list_price_cents is null or list_price_cents between 0 and 100000),
  source          public.canon_source not null default 'gemini',
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- canonical_key must actually start with work_key, or edition-tolerant
  -- matching silently links unrelated books.
  constraint books_key_extends_work_key
    check (canonical_key = work_key or canonical_key like work_key || '-%')
);

create index books_work_key_idx      on public.books (work_key);
create index books_subject_tags_idx  on public.books using gin (subject_tags);
create index books_course_codes_idx  on public.books using gin (course_codes);
create index books_title_prefix_idx  on public.books (lower(title) text_pattern_ops);

-- --- copies (a physical book someone holds) ---------------------------------
create table public.copies (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  book_id         uuid not null references public.books (id) on delete restrict,
  condition       public.copy_condition not null,
  condition_score integer not null
                    generated always as (public.condition_score(condition)) stored,
  notes           text check (notes is null or char_length(notes) <= 500),
  ask_price_cents integer
                    check (ask_price_cents is null or ask_price_cents between 0 and 100000),
  -- Storage object path inside the copy-photos bucket: '<owner uuid>/<file>'.
  photo_path      text check (photo_path is null or char_length(photo_path) <= 300),
  status          public.copy_status not null default 'open',
  -- What the owner actually typed, and the cache key its canonicalization
  -- landed under. Kept so a correction can be traced back to its input.
  raw_input       text check (raw_input is null or char_length(raw_input) <= 1000),
  input_hash      text check (input_hash is null or input_hash ~ '^[a-f0-9]{64}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index copies_owner_idx  on public.copies (owner_id);
create index copies_book_idx   on public.copies (book_id);
-- The hot path: every edge scan starts from open copies.
create index copies_open_idx   on public.copies (book_id, condition_score desc)
  where status = 'open';

-- --- wants ------------------------------------------------------------------
create table public.wants (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  canonical_key  text not null references public.books (canonical_key)
                   on update cascade on delete cascade,
  -- 1 = need it before term starts, 5 = idle curiosity.
  priority       smallint not null default 3 check (priority between 1 and 5),
  -- When true, a different edition of the same work will NOT match.
  edition_strict boolean not null default false,
  status         public.want_status not null default 'active',
  note           text check (note is null or char_length(note) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, canonical_key)
);

create index wants_user_idx on public.wants (user_id);
create index wants_key_idx  on public.wants (canonical_key) where status = 'active';

-- --- matches (materialized results) -----------------------------------------
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  kind            public.match_kind not null,
  -- Number of legs. 2..4 for swap cycles, 1 for a cash offer.
  leg_count       smallint not null check (leg_count between 1 and 4),
  -- Rotation-normalised identity of the trade. Re-running the search finds the
  -- same cycle and updates the row instead of duplicating it.
  signature       text not null unique,
  score           numeric(10,2) not null,
  total_condition integer not null,
  min_condition   integer not null,
  -- False when any leg relies on the edition-tolerant fallback.
  all_exact       boolean not null,
  status          public.match_status not null default 'proposed',
  created_at      timestamptz not null default now(),
  refreshed_at    timestamptz not null default now(),
  constraint matches_swap_has_multiple_legs
    check ((kind = 'swap' and leg_count >= 2) or (kind = 'cash' and leg_count = 1))
);

create index matches_rank_idx on public.matches (leg_count, total_condition desc, score desc)
  where status = 'proposed';

-- One row per hand-off. Leg i: participants[i] gives copy_ids[i] to
-- participants[i+1], wrapping at the end.
create table public.match_legs (
  match_id    uuid not null references public.matches (id) on delete cascade,
  position    smallint not null check (position between 1 and 4),
  giver_id    uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  copy_id     uuid not null references public.copies (id) on delete cascade,
  book_id     uuid not null references public.books (id) on delete cascade,
  want_id     uuid references public.wants (id) on delete set null,
  exact       boolean not null default true,
  primary key (match_id, position),
  constraint match_legs_no_self_trade check (giver_id <> receiver_id)
);

create index match_legs_giver_idx    on public.match_legs (giver_id);
create index match_legs_receiver_idx on public.match_legs (receiver_id);
create index match_legs_copy_idx     on public.match_legs (copy_id);

-- --- messages ---------------------------------------------------------------
-- One thread per match. There is no messaging outside a proposed trade.
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index messages_match_idx on public.messages (match_id, created_at);

-- --- canonicalization cache -------------------------------------------------
-- Keyed by hash of the normalised raw input. Same string typed twice costs
-- zero Gemini calls. A human correction overwrites the row and pins it.
create table public.cache_canonicalization (
  input_hash       text primary key check (input_hash ~ '^[a-f0-9]{64}$'),
  raw_input        text not null,
  normalized_input text not null,
  result           jsonb not null,
  canonical_key    text not null,
  model            text not null,
  source           public.canon_source not null,
  hits             integer not null default 0 check (hits >= 0),
  overridden_by    uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index cache_canonicalization_key_idx on public.cache_canonicalization (canonical_key);

comment on column public.cache_canonicalization.normalized_input is
  'Lower-cased, whitespace-collapsed input. The hash is taken over THIS, not raw_input, so trivial spacing differences still hit the cache.';

-- --- updated_at -------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch                before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger books_touch                   before update on public.books
  for each row execute function public.touch_updated_at();
create trigger copies_touch                  before update on public.copies
  for each row execute function public.touch_updated_at();
create trigger wants_touch                   before update on public.wants
  for each row execute function public.touch_updated_at();
create trigger cache_canonicalization_touch  before update on public.cache_canonicalization
  for each row execute function public.touch_updated_at();
