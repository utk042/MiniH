-- ---------------------------------------------------------------------------
-- 000300 — campus domain enforcement + profile provisioning
--
-- The domain restriction is a database constraint, not a UI check. A magic
-- link requested for gmail.com fails at INSERT time regardless of which client
-- asked for it.
-- ---------------------------------------------------------------------------

create or replace function public.is_campus_email(p_email text)
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(btrim(coalesce(p_email, ''))) like '%@' || public.allowed_email_domain();
$$;

comment on function public.is_campus_email(text) is
  'True when the address belongs to the configured campus domain. Subdomains do not count.';

-- --- BEFORE INSERT on auth.users: refuse non-campus addresses ---------------
create or replace function public.enforce_campus_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text := public.allowed_email_domain();
begin
  if new.email is null or not public.is_campus_email(new.email) then
    raise exception
      'BACKSTACK is restricted to @% addresses. % was refused.', v_domain, coalesce(new.email, '(no email)')
      using errcode = 'check_violation';
  end if;

  new.email := lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists enforce_campus_email on auth.users;
create trigger enforce_campus_email
  before insert on auth.users
  for each row execute function public.enforce_campus_email();

-- --- AFTER INSERT on auth.users: provision the profile ----------------------
-- Handles collide (two "j.park"s), so append a numeric suffix rather than
-- failing the signup.
create or replace function public.claim_handle(p_seed text)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_base    text := coalesce(public.slugify(p_seed), 'student');
  v_handle  text;
  v_suffix  integer := 1;
begin
  v_base := left(v_base, 30);
  if char_length(v_base) < 2 then
    v_base := v_base || 'x';
  end if;

  v_handle := v_base;
  while exists (select 1 from public.profiles p where p.handle = v_handle) loop
    v_suffix := v_suffix + 1;
    v_handle := v_base || v_suffix::text;
  end loop;

  return v_handle;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_part   text := split_part(new.email, '@', 1);
  v_display_name text;
begin
  v_display_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  if v_display_name is null then
    -- "ada.chen" -> "Ada Chen"
    v_display_name := initcap(replace(replace(v_local_part, '.', ' '), '_', ' '));
  end if;

  insert into public.profiles (id, email, handle, display_name, pickup_spot)
  values (
    new.id,
    lower(new.email),
    public.claim_handle(v_local_part),
    left(v_display_name, 80),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'pickup_spot', '')), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- These run as triggers under the definer's rights; nothing should call them
-- over the API.
revoke all on function public.enforce_campus_email() from public, anon, authenticated;
revoke all on function public.handle_new_user()      from public, anon, authenticated;
revoke all on function public.claim_handle(text)     from public, anon, authenticated;
