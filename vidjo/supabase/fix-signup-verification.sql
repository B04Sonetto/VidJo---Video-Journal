-- ---------------------------------------------------------------------------
-- Signup fix: do not create a profile (or reserve a username) until the email
-- address is confirmed.
-- ---------------------------------------------------------------------------
-- Symptom: creating an account sent a confirmation code, but the profile row
-- was inserted as soon as Supabase created the auth user. That meant the
-- account and username existed before the code was entered. Abandoning the code
-- left the username reserved forever, and retrying with the same Gmail address
-- produced "username already taken" with no fresh code being sent.
--
-- Paste this whole file into the Supabase SQL editor and run it. It is safe to
-- run more than once. The app code that resends a code for a pending signup is
-- already deployed; this migration fixes the server side.

-- Shared profile insertion used by both triggers below.
create or replace function public.vidjo_create_profile_for_user(
	p_user_id uuid,
	p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	raw_user text := coalesce(p_meta->>'username', p_meta->>'user_name', '');
	clean_user text := trim(raw_user);
	display text := coalesce(
		nullif(trim(p_meta->>'nickname'), ''),
		nullif(trim(p_meta->>'display_name'), ''),
		nullif(trim(p_meta->>'full_name'), ''),
		clean_user
	);
	candidate text;
	base text;
	counter integer := 1;
begin
	if clean_user = ''
		or char_length(clean_user) < 2
		or char_length(clean_user) > 10
		or clean_user !~ '^[A-Za-z0-9_.-]{2,10}$'
	then
		return;
	end if;

	base := substr(clean_user, 1, 10);
	candidate := base;

	-- If the username is already taken, add a numeric suffix without exceeding
	-- the 10-character limit.
	while exists (
		select 1 from public.vidjo_profiles
		where lower(username) = lower(candidate) and user_id <> p_user_id
	) loop
		candidate := substr(base, 1, greatest(1, 10 - char_length(counter::text))) || counter::text;
		counter := counter + 1;
	end loop;

	if display = '' then
		display := candidate;
	end if;

	insert into public.vidjo_profiles (user_id, username, display_name, user_role)
	values (p_user_id, candidate, display, 'user')
	on conflict (user_id) do update set
		username = excluded.username,
		display_name = excluded.display_name,
		updated_at = now();
end;
$$;

-- INSERT: OAuth and auto-confirmed accounts arrive already confirmed and can
-- create their profile straight away. Email/password accounts wait.
create or replace function public.vidjo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.email_confirmed_at is not null then
		perform public.vidjo_create_profile_for_user(new.id, new.raw_user_meta_data);
	end if;
	return new;
end;
$$;

-- UPDATE: Supabase confirms an email address by setting email_confirmed_at.
-- The profile is created at that moment, i.e. only after the code/link worked.
create or replace function public.vidjo_handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.email_confirmed_at is not null
		and old.email_confirmed_at is distinct from new.email_confirmed_at
	then
		perform public.vidjo_create_profile_for_user(new.id, new.raw_user_meta_data);
	end if;
	return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
	after insert on auth.users
	for each row execute function public.vidjo_handle_new_user();

drop trigger if exists on_auth_user_confirmed_profile on auth.users;
create trigger on_auth_user_confirmed_profile
	after update of email_confirmed_at on auth.users
	for each row execute function public.vidjo_handle_confirmed_user();

-- Release usernames that old signups reserved before the code was entered.
-- Only unfinished email/password accounts are touched: those users cannot
-- sign in yet, so they have no journal data or friends to lose.
delete from public.vidjo_profiles p
using auth.users u
where p.user_id = u.id
	and u.email_confirmed_at is null
	and exists (
		select 1 from auth.identities i
		where i.user_id = u.id and i.provider = 'email'
	);

-- Verify: pending signups should now show no profile row, and confirming the
-- code should create one.
--   select u.email, u.email_confirmed_at, p.username
--   from auth.users u left join public.vidjo_profiles p on p.user_id = u.id
--   order by u.created_at desc limit 10;
