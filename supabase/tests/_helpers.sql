-- ---------------------------------------------------------------------------
-- Test helpers. Loaded by scripts/db/verify.sh before the numbered test files;
-- files whose name starts with '_' are not themselves run as tests.
--
-- No pgTAP dependency: an assertion is a function that raises, so the first
-- failure aborts the file and psql exits non-zero.
-- ---------------------------------------------------------------------------

create schema if not exists tests;

-- Same derivation the seed uses.
create or replace function tests.uid(p_local_part text)
returns uuid
language sql
immutable
as $$
  select md5('backstack:' || p_local_part)::uuid;
$$;

-- Become a signed-in student: set the JWT claims PostgREST would set, then
-- drop into the `authenticated` role so RLS actually applies.
create or replace function tests.login(p_local_part text)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',   tests.uid(p_local_part)::text,
      'role',  'authenticated',
      'email', p_local_part || '@' || public.allowed_email_domain()
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Canonical ordering for comparing participant / copy sets.
create or replace function tests.sorted(p_ids uuid[])
returns uuid[]
language sql
immutable
as $$
  select array(select unnest(p_ids) order by 1);
$$;

create or replace function tests.ok(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'FAILED: %', p_message;
  end if;
  raise notice 'ok   %', p_message;
end;
$$;

create or replace function tests.eq(p_actual anyelement, p_expected anyelement, p_message text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAILED: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
  raise notice 'ok   % (%)', p_message, p_actual;
end;
$$;

-- Expects p_sql to raise. The nested block gives us a subtransaction, so a
-- caught error does not poison the test transaction.
create or replace function tests.raises(p_sql text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok   % (% )', p_message, left(sqlerrm, 90);
    return;
  end;
  raise exception 'FAILED: % (statement was expected to raise, but succeeded)', p_message;
end;
$$;

grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;
