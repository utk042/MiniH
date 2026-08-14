-- ---------------------------------------------------------------------------
-- LOCAL VERIFICATION SHIM — never applied to a real Supabase project.
--
-- Supabase ships `auth`, `storage`, the `anon` / `authenticated` /
-- `service_role` roles, and the `supabase_realtime` publication. A bare
-- Postgres 16 cluster does not. This file creates the smallest faithful
-- version of each so that supabase/migrations/*.sql can be applied verbatim
-- and RLS can be exercised the way PostgREST exercises it.
--
-- Only the columns and functions the migrations actually touch are recreated.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- --- roles ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- --- auth schema ------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  -- GoTrue keeps these NOT NULL DEFAULT ''. The seed writes them explicitly so
  -- the same file works against a real project.
  confirmation_token     varchar(255) not null default '',
  recovery_token         varchar(255) not null default '',
  email_change           varchar(255) not null default '',
  email_change_token_new varchar(255) not null default ''
);

-- Mirrors GoTrue's helpers. PostgREST sets `request.jwt.claims` per request;
-- our tests do the same with `set local`.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'role', '');
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'email', '');
$$;

-- --- storage schema ---------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now(),
  metadata   jsonb
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant select on storage.buckets to anon, authenticated;

-- --- realtime publication ---------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
