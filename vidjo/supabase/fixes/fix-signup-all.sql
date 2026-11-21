-- VidJo signup repair.
-- Run this entire file once in Supabase Dashboard -> SQL Editor.
-- It is safe to run more than once and repairs all known signup failure points.

-- 0. Remove Supabase's starter "profiles" trigger if it is still installed.
--    VidJo stores profiles in public.vidjo_profiles, never public.profiles.
--    If public.profiles was deleted, this leftover trigger still fires on every
--    new account and aborts signup with:
--      relation "public.profiles" does not exist
--      current transaction is aborted, commands ignored until end of transaction block
--    Dropping it is safe: VidJo's own trigger is named on_auth_user_created_profile.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 1. Keep profile provisioning from aborting account creation.
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

	while exists (
		select 1
		from public.vidjo_profiles
		where lower(username) = lower(candidate)
			and user_id <> p_user_id
	) loop
		candidate :=
			substr(base, 1, greatest(1, 10 - char_length(counter::text)))
			|| counter::text;
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

create or replace function public.vidjo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	begin
		if new.email_confirmed_at is not null then
			perform public.vidjo_create_profile_for_user(new.id, new.raw_user_meta_data);
		end if;
	exception
		when others then
			raise warning 'vidjo_handle_new_user profile setup failed for %: %', new.id, sqlerrm;
	end;
	return new;
end;
$$;

create or replace function public.vidjo_handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	begin
		if new.email_confirmed_at is not null
			and old.email_confirmed_at is distinct from new.email_confirmed_at
		then
			perform public.vidjo_create_profile_for_user(new.id, new.raw_user_meta_data);
		end if;
	exception
		when others then
			raise warning 'vidjo_handle_confirmed_user profile setup failed for %: %', new.id, sqlerrm;
	end;
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

-- 2. Repair the optional Before User Created deleted-account hook.
create table if not exists public.vidjo_deleted_accounts (
	email text primary key,
	user_id uuid,
	deleted_at timestamptz not null default now()
);

alter table public.vidjo_deleted_accounts enable row level security;

create or replace function public.vidjo_block_deleted_signup(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_email text := lower(coalesce(event->'user'->>'email', ''));
	v_blocked boolean := false;
begin
	begin
		if v_email <> '' then
			select exists (
				select 1
				from public.vidjo_deleted_accounts d
				where d.email = v_email
			) into v_blocked;
		end if;
	exception
		when others then
			raise warning 'vidjo_block_deleted_signup skipped: %', sqlerrm;
			return '{}'::jsonb;
	end;

	if v_blocked then
		return jsonb_build_object(
			'error', jsonb_build_object(
				'message',
				'This email belonged to a deleted VidJo account. Ask a moderator to restore it before signing up again.',
				'http_code',
				403
			)
		);
	end if;

	return '{}'::jsonb;
end;
$$;

grant execute on function public.vidjo_block_deleted_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.vidjo_block_deleted_signup(jsonb) from authenticated, anon, public;
