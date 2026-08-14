-- ---------------------------------------------------------------------------
-- The campus restriction is a database constraint, and every account gets a
-- profile without the client asking for one.
-- ---------------------------------------------------------------------------
begin;

select tests.eq((select count(*)::int from public.profiles), 25, 'seed produced 25 profiles');

select tests.eq(
  (select count(*)::int from public.profiles where email like '%@' || public.allowed_email_domain()),
  25,
  'every profile sits on the campus domain'
);

-- --- refusals ---------------------------------------------------------------
select tests.raises(
  $$insert into auth.users (id, aud, role, email)
    values (gen_random_uuid(), 'authenticated', 'authenticated', 'someone@gmail.com')$$,
  'an off-campus address is refused'
);

select tests.raises(
  $$insert into auth.users (id, aud, role, email)
    values (gen_random_uuid(), 'authenticated', 'authenticated', 'someone@westfield.edu.attacker.test')$$,
  'a look-alike domain is refused'
);

select tests.raises(
  $$insert into auth.users (id, aud, role, email)
    values (gen_random_uuid(), 'authenticated', 'authenticated', 'westfield.edu@gmail.com')$$,
  'the domain appearing in the local part is refused'
);

select tests.raises(
  $$insert into auth.users (id, aud, role, email)
    values (gen_random_uuid(), 'authenticated', 'authenticated', null)$$,
  'a null address is refused'
);

-- --- acceptance and provisioning --------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values (
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated',
  'New.Student@WESTFIELD.EDU',
  '{"display_name":"New Student","pickup_spot":"Library annex"}'::jsonb
);

select tests.eq(
  (select email from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'new.student@westfield.edu',
  'the address is normalised to lower case'
);

select tests.eq(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'New Student',
  'display_name comes from user metadata'
);

select tests.eq(
  (select handle from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'new-student',
  'handle is slugified from the local part'
);

select tests.eq(
  (select pickup_spot from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Library annex',
  'pickup_spot comes from user metadata'
);

-- Same slug, different address: the signup must not fail.
insert into auth.users (id, aud, role, email)
values (
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated',
  'new_student@westfield.edu'
);

select tests.eq(
  (select handle from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'new-student2',
  'a colliding handle gets a numeric suffix instead of failing'
);

select tests.eq(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'New Student',
  'display_name falls back to a title-cased local part'
);

-- --- the domain is configuration, not a hard-coded string -------------------
select public.set_allowed_email_domain('example.edu');

select tests.raises(
  $$insert into auth.users (id, aud, role, email)
    values (gen_random_uuid(), 'authenticated', 'authenticated', 'someone@westfield.edu')$$,
  'after the switch, the old domain is refused'
);

insert into auth.users (id, aud, role, email)
values ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'visitor@example.edu');

select tests.ok(
  exists (select 1 from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'after the switch, the new domain is accepted'
);

rollback;
