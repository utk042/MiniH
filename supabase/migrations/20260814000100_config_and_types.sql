-- ---------------------------------------------------------------------------
-- 000100 — app config + shared enum types
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is built in from PG13, but pgcrypto is cheap insurance and
-- Supabase provisions it by default.
create extension if not exists pgcrypto with schema extensions;

-- --- app_config -------------------------------------------------------------
-- One row per knob. The campus email domain lives here rather than in a
-- hard-coded trigger body so it can be changed without a migration.
create table public.app_config (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

comment on table public.app_config is
  'Single-row-per-key runtime settings. Readable by all authenticated users, writable only by service_role.';

insert into public.app_config (key, value, description) values
  ('allowed_email_domain', 'westfield.edu',
   'Sign-up is refused for any address outside this domain. Enforced by a BEFORE INSERT trigger on auth.users.'),
  ('campus_name', 'Westfield College',
   'Display name used in UI chrome.');

create or replace function public.allowed_email_domain()
returns text
language sql
stable
set search_path = public
as $$
  select value from public.app_config where key = 'allowed_email_domain';
$$;

comment on function public.allowed_email_domain() is
  'The one place the campus domain is read from.';

create or replace function public.set_allowed_email_domain(p_domain text)
returns text
language sql
volatile
set search_path = public
as $$
  update public.app_config
     set value = lower(btrim(p_domain)), updated_at = now()
   where key = 'allowed_email_domain'
  returning value;
$$;

revoke all on function public.set_allowed_email_domain(text) from public, anon, authenticated;

-- --- enums ------------------------------------------------------------------

-- Ordered worst -> best so that `order by condition` is meaningful.
create type public.copy_condition as enum ('poor', 'fair', 'good', 'like_new', 'new');

create type public.copy_status as enum ('open', 'reserved', 'traded', 'withdrawn');

create type public.want_status as enum ('active', 'fulfilled', 'archived');

-- 'swap' = a closed 1-for-1 cycle of 2..4 people. 'cash' = plain buy/sell,
-- offered only where no cycle exists.
create type public.match_kind as enum ('swap', 'cash');

create type public.match_status as enum ('proposed', 'accepted', 'declined', 'expired', 'completed');

-- Where a canonical record came from. 'human' always outranks 'gemini'.
create type public.canon_source as enum ('gemini', 'fallback', 'human', 'seed');

-- --- condition scoring ------------------------------------------------------
-- Immutable so it can back a generated column. 5 = new, 1 = poor.
create or replace function public.condition_score(p_condition public.copy_condition)
returns integer
language sql
immutable
parallel safe
as $$
  select case p_condition
           when 'new'      then 5
           when 'like_new' then 4
           when 'good'     then 3
           when 'fair'     then 2
           when 'poor'     then 1
         end;
$$;

-- --- slug helper ------------------------------------------------------------
-- The deterministic fallback used when Gemini output fails validation, and the
-- shape every canonical_key must satisfy.
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
      ),
      '-'
    ),
    ''
  );
$$;
