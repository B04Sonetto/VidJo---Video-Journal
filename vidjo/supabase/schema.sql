-- VidJo Journal — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- It is safe to re-run: tables, policies, triggers, and the bucket are upserted.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Registered members
-- ---------------------------------------------------------------------------
-- A VidJo member is any account that completes the signup flow. `auth.users.
-- raw_app_meta_data` is server-controlled: a signed-in user cannot edit it with
-- `updateUser()`. At insert time we stamp all new accounts with
-- `vidjo_registered = true`, including OAuth accounts (Google, etc.). Social
-- users get a placeholder profile and the app asks them to choose a username
-- and nickname on their first visit.
-- `raw_user_meta_data` is client-writable via `auth.updateUser()`, so we also
-- check it as a fallback for accounts marked registered after signup.
-- The stamp is deliberately not derived from `provider`/`identities` at read
-- time: GoTrue re-derives `provider` from the oldest identity, so a Google
-- account that adds and then removes identities could otherwise flip to
-- `email`.
--
-- This function is used by every RLS policy below. It reads live rows instead of
-- JWT claims, so existing sessions are protected immediately after this SQL is
-- applied. The app mirrors the same rule in `src/lib/authUser.ts`.

create or replace function public.vidjo_mark_registered_user()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	-- Stamp every new auth user as registered, regardless of provider.
	-- OAuth accounts (Google, etc.) need the stamp too so they can reach
	-- journal data after completing their profile.
	new.raw_app_meta_data :=
		coalesce(new.raw_app_meta_data, '{}'::jsonb)
		|| jsonb_build_object('vidjo_registered', true);
	return new;
end;
$$;

drop trigger if exists vidjo_mark_registered_user on auth.users;
create trigger vidjo_mark_registered_user
	before insert on auth.users
	for each row execute function public.vidjo_mark_registered_user();

-- Backfill all existing accounts so OAuth sign-ins created before this
-- trigger also get the registered stamp.
update auth.users
set raw_app_meta_data =
	coalesce(raw_app_meta_data, '{}'::jsonb)
	|| jsonb_build_object('vidjo_registered', true)
where raw_app_meta_data->>'vidjo_registered' is distinct from 'true';

create or replace function public.vidjo_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from auth.users u
		where u.id = auth.uid()
			and (
				u.raw_app_meta_data->>'vidjo_registered' = 'true'
				or u.raw_user_meta_data->>'vidjo_registered' = 'true'
			)
	);
$$;

revoke all on function public.vidjo_is_member() from public;
revoke all on function public.vidjo_is_member() from anon;
grant execute on function public.vidjo_is_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_entries (
	owner_id text not null,
	entry_date date not null,
	mood text,
	title text not null default '',
	mind text not null default '',
	refl text not null default '',
	privacy text not null default 'private',
	stickers jsonb not null default '[]'::jsonb,
	saved boolean not null default false,
	sample boolean not null default false,
	video_path text,
	video_thumb_path text,
	excluded_friend_ids text[] not null default '{}',
	included_friend_ids text[] not null default '{}',
	share_with_friends boolean not null default false,
	video_url text,
	video_name text,
	updated_at timestamptz not null default now(),
	primary key (owner_id, entry_date)
);

alter table public.vidjo_entries add column if not exists video_path text;
alter table public.vidjo_entries add column if not exists video_thumb_path text;
alter table public.vidjo_entries add column if not exists excluded_friend_ids text[] not null default '{}';
alter table public.vidjo_entries add column if not exists included_friend_ids text[] not null default '{}';
alter table public.vidjo_entries add column if not exists share_with_friends boolean not null default false;

-- Migrate legacy public URLs to storage object paths
update public.vidjo_entries
set video_path = regexp_replace(video_url, '^.*/storage/v1/object/public/vidjo-videos/', '')
where video_path is null and video_url is not null and video_url like '%vidjo-videos%';

create index if not exists vidjo_entries_owner_idx
	on public.vidjo_entries (owner_id, entry_date);

alter table public.vidjo_entries enable row level security;

-- Remove old prototype policies
drop policy if exists "vidjo read" on public.vidjo_entries;
drop policy if exists "vidjo insert" on public.vidjo_entries;
drop policy if exists "vidjo update" on public.vidjo_entries;
drop policy if exists "vidjo delete" on public.vidjo_entries;

-- Each signed-in user owns rows whose owner_id matches their auth user id.
-- Friends and Community can view non-private entries once those features launch.
drop policy if exists "vidjo entries select own" on public.vidjo_entries;
create policy "vidjo entries select own" on public.vidjo_entries
	for select to authenticated
	using (
		public.vidjo_is_member()
		and (
			auth.uid()::text = owner_id
			or privacy in ('friends', 'community')
		)
	);

drop policy if exists "vidjo entries insert own" on public.vidjo_entries;
create policy "vidjo entries insert own" on public.vidjo_entries
	for insert to authenticated
	with check (public.vidjo_is_member() and auth.uid()::text = owner_id);

drop policy if exists "vidjo entries update own" on public.vidjo_entries;
create policy "vidjo entries update own" on public.vidjo_entries
	for update to authenticated
	using (public.vidjo_is_member() and auth.uid()::text = owner_id)
	with check (public.vidjo_is_member() and auth.uid()::text = owner_id);

drop policy if exists "vidjo entries delete own" on public.vidjo_entries;
create policy "vidjo entries delete own" on public.vidjo_entries
	for delete to authenticated
	using (public.vidjo_is_member() and auth.uid()::text = owner_id);

revoke all on public.vidjo_entries from anon;
grant select, insert, update, delete on public.vidjo_entries to authenticated;

create or replace function public.vidjo_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists vidjo_touch_updated_at on public.vidjo_entries;
create trigger vidjo_touch_updated_at
	before update on public.vidjo_entries
	for each row execute function public.vidjo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles and Unique Usernames
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_profiles (
	user_id uuid primary key references auth.users(id) on delete cascade,
	username text not null,
	display_name text not null default '',
	bio text not null default '',
	avatar_url text,
	banner_url text,
	user_role text not null default 'user',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Safely add columns to existing tables (idempotent).
alter table public.vidjo_profiles add column if not exists avatar_url text;
alter table public.vidjo_profiles add column if not exists banner_url text;
alter table public.vidjo_profiles add column if not exists user_role text not null default 'user';

-- Purge legacy profile picture values that are not real raster images. Older
-- builds accepted any `data:` URI (including `data:image/svg+xml`) or arbitrary
-- string in `avatar_url`, which let a profile picture execute script. Short
-- values are preset emoji/legacy preset names and stay untouched.
update public.vidjo_profiles
set avatar_url = null
where avatar_url is not null
	and avatar_url <> ''
	and avatar_url !~* '^https?://'
	and avatar_url !~* '^//'
	and avatar_url !~* '^data:image/(png|jpe?g|gif|webp|avif|bmp|x-icon);'
	and char_length(avatar_url) > 12;

update public.vidjo_profiles
set banner_url = null
where banner_url is not null
	and banner_url <> ''
	and banner_url !~* '^https?://'
	and banner_url !~* '^//'
	and banner_url !~* '^data:image/(png|jpe?g|gif|webp|avif|bmp|x-icon);';

-- SVG can carry scripts, so strip those URLs even when they use http(s).
update public.vidjo_profiles
set avatar_url = null
where avatar_url ~* '\.svgz?([?#].*)?$';

update public.vidjo_profiles
set banner_url = null
where banner_url ~* '\.svgz?([?#].*)?$';

-- Banned accounts must lose every policy that depends on membership. The
-- function is redefined here (after `vidjo_profiles` exists) so the ban flag is
-- authoritative on the server instead of only hiding UI.
create or replace function public.vidjo_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from auth.users u
		left join public.vidjo_profiles p on p.user_id = u.id
		where u.id = auth.uid()
			and (
				u.raw_app_meta_data->>'vidjo_registered' = 'true'
				or u.raw_user_meta_data->>'vidjo_registered' = 'true'
			)
			and coalesce(p.user_role, 'user') <> 'banned'
	);
$$;

-- Case-insensitive unique index enforces strictly unique usernames across VidJo
create unique index if not exists vidjo_profiles_username_lower_idx
	on public.vidjo_profiles (lower(username));

alter table public.vidjo_profiles enable row level security;

-- Authenticated members can read profiles (for friends, community, and user lookups)
drop policy if exists "vidjo profiles select" on public.vidjo_profiles;
create policy "vidjo profiles select" on public.vidjo_profiles
	for select to authenticated
	using (public.vidjo_is_member());

-- Users can insert their own profile
drop policy if exists "vidjo profiles insert own" on public.vidjo_profiles;
create policy "vidjo profiles insert own" on public.vidjo_profiles
	for insert to authenticated
	with check (public.vidjo_is_member() and auth.uid() = user_id);

-- Users can update their own profile.
drop policy if exists "vidjo profiles update own" on public.vidjo_profiles;
create policy "vidjo profiles update own" on public.vidjo_profiles
	for update to authenticated
	using (public.vidjo_is_member() and auth.uid() = user_id)
	with check (public.vidjo_is_member() and auth.uid() = user_id);

-- Admins can update any profile, including user_role.
drop policy if exists "vidjo profiles update admin" on public.vidjo_profiles;
create policy "vidjo profiles update admin" on public.vidjo_profiles
	for update to authenticated
	using (
		public.vidjo_is_member()
		and exists (
			select 1 from public.vidjo_profiles 
			where user_id = auth.uid() and user_role = 'admin'
		)
	);

-- The update-own policy intentionally allows profile edits, but `user_role`
-- must stay admin-controlled. Without this guard a member could promote
-- themselves to admin through a direct API call and then moderate others.
create or replace function public.vidjo_guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if tg_op = 'INSERT' then
		if new.user_role is distinct from 'user'
			and auth.uid() is not null
			and not exists (
				select 1 from public.vidjo_profiles
				where user_id = auth.uid() and user_role = 'admin'
			) then
			new.user_role := 'user';
		end if;
	elsif new.user_role is distinct from old.user_role then
		if old.user_role = 'admin' and new.user_role is distinct from 'admin' then
			raise exception 'Admin accounts cannot be demoted or banned.'
				using errcode = 'P0001';
		end if;
		if auth.uid() is not null
			and not exists (
				select 1 from public.vidjo_profiles
				where user_id = auth.uid() and user_role = 'admin'
			) then
			raise exception 'Only admins can change account roles.'
				using errcode = 'P0001';
		end if;
	end if;

	return new;
end;
$$;

drop trigger if exists vidjo_guard_profile_role on public.vidjo_profiles;
create trigger vidjo_guard_profile_role
	before insert or update on public.vidjo_profiles
	for each row execute function public.vidjo_guard_profile_role();

revoke all on function public.vidjo_guard_profile_role() from public;
revoke all on function public.vidjo_guard_profile_role() from anon;
revoke all on function public.vidjo_guard_profile_role() from authenticated;

revoke all on public.vidjo_profiles from anon;
grant select, insert, update on public.vidjo_profiles to authenticated;

-- Helper to check if a username is available during signup (callable by anon/authenticated)
create or replace function public.is_username_available(uname text)
returns boolean
language sql
security definer
set search_path = public
as $$
	select not exists (
		select 1
		from public.vidjo_profiles
		where lower(username) = lower(trim(uname))
	);
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- Trigger to automatically create a profile row when a new user registers.
-- Accounts without a real username (for example, a first-time Google sign-in)
-- deliberately get no profile row: the app shows the completion screen so the
-- person chooses their own username. Provider photos are never copied, so every
-- account starts with the same initial-letter avatar.
create or replace function public.vidjo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	raw_user text := coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'user_name', '');
	clean_user text := trim(raw_user);
	display text := coalesce(
		nullif(trim(new.raw_user_meta_data->>'nickname'), ''),
		nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
		nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
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
		return new;
	end if;

	base := substr(clean_user, 1, 10);
	candidate := base;

	-- If the username is already taken, add a numeric suffix without exceeding
	-- the 10-character limit.
	while exists (
		select 1 from public.vidjo_profiles
		where lower(username) = lower(candidate) and user_id <> new.id
	) loop
		candidate := substr(base, 1, greatest(1, 10 - char_length(counter::text))) || counter::text;
		counter := counter + 1;
	end loop;

	if display = '' then
		display := candidate;
	end if;

	insert into public.vidjo_profiles (user_id, username, display_name, user_role)
	values (new.id, candidate, display, 'user')
	on conflict (user_id) do update set
		username = excluded.username,
		display_name = excluded.display_name,
		updated_at = now();

	return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
	after insert on auth.users
	for each row execute function public.vidjo_handle_new_user();

-- Backfill existing users into vidjo_profiles. Only accounts that already have a
-- real username are inserted; unfinished OAuth accounts stay profile-less until
-- they complete the setup screen.
insert into public.vidjo_profiles (user_id, username, display_name, user_role)
select
	u.id,
	trim(u.raw_user_meta_data->>'username'),
	coalesce(
		nullif(trim(u.raw_user_meta_data->>'nickname'), ''),
		nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
		nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
		trim(u.raw_user_meta_data->>'username')
	),
	'user'
from auth.users u
where (
		u.raw_app_meta_data->>'vidjo_registered' = 'true'
		or u.raw_user_meta_data->>'vidjo_registered' = 'true'
	)
	and nullif(trim(u.raw_user_meta_data->>'username'), '') is not null
	and char_length(trim(u.raw_user_meta_data->>'username')) between 2 and 10
	and trim(u.raw_user_meta_data->>'username') ~ '^[A-Za-z0-9_.-]{2,10}$'
on conflict (user_id) do nothing;

-- Username rules shared with src/lib/username.ts. The client validates first so
-- people get a friendly message, and this trigger enforces the same rules for
-- any direct API call. Only new or changed usernames are checked, so existing
-- rows are never rewritten just because the schema is re-run.
create or replace function public.vidjo_is_obscene_name(input text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
	plain text := lower(coalesce(input, ''));
	collapsed text;
	word text;
	stems text[] := array[
		'fuck', 'shit', 'cunt', 'bitch', 'pussy', 'whore', 'slut', 'faggot',
		'retard', 'penis', 'bastard', 'asshole', 'wanker', 'twat', 'prick',
		'dickhead', 'douche', 'bullshit', 'motherfucker'
	];
	whole_words text[] := array[
		'arse', 'ass', 'crap', 'damn', 'dick', 'hell', 'idiot', 'jerk', 'moron',
		'nigga', 'nigger', 'piss', 'tard'
	];
begin
	-- Swap common lookalikes back to letters, then drop separators.
	plain := translate(plain, '0134578@$!', 'oieastbasi');
	plain := regexp_replace(plain, '[^a-z]', '', 'g');
	if plain = '' then
		return false;
	end if;

	-- Collapse repeated letters so "fuuuck" and "sweaaaaars" still match.
	collapsed := regexp_replace(plain, '(.)\1+', '\1', 'g');

	if plain like '%nigg%' then
		return true;
	end if;

	foreach word in array stems loop
		if plain like '%' || word || '%'
			or collapsed like '%' || regexp_replace(word, '(.)\1+', '\1', 'g') || '%'
		then
			return true;
		end if;
	end loop;

	foreach word in array whole_words loop
		if plain = word or collapsed = regexp_replace(word, '(.)\1+', '\1', 'g') then
			return true;
		end if;
	end loop;

	return false;
end;
$$;

create or replace function public.vidjo_validate_username()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	new.username := trim(new.username);

	if char_length(new.username) < 2
		or char_length(new.username) > 10
		or new.username !~ '^[A-Za-z0-9_.-]{2,10}$'
	then
		raise exception 'Username must be 2-10 letters, numbers, dots, dashes, or underscores.'
			using errcode = '23514';
	end if;

	if public.vidjo_is_obscene_name(new.username) then
		raise exception 'That username is not allowed. Please choose another.'
			using errcode = '23514';
	end if;

	return new;
end;
$$;

drop trigger if exists vidjo_profiles_validate_username on public.vidjo_profiles;
create trigger vidjo_profiles_validate_username
	before insert or update of username on public.vidjo_profiles
	for each row execute function public.vidjo_validate_username();

-- ---------------------------------------------------------------------------
-- One-time migration of pre-account device rows
-- ---------------------------------------------------------------------------

create or replace function public.claim_device_entries(device_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	uid_text text := auth.uid()::text;
	moved integer := 0;
begin
	if auth.uid() is null then
		raise exception 'You must be signed in to claim entries.';
	end if;

	if not public.vidjo_is_member() then
		raise exception 'Create a VidJo account before claiming entries.';
	end if;

	if device_id is null or device_id = '' or device_id = uid_text then
		return 0;
	end if;

	if exists (select 1 from auth.users u where u.id::text = device_id) then
		return 0;
	end if;

	insert into public.vidjo_entries (
		owner_id, entry_date, mood, title, mind, refl, privacy,
		stickers, saved, sample, video_path, video_url, video_name, updated_at
	)
	select
		uid_text, entry_date, mood, title, mind, refl, privacy,
		stickers, saved, sample, video_path, video_url, video_name, updated_at
	from public.vidjo_entries
	where owner_id = device_id
	on conflict (owner_id, entry_date) do nothing;

	get diagnostics moved = row_count;

	delete from public.vidjo_entries where owner_id = device_id;

	return moved;
end;
$$;

revoke all on function public.claim_device_entries(text) from public;
grant execute on function public.claim_device_entries(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Video storage (PRIVATE bucket with signed URLs)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'vidjo-videos',
	'vidjo-videos',
	false,
	52428800,
	array['video/webm', 'video/mp4', 'video/quicktime', 'video/x-matroska', 'image/jpeg']
)
on conflict (id) do update set
	public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vidjo video read" on storage.objects;
drop policy if exists "vidjo video upload" on storage.objects;
drop policy if exists "vidjo video update" on storage.objects;
drop policy if exists "vidjo video delete" on storage.objects;

-- The bucket is private. Signed URLs are created for playback in the app.
-- Private videos (`privacy = 'private'`) can ONLY be accessed by the owner.
-- Shared entries (`privacy in ('friends', 'community')`) can be read by authenticated members.
-- Thumbnails live beside the video and follow the same sharing rule.
create policy "vidjo video read" on storage.objects
	for select to authenticated
	using (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (
			(storage.foldername(name))[1] = auth.uid()::text
			or exists (
				select 1 from public.vidjo_entries e
				where (e.video_path = storage.objects.name
					or e.video_thumb_path = storage.objects.name)
					and e.privacy in ('friends', 'community')
			)
		)
	);

create policy "vidjo video upload" on storage.objects
	for insert to authenticated
	with check (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	);

create policy "vidjo video update" on storage.objects
	for update to authenticated
	using (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	)
	with check (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	);

create policy "vidjo video delete" on storage.objects
	for delete to authenticated
	using (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	);

-- ---------------------------------------------------------------------------
-- Profile image storage (PUBLIC bucket for avatars and banners)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'vidjo-images',
	'vidjo-images',
	true,
	5242880,
	array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
	public = true,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vidjo image read" on storage.objects;
drop policy if exists "vidjo image upload" on storage.objects;
drop policy if exists "vidjo image update" on storage.objects;
drop policy if exists "vidjo image delete" on storage.objects;

create policy "vidjo image read" on storage.objects
	for select to public
	using (bucket_id = 'vidjo-images');

create policy "vidjo image upload" on storage.objects
	for insert to authenticated
	with check (
		bucket_id = 'vidjo-images'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	);

create policy "vidjo image update" on storage.objects
	for update to authenticated
	using (
		bucket_id = 'vidjo-images'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	)
	with check (
		bucket_id = 'vidjo-images'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	);

create policy "vidjo image delete" on storage.objects
	for delete to authenticated
	using (
		bucket_id = 'vidjo-images'
		and public.vidjo_is_member()
		and (storage.foldername(name))[1] = auth.uid()::text
	);

-- ---------------------------------------------------------------------------
-- Google/social sign-in is allowed
-- ---------------------------------------------------------------------------
-- Social accounts are admitted on first sign-in. The app then shows the
-- "Finish setting up VidJo" screen so the person can choose a username and
-- nickname before using the journal.
--
-- This function used to reject every non-email account. Its name is kept for
-- backwards compatibility with projects that already wired it into
-- Authentication → Hooks; re-running this file turns it into a pass-through.
-- You can also remove the hook from the Supabase dashboard entirely.

create or replace function public.hook_reject_social_signups(event jsonb)
returns jsonb
language plpgsql
as $$
begin
	return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_reject_social_signups(jsonb) from public;
revoke all on function public.hook_reject_social_signups(jsonb) from anon, authenticated;
grant execute on function public.hook_reject_social_signups(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Friends & Friend Codes
-- ---------------------------------------------------------------------------

alter table public.vidjo_profiles add column if not exists friend_code text;

create unique index if not exists vidjo_profiles_friend_code_idx
	on public.vidjo_profiles (upper(friend_code));

-- Deterministic friend codes. This mirrors generateFriendCode() in
-- src/lib/state/profile.svelte.ts so a code shown offline matches the one the
-- database would create. Existing codes (for example VJ-DBA6A2) are preserved.
create or replace function public.vidjo_generate_friend_code(uid uuid)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
	chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
	uid_text text := coalesce(uid::text, '');
	hash bigint := 0;
	seed bigint;
	code text := '';
	i integer;
	char_code integer;
begin
	if uid_text = '' then
		return 'VJ-DEMO01';
	end if;

	for i in 1..length(uid_text) loop
		char_code := ascii(substr(uid_text, i, 1));
		hash := (hash << 5) - hash + char_code;
		-- Wrap to a signed 32-bit integer, like JavaScript's `hash |= 0`.
		hash := ((hash + 2147483648) % 4294967296) - 2147483648;
	end loop;

	seed := abs(hash);

	for i in 0..5 loop
		code := code || substr(chars, (seed % 32)::integer + 1, 1);
		seed := (seed / 32) + i * 13 + 7;
	end loop;

	return 'VJ-' || code;
end;
$$;

create or replace function public.vidjo_set_friend_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	if new.friend_code is null or trim(new.friend_code) = '' then
		new.friend_code := public.vidjo_generate_friend_code(new.user_id);
	end if;
	return new;
end;
$$;

drop trigger if exists vidjo_set_friend_code on public.vidjo_profiles;
create trigger vidjo_set_friend_code
	before insert on public.vidjo_profiles
	for each row execute function public.vidjo_set_friend_code();

-- Backfill only missing codes; never overwrite a code a user has already shared.
update public.vidjo_profiles
set friend_code = public.vidjo_generate_friend_code(user_id)
where friend_code is null or trim(friend_code) = '';

revoke all on function public.vidjo_generate_friend_code(uuid) from public;
grant execute on function public.vidjo_generate_friend_code(uuid) to authenticated;

create table if not exists public.vidjo_friends (
	user_id uuid references auth.users(id) on delete cascade,
	friend_id uuid references auth.users(id) on delete cascade,
	status text not null default 'accepted',
	created_at timestamptz not null default now(),
	primary key (user_id, friend_id)
);

alter table public.vidjo_friends enable row level security;

drop policy if exists "vidjo friends select" on public.vidjo_friends;
create policy "vidjo friends select" on public.vidjo_friends
	for select to authenticated
	using (public.vidjo_is_member() and (auth.uid() = user_id or auth.uid() = friend_id));

drop policy if exists "vidjo friends insert" on public.vidjo_friends;
drop policy if exists "vidjo friends delete" on public.vidjo_friends;

-- Friend rows must only be created or removed through the SECURITY DEFINER
-- RPCs (`accept_friend_request`, `remove_friend`, …). Direct inserts used to be
-- allowed for the caller's own `user_id`; combined with either-direction
-- friendship checks that let any authenticated user forge a friendship and read
-- friends-only pages without a request or consent.
revoke all on public.vidjo_friends from anon;
revoke insert, update, delete on public.vidjo_friends from authenticated;
grant select on public.vidjo_friends to authenticated;

-- Deprecated. `add_friend_by_code` created an instant mutual friendship and
-- ignored friend requests / `allow_friend_requests`. It is superseded by
-- `send_friend_request_by_code`; this drop cleans up databases that still have
-- the old, insecure function installed.
drop function if exists public.add_friend_by_code(text);

-- ---------------------------------------------------------------------------
-- Profile preferences
-- ---------------------------------------------------------------------------

alter table public.vidjo_profiles
	add column if not exists accent_color text not null default '#51397A';
alter table public.vidjo_profiles
	add column if not exists theme text not null default 'classic';
alter table public.vidjo_profiles
	add column if not exists default_privacy text not null default 'private';
alter table public.vidjo_profiles
	add column if not exists allow_friend_requests boolean not null default true;

-- ---------------------------------------------------------------------------
-- Communities (subreddit-style groups)
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_communities (
	slug text primary key,
	name text not null,
	tag text not null,
	description text not null default '',
	icon text not null default 'globe',
	color text not null default '#51397A',
	sort_order integer not null default 0,
	created_at timestamptz not null default now()
);

alter table public.vidjo_communities enable row level security;

drop policy if exists "vidjo communities select" on public.vidjo_communities;
create policy "vidjo communities select" on public.vidjo_communities
	for select to authenticated
	using (public.vidjo_is_member());

revoke all on public.vidjo_communities from anon;
grant select on public.vidjo_communities to authenticated;

insert into public.vidjo_communities (slug, name, tag, description, icon, color, sort_order)
values
	('smallwins', 'Small Wins', '#SmallWins', 'Tiny victories, proud moments, and reasons to keep going.', 'spark', '#D4A24C', 1),
	('campussunset', 'Campus Sunset', '#CampusSunset', 'Golden-hour photos, evening walks, and beautiful corners of campus.', 'sun', '#E88C5D', 2),
	('creativeflow', 'Creative Flow', '#CreativeFlow', 'Art, music, writing, and every messy work-in-progress in between.', 'music', '#A77BE8', 3),
	('midtermsurvivals', 'Midterm Survivors', '#MidtermSurvivals', 'Study plans, exam memes, and surviving the middle of the semester together.', 'book', '#5D8CE8', 4),
	('mentalhealth', 'Mental Health', '#MentalHealth', 'Gentle check-ins, coping tips, and a soft place to land.', 'heart', '#E46A8A', 5),
	('studytogether', 'Study Together', '#StudyTogether', 'Find study buddies, share focus playlists, and stay accountable.', 'users', '#3FA37A', 6),
	('greencampus', 'Green Campus', '#GreenCampus', 'Sustainability projects, plants, and little ways to care for the planet.', 'leaf', '#5CA84F', 7),
	('lspustudents', 'LSPU Students', '#LSPUStudents', 'Students at Laguna State Polytechnic University sharing campus life.', 'users', '#5D8CE8', 8),
	('musiclovers', 'Music Lovers', '#MusicLovers', 'Share tracks, playlists, and jam sessions with fellow musicians.', 'music', '#A77BE8', 9),
	('animelovers', 'Anime Lovers', '#AnimeLovers', 'Discuss your favorite shows, movies, and manga.', 'spark', '#E46A8A', 10),
	('bookclub', 'Book Club', '#BookClub', 'Reading lists, literary discussions, and book recommendations.', 'book', '#3FA37A', 11),
	('gaming', 'Gamers Guild', '#GamersGuild', 'Co-op sessions, high scores, and gaming hangouts.', 'spark', '#D4A24C', 12)
on conflict (slug) do update set
	name = excluded.name,
	tag = excluded.tag,
	description = excluded.description,
	icon = excluded.icon,
	color = excluded.color,
	sort_order = excluded.sort_order;

create table if not exists public.vidjo_community_members (
	community_slug text not null references public.vidjo_communities(slug) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (community_slug, user_id)
);

create index if not exists vidjo_community_members_user_idx
	on public.vidjo_community_members (user_id);

alter table public.vidjo_community_members enable row level security;

drop policy if exists "vidjo community members select" on public.vidjo_community_members;
create policy "vidjo community members select" on public.vidjo_community_members
	for select to authenticated
	using (public.vidjo_is_member());

drop policy if exists "vidjo community members insert own" on public.vidjo_community_members;
create policy "vidjo community members insert own" on public.vidjo_community_members
	for insert to authenticated
	with check (public.vidjo_is_member() and auth.uid() = user_id);

drop policy if exists "vidjo community members delete own" on public.vidjo_community_members;
create policy "vidjo community members delete own" on public.vidjo_community_members
	for delete to authenticated
	using (public.vidjo_is_member() and auth.uid() = user_id);

revoke all on public.vidjo_community_members from anon;
grant select, insert, delete on public.vidjo_community_members to authenticated;

alter table public.vidjo_entries add column if not exists community_slug text;

create index if not exists vidjo_entries_community_idx
	on public.vidjo_entries (community_slug, entry_date desc)
	where privacy = 'community';

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
	if value is null or value = '' then
		return null;
	end if;
	return value::uuid;
exception
	when others then
		return null;
end;
$$;

create or replace function public.vidjo_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select a is not null and b is not null and exists (
		select 1
		from public.vidjo_friends f
		where f.status = 'accepted'
			and (
				(f.user_id = a and f.friend_id = b)
				or (f.user_id = b and f.friend_id = a)
			)
	);
$$;

create or replace function public.vidjo_can_view_post(owner uuid, post_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select auth.uid() is not null
		and owner is not null
		and exists (
			select 1
			from public.vidjo_entries e
			where e.owner_id = owner::text
				and e.entry_date = post_date
				and (
					auth.uid()::text = e.owner_id
					or (
						not (auth.uid()::text = any(e.excluded_friend_ids))
						and (
							e.privacy = 'community'
							or (
								e.privacy = 'friends'
								and public.vidjo_are_friends(auth.uid(), owner)
							)
						)
					)
				)
		);
$$;

revoke all on function public.vidjo_try_uuid(text) from public;
revoke all on function public.vidjo_are_friends(uuid, uuid) from public;
revoke all on function public.vidjo_can_view_post(uuid, date) from public;
grant execute on function public.vidjo_try_uuid(text) to authenticated;
grant execute on function public.vidjo_are_friends(uuid, uuid) to authenticated;
grant execute on function public.vidjo_can_view_post(uuid, date) to authenticated;

-- Friends entries are only readable by accepted friends. Community entries
-- remain readable by any registered member.
drop policy if exists "vidjo entries select own" on public.vidjo_entries;
create policy "vidjo entries select own" on public.vidjo_entries
	for select to authenticated
	using (
		public.vidjo_is_member()
		and (
			auth.uid()::text = owner_id
			or (
				not (auth.uid()::text = any(excluded_friend_ids))
				and (
					privacy = 'community'
					or (
						privacy = 'friends'
						and public.vidjo_are_friends(auth.uid(), public.vidjo_try_uuid(owner_id))
					)
				)
			)
		)
	);

-- ---------------------------------------------------------------------------
-- Friend requests
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_friend_requests (
	id uuid primary key default gen_random_uuid(),
	from_user uuid not null references auth.users(id) on delete cascade,
	to_user uuid not null references auth.users(id) on delete cascade,
	status text not null default 'pending'
		check (status in ('pending', 'accepted', 'declined', 'canceled')),
	created_at timestamptz not null default now(),
	responded_at timestamptz,
	constraint vidjo_friend_requests_unique_pair unique (from_user, to_user),
	constraint vidjo_friend_requests_not_self check (from_user <> to_user)
);

create index if not exists vidjo_friend_requests_to_user_idx
	on public.vidjo_friend_requests (to_user, status);
create index if not exists vidjo_friend_requests_from_user_idx
	on public.vidjo_friend_requests (from_user, status);

alter table public.vidjo_friend_requests enable row level security;

drop policy if exists "vidjo friend requests select" on public.vidjo_friend_requests;
create policy "vidjo friend requests select" on public.vidjo_friend_requests
	for select to authenticated
	using (
		public.vidjo_is_member()
		and (auth.uid() = from_user or auth.uid() = to_user)
	);

revoke all on public.vidjo_friend_requests from anon;
grant select on public.vidjo_friend_requests to authenticated;

create or replace function public.send_friend_request_by_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
	target_profile record;
	pending_request record;
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to add friends.');
	end if;

	if not public.vidjo_is_member() then
		return jsonb_build_object('success', false, 'message', 'Create a VidJo account before adding friends.');
	end if;

	-- Do not let one account spray requests across the directory.
	if (
		select count(*)
		from public.vidjo_friend_requests
		where from_user = curr_user
			and created_at > now() - interval '1 hour'
	) >= 10 then
		return jsonb_build_object(
			'success', false,
			'message', 'You have sent a lot of requests. Please wait a little before trying again.'
		);
	end if;

	select * into target_profile
	from public.vidjo_profiles
	where upper(friend_code) = upper(trim(code));

	if not found then
		return jsonb_build_object('success', false, 'message', 'Friend code not found. Check it and try again.');
	end if;

	if target_profile.user_id = curr_user then
		return jsonb_build_object('success', false, 'message', 'That is your own friend code.');
	end if;

	if not coalesce(target_profile.allow_friend_requests, true) then
		return jsonb_build_object('success', false, 'message', 'This person is not accepting friend requests right now.');
	end if;

	if public.vidjo_are_friends(curr_user, target_profile.user_id) then
		return jsonb_build_object(
			'success', true,
			'alreadyFriends', true,
			'message', target_profile.display_name || ' is already on your friends list.'
		);
	end if;

	select * into pending_request
	from public.vidjo_friend_requests
	where status = 'pending'
		and (
			(from_user = curr_user and to_user = target_profile.user_id)
			or (from_user = target_profile.user_id and to_user = curr_user)
		)
	limit 1;

	if found then
		if pending_request.from_user = curr_user then
			return jsonb_build_object('success', false, 'message', 'Friend request already sent. Waiting for them to accept.');
		end if;
		return jsonb_build_object(
			'success', false,
			'message', 'They already sent you a request! Check your Requests tab to accept it.'
		);
	end if;

	-- Clear old declined/canceled history so the pair has one fresh request.
	delete from public.vidjo_friend_requests
	where (from_user = curr_user and to_user = target_profile.user_id)
		or (from_user = target_profile.user_id and to_user = curr_user);

	insert into public.vidjo_friend_requests (from_user, to_user, status)
	values (curr_user, target_profile.user_id, 'pending');

	return jsonb_build_object(
		'success', true,
		'message', 'Friend request sent to ' || target_profile.display_name || '!'
	);
end;
$$;

create or replace function public.accept_friend_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
	request_row record;
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to accept requests.');
	end if;

	select * into request_row
	from public.vidjo_friend_requests
	where id = request_id and status = 'pending'
	for update;

	if not found then
		return jsonb_build_object('success', false, 'message', 'That request is no longer pending.');
	end if;

	if request_row.to_user <> curr_user then
		return jsonb_build_object('success', false, 'message', 'You cannot accept this request.');
	end if;

	insert into public.vidjo_friends (user_id, friend_id, status)
	values (curr_user, request_row.from_user, 'accepted')
	on conflict (user_id, friend_id) do update set status = 'accepted';

	insert into public.vidjo_friends (user_id, friend_id, status)
	values (request_row.from_user, curr_user, 'accepted')
	on conflict (user_id, friend_id) do update set status = 'accepted';

	update public.vidjo_friend_requests
	set status = 'accepted', responded_at = now()
	where id = request_id;

	return jsonb_build_object('success', true, 'message', 'You are now friends!');
end;
$$;

create or replace function public.decline_friend_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
	request_row record;
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to decline requests.');
	end if;

	select * into request_row
	from public.vidjo_friend_requests
	where id = request_id and status = 'pending'
	for update;

	if not found then
		return jsonb_build_object('success', false, 'message', 'That request is no longer pending.');
	end if;

	if request_row.to_user <> curr_user then
		return jsonb_build_object('success', false, 'message', 'You cannot decline this request.');
	end if;

	update public.vidjo_friend_requests
	set status = 'declined', responded_at = now()
	where id = request_id;

	return jsonb_build_object('success', true, 'message', 'Friend request declined.');
end;
$$;

create or replace function public.cancel_friend_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
	request_row record;
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to cancel requests.');
	end if;

	select * into request_row
	from public.vidjo_friend_requests
	where id = request_id and status = 'pending'
	for update;

	if not found then
		return jsonb_build_object('success', false, 'message', 'That request is no longer pending.');
	end if;

	if request_row.from_user <> curr_user then
		return jsonb_build_object('success', false, 'message', 'You cannot cancel this request.');
	end if;

	update public.vidjo_friend_requests
	set status = 'canceled', responded_at = now()
	where id = request_id;

	return jsonb_build_object('success', true, 'message', 'Friend request canceled.');
end;
$$;

create or replace function public.remove_friend(friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to remove friends.');
	end if;

	delete from public.vidjo_friends
	where (user_id = curr_user and friend_id = remove_friend.friend_id)
		or (user_id = remove_friend.friend_id and friend_id = curr_user);

	return jsonb_build_object('success', true, 'message', 'Friend removed.');
end;
$$;

revoke all on function public.send_friend_request_by_code(text) from public;
revoke all on function public.accept_friend_request(uuid) from public;
revoke all on function public.decline_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.remove_friend(uuid) from public;
grant execute on function public.send_friend_request_by_code(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reactions and comments (friends + community feeds)
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_reactions (
	post_owner_id uuid not null references auth.users(id) on delete cascade,
	post_date date not null,
	user_id uuid not null references auth.users(id) on delete cascade,
	reaction text not null check (reaction in ('love', 'spark', 'warm', 'proud')),
	created_at timestamptz not null default now(),
	primary key (post_owner_id, post_date, user_id, reaction)
);

alter table public.vidjo_reactions enable row level security;

drop policy if exists "vidjo reactions select" on public.vidjo_reactions;
create policy "vidjo reactions select" on public.vidjo_reactions
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_can_view_post(post_owner_id, post_date));

drop policy if exists "vidjo reactions insert own" on public.vidjo_reactions;
create policy "vidjo reactions insert own" on public.vidjo_reactions
	for insert to authenticated
	with check (
		public.vidjo_is_member()
		and auth.uid() = user_id
		and public.vidjo_can_view_post(post_owner_id, post_date)
	);

drop policy if exists "vidjo reactions delete own" on public.vidjo_reactions;
create policy "vidjo reactions delete own" on public.vidjo_reactions
	for delete to authenticated
	using (public.vidjo_is_member() and auth.uid() = user_id);

revoke all on public.vidjo_reactions from anon;
grant select, insert, delete on public.vidjo_reactions to authenticated;

create table if not exists public.vidjo_comments (
	id uuid primary key default gen_random_uuid(),
	post_owner_id uuid not null references auth.users(id) on delete cascade,
	post_date date not null,
	author_id uuid not null references auth.users(id) on delete cascade,
	context text not null default 'friends' check (context in ('friends', 'community')),
	body text not null check (char_length(body) between 1 and 500),
	created_at timestamptz not null default now()
);

create index if not exists vidjo_comments_post_idx
	on public.vidjo_comments (post_owner_id, post_date, context, created_at);

alter table public.vidjo_comments enable row level security;

drop policy if exists "vidjo comments select" on public.vidjo_comments;
create policy "vidjo comments select" on public.vidjo_comments
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_can_view_post(post_owner_id, post_date));

drop policy if exists "vidjo comments insert own" on public.vidjo_comments;
create policy "vidjo comments insert own" on public.vidjo_comments
	for insert to authenticated
	with check (
		public.vidjo_is_member()
		and auth.uid() = author_id
		and public.vidjo_can_view_post(post_owner_id, post_date)
	);

drop policy if exists "vidjo comments delete own" on public.vidjo_comments;
create policy "vidjo comments delete own" on public.vidjo_comments
	for delete to authenticated
	using (
		public.vidjo_is_member()
		and auth.uid() = author_id
	);

drop policy if exists "vidjo comments update own" on public.vidjo_comments;
create policy "vidjo comments update own" on public.vidjo_comments
	for update to authenticated
	using (
		public.vidjo_is_member()
		and auth.uid() = author_id
	)
	with check (
		public.vidjo_is_member()
		and auth.uid() = author_id
		and public.vidjo_can_view_post(post_owner_id, post_date)
	);

alter table public.vidjo_comments add column if not exists context text not null default 'friends';

revoke all on public.vidjo_comments from anon;
grant select, insert, update, delete on public.vidjo_comments to authenticated;

-- Server-side profanity masking. The client also masks display text
-- (src/lib/censor.ts), but a direct API call could otherwise store unfiltered
-- content. Keep this word list in sync with OBSCENE_WORDS in censor.ts.
create or replace function public.vidjo_censor_text(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
	result text := coalesce(input, '');
	word text;
	words text[] := array[
		'arse', 'ass', 'asshole', 'bastard', 'bitch', 'bullshit', 'crap', 'cunt',
		'damn', 'dick', 'dickhead', 'douche', 'douchebag', 'dumbass', 'faggot',
		'fuck', 'fucked', 'fucker', 'fucking', 'hell', 'idiot', 'jerk', 'moron',
		'motherfucker', 'nigger', 'nigga', 'penis', 'piss', 'prick', 'pussy',
		'retard', 'shit', 'shitty', 'slut', 'tard', 'twat', 'wanker', 'whore'
	];
begin
	foreach word in array words loop
		-- Allow repeated letters ("shiiit") just like the client pattern.
		result := regexp_replace(
			result,
			'\m' || regexp_replace(word, '(.)', '\1+', 'g') || '\M',
			'***',
			'gi'
		);
	end loop;
	return result;
end;
$$;

create or replace function public.vidjo_censor_comment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	new.body := public.vidjo_censor_text(new.body);
	return new;
end;
$$;

drop trigger if exists vidjo_comments_censor on public.vidjo_comments;
create trigger vidjo_comments_censor
	before insert or update of body on public.vidjo_comments
	for each row execute function public.vidjo_censor_comment();

-- ---------------------------------------------------------------------------
-- Comment reports (flag others' comments to admins)
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_comment_reports (
	id uuid primary key default gen_random_uuid(),
	comment_id uuid not null references public.vidjo_comments(id) on delete cascade,
	reporter_id uuid not null references auth.users(id) on delete cascade,
	reason text not null default 'other',
	created_at timestamptz not null default now()
);

alter table public.vidjo_comment_reports enable row level security;

drop policy if exists "vidjo comment reports insert own" on public.vidjo_comment_reports;
create policy "vidjo comment reports insert own"
	on public.vidjo_comment_reports
	for insert to authenticated
	with check (public.vidjo_is_member() and auth.uid() = reporter_id);

drop policy if exists "vidjo comment reports select" on public.vidjo_comment_reports;
create policy "vidjo comment reports select"
	on public.vidjo_comment_reports
	for select to authenticated
	using (
		public.vidjo_is_member()
		and (
			exists (
				select 1 from public.vidjo_profiles 
				where user_id = auth.uid() and user_role = 'admin'
			)
			or auth.uid() = reporter_id
		)
	);

revoke all on public.vidjo_comment_reports from anon;
grant select, insert on public.vidjo_comment_reports to authenticated;

-- Admin report feed. PostgREST cannot embed `auth.users`, and the
-- `vidjo_comments` SELECT policy is based on post visibility (not admin role),
-- so the client cannot reliably join reports, reporters, and comment authors.
-- This SECURITY DEFINER RPC does the join and verifies the caller is an admin.
-- Dropped first because the return type gained `reported_user_id`; changing a
-- function's return type needs a fresh definition.
drop function if exists public.vidjo_admin_list_reports(int);
create or replace function public.vidjo_admin_list_reports(max_rows int default 50)
returns table (
	id uuid,
	comment_id uuid,
	reason text,
	created_at timestamptz,
	reporter_name text,
	reported_user text,
	reported_user_id uuid,
	comment_body text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	return query
	select
		r.id,
		r.comment_id,
		r.reason,
		r.created_at,
		coalesce(nullif(rp.display_name, ''), rp.username, 'Unknown') as reporter_name,
		coalesce(nullif(ap.display_name, ''), ap.username, 'Unknown') as reported_user,
		c.author_id as reported_user_id,
		c.body as comment_body
	from public.vidjo_comment_reports r
	left join public.vidjo_profiles rp on rp.user_id = r.reporter_id
	left join public.vidjo_comments c on c.id = r.comment_id
	left join public.vidjo_profiles ap on ap.user_id = c.author_id
	order by r.created_at desc
	limit greatest(1, least(coalesce(max_rows, 50), 200));
end;
$$;

revoke all on function public.vidjo_admin_list_reports(int) from public;
grant execute on function public.vidjo_admin_list_reports(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Write rate limits (spam guard)
-- ---------------------------------------------------------------------------

create index if not exists vidjo_comments_author_created_idx
	on public.vidjo_comments (author_id, created_at desc);

create index if not exists vidjo_comment_reports_reporter_created_idx
	on public.vidjo_comment_reports (reporter_id, created_at desc);

create or replace function public.vidjo_enforce_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	recent int;
begin
	if tg_table_name = 'vidjo_comments' then
		select count(*) into recent
		from public.vidjo_comments
		where author_id = new.author_id
			and created_at > now() - interval '1 minute';

		if recent >= 10 then
			raise exception 'You are commenting too quickly. Please wait a moment.'
				using errcode = 'P0001';
		end if;
	elsif tg_table_name = 'vidjo_comment_reports' then
		select count(*) into recent
		from public.vidjo_comment_reports
		where reporter_id = new.reporter_id
			and created_at > now() - interval '1 hour';

		if recent >= 5 then
			raise exception 'You have sent too many reports. Please wait before reporting again.'
				using errcode = 'P0001';
		end if;
	end if;

	return new;
end;
$$;

drop trigger if exists vidjo_comments_rate_limit on public.vidjo_comments;
create trigger vidjo_comments_rate_limit
	before insert on public.vidjo_comments
	for each row execute function public.vidjo_enforce_write_rate_limit();

drop trigger if exists vidjo_comment_reports_rate_limit on public.vidjo_comment_reports;
create trigger vidjo_comment_reports_rate_limit
	before insert on public.vidjo_comment_reports
	for each row execute function public.vidjo_enforce_write_rate_limit();

revoke all on function public.vidjo_enforce_write_rate_limit() from public;
revoke all on function public.vidjo_enforce_write_rate_limit() from anon;
revoke all on function public.vidjo_enforce_write_rate_limit() from authenticated;

-- ---------------------------------------------------------------------------
-- Tighten video playback to match entry visibility
-- ---------------------------------------------------------------------------

drop policy if exists "vidjo video read" on storage.objects;
create policy "vidjo video read" on storage.objects
	for select to authenticated
	using (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (
			(storage.foldername(name))[1] = auth.uid()::text
			or exists (
				select 1
				from public.vidjo_entries e
				where e.video_path = storage.objects.name
					and (
						e.owner_id = auth.uid()::text
						or (
							not (auth.uid()::text = any(e.excluded_friend_ids))
							and (
								e.privacy = 'community'
								or (
									e.privacy = 'friends'
									and public.vidjo_are_friends(auth.uid(), public.vidjo_try_uuid(e.owner_id))
								)
							)
						)
					)
			)
		)
	);

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------

-- Permanently deletes the signed-in user. Profiles, friends, friend requests,
-- posts/comments, reactions and reports cascade through their auth.users
-- foreign keys. Journal entries use a text owner_id with no foreign key, so
-- they are removed explicitly. SECURITY DEFINER lets the function delete from
-- auth.users without exposing service-role credentials to the client.
create or replace function public.vidjo_delete_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to delete your account.');
	end if;

	delete from public.vidjo_entries where owner_id = curr_user::text;
	delete from auth.users where id = curr_user;

	-- A BEFORE DELETE trigger that returns NULL cancels the delete without
	-- raising an error, so confirm the row is really gone before reporting
	-- success. Otherwise the client signs out and leaves the account behind.
	if not found then
		return jsonb_build_object(
			'success', false,
			'message', 'The account could not be deleted. Please contact a moderator.'
		);
	end if;

	return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.vidjo_delete_account() from public;
grant execute on function public.vidjo_delete_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Deleted-account memory
-- ---------------------------------------------------------------------------
-- Supabase creates the `auth.users` row as soon as Google returns, before the
-- app can show the "choose a username" screen. That means a deleted Google
-- account can silently recreate itself unless Auth itself rejects the signup.
-- Remember deleted emails here, then enable the Before User Created auth hook
-- in the dashboard and point it at public.vidjo_block_deleted_signup().
create table if not exists public.vidjo_deleted_accounts (
	email text primary key,
	user_id uuid,
	deleted_at timestamptz not null default now()
);

alter table public.vidjo_deleted_accounts enable row level security;
-- No policies: only SECURITY DEFINER functions and the service role may use it.

-- NEW is NULL inside a DELETE trigger, and a BEFORE DELETE trigger that returns
-- NULL silently cancels the delete. Reading NEW here made every account delete
-- a no-op: the function returned NULL, PostgreSQL skipped the row, no error was
-- raised, and the deleted email was never recorded. Use OLD instead.
create or replace function public.vidjo_remember_deleted_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if old.email is not null and old.email <> '' then
		insert into public.vidjo_deleted_accounts (email, user_id, deleted_at)
		values (lower(old.email), old.id, now())
		on conflict (email) do update
		set user_id = excluded.user_id, deleted_at = excluded.deleted_at;
	end if;
	return old;
end;
$$;

drop trigger if exists vidjo_remember_deleted_account on auth.users;
create trigger vidjo_remember_deleted_account
	before delete on auth.users
	for each row execute function public.vidjo_remember_deleted_account();

-- Before User Created hook. Enable it in Supabase Dashboard → Authentication →
-- Hooks → Before User Created and choose this Postgres function. Returning an
-- error object blocks the signup and shows the message to the client.
-- The variable is `v_email`, not `email`, on purpose. A variable named `email`
-- shadows the `email` column of `vidjo_deleted_accounts`, so PL/pgSQL aborts the
-- query with "column reference \"email\" is ambiguous". That is a runtime error,
-- and because this function is a signup hook it blocked every registration.
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
				select 1 from public.vidjo_deleted_accounts d where d.email = v_email
			) into v_blocked;
		end if;
	exception
		when others then
			-- This hook runs for every signup, so an unexpected database problem
			-- must never lock people out of registration. Log it and allow.
			raise warning 'vidjo_block_deleted_signup skipped: %', sqlerrm;
			return '{}'::jsonb;
	end;

	if v_blocked then
		return jsonb_build_object(
			'error', jsonb_build_object(
				'message', 'This email belonged to a deleted VidJo account. Ask a moderator to restore it before signing up again.',
				'http_code', 403
			)
		);
	end if;

	return '{}'::jsonb;
end;
$$;

grant execute on function public.vidjo_block_deleted_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.vidjo_block_deleted_signup(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Direct messages and group chats
-- ---------------------------------------------------------------------------
-- Messaging is friends-first. Direct threads only exist between accepted
-- friends and become read-only if the pair unfriends. Groups are created by an
-- owner who can only invite their own friends. Every write goes through the
-- SECURITY DEFINER RPCs below; clients only receive SELECT grants on the three
-- tables.

create table if not exists public.vidjo_dm_threads (
	id uuid primary key default gen_random_uuid(),
	kind text not null check (kind in ('direct', 'group')),
	title text,
	created_by uuid references auth.users(id) on delete set null,
	direct_key text unique,
	created_at timestamptz not null default now(),
	last_message_at timestamptz,
	constraint vidjo_dm_threads_shape check (
		(kind = 'direct' and direct_key is not null and title is null)
		or (kind = 'group' and direct_key is null and title is not null)
	),
	constraint vidjo_dm_threads_title check (
		title is null or char_length(btrim(title)) between 1 and 60
	)
);

create index if not exists vidjo_dm_threads_activity_idx
	on public.vidjo_dm_threads (last_message_at desc nulls last);

create table if not exists public.vidjo_dm_participants (
	thread_id uuid not null references public.vidjo_dm_threads(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null default 'member' check (role in ('owner', 'member')),
	last_read_at timestamptz not null default 'epoch',
	joined_at timestamptz not null default now(),
	primary key (thread_id, user_id)
);

create index if not exists vidjo_dm_participants_user_idx
	on public.vidjo_dm_participants (user_id, thread_id);

-- A group has exactly one owner. Direct threads have no owner at all.
create unique index if not exists vidjo_dm_one_owner_per_thread
	on public.vidjo_dm_participants (thread_id)
	where role = 'owner';

create table if not exists public.vidjo_dm_messages (
	id uuid primary key default gen_random_uuid(),
	thread_id uuid not null references public.vidjo_dm_threads(id) on delete cascade,
	sender_id uuid not null references auth.users(id) on delete cascade,
	client_id uuid not null,
	body text not null check (char_length(btrim(body)) between 1 and 2000),
	image_path text,
	gif_url text,
	created_at timestamptz not null default now(),
	deleted_at timestamptz,
	constraint vidjo_dm_messages_client_unique unique (thread_id, sender_id, client_id)
);

-- Existing projects need the image/GIF columns and a body check that permits an
-- attachment-only message (empty body). The constraint name is Postgres' default
-- for the inline check above, so drop and re-add it for both new and old databases.
alter table public.vidjo_dm_messages add column if not exists image_path text;
alter table public.vidjo_dm_messages add column if not exists gif_url text;
alter table public.vidjo_dm_messages drop constraint if exists vidjo_dm_messages_body_check;
alter table public.vidjo_dm_messages add constraint vidjo_dm_messages_body_check check (
	char_length(btrim(body)) <= 2000
	and (char_length(btrim(body)) >= 1 or image_path is not null or gif_url is not null)
);
alter table public.vidjo_dm_messages drop constraint if exists vidjo_dm_messages_image_check;
alter table public.vidjo_dm_messages add constraint vidjo_dm_messages_image_check check (
	image_path is null or char_length(image_path) between 1 and 300
);
-- GIFs are hotlinked from Giphy, so only Giphy HTTPS URLs are stored. This
-- mirrors the client check in `src/lib/giphy.ts`.
alter table public.vidjo_dm_messages drop constraint if exists vidjo_dm_messages_gif_check;
alter table public.vidjo_dm_messages add constraint vidjo_dm_messages_gif_check check (
	gif_url is null or (
		char_length(gif_url) between 1 and 500
		and gif_url ~* '^https://(media[0-9]*|i)\.giphy\.com/'
	)
);
alter table public.vidjo_dm_messages drop constraint if exists vidjo_dm_messages_media_check;
alter table public.vidjo_dm_messages add constraint vidjo_dm_messages_media_check check (
	image_path is null or gif_url is null
);

create index if not exists vidjo_dm_messages_thread_idx
	on public.vidjo_dm_messages (thread_id, created_at desc);
create index if not exists vidjo_dm_messages_sender_idx
	on public.vidjo_dm_messages (sender_id, created_at desc);

-- Defense in depth: even if a future RPC forgets a size check, the participant
-- count cannot grow beyond the limits the UI promises.
create or replace function public.vidjo_dm_check_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_kind text;
	v_count integer;
begin
	select kind into v_kind from public.vidjo_dm_threads where id = new.thread_id;

	if v_kind = 'direct' then
		select count(*) into v_count
		from public.vidjo_dm_participants
		where thread_id = new.thread_id;

		if v_count > 2 then
			raise exception 'Direct conversations can only have two people.';
		end if;
	elsif v_kind = 'group' then
		select count(*) into v_count
		from public.vidjo_dm_participants
		where thread_id = new.thread_id;

		if v_count > 12 then
			raise exception 'Groups can have at most 12 people.';
		end if;
	end if;

	return new;
end;
$$;

drop trigger if exists vidjo_dm_participants_limit on public.vidjo_dm_participants;
create trigger vidjo_dm_participants_limit
	after insert on public.vidjo_dm_participants
	for each row execute function public.vidjo_dm_check_participants();

create or replace function public.vidjo_dm_touch_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update public.vidjo_dm_threads
	set last_message_at = new.created_at
	where id = new.thread_id;

	return new;
end;
$$;

drop trigger if exists vidjo_dm_messages_touch on public.vidjo_dm_messages;
create trigger vidjo_dm_messages_touch
	after insert on public.vidjo_dm_messages
	for each row execute function public.vidjo_dm_touch_thread();

-- Message bodies are masked server-side, just like comments.
create or replace function public.vidjo_dm_censor_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	new.body := public.vidjo_censor_text(new.body);
	return new;
end;
$$;

drop trigger if exists vidjo_dm_messages_censor on public.vidjo_dm_messages;
create trigger vidjo_dm_messages_censor
	before insert or update of body on public.vidjo_dm_messages
	for each row execute function public.vidjo_dm_censor_message();

-- ---------------------------------------------------------------------------
-- Messaging helpers
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_dm_is_participant(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select auth.uid() is not null and exists (
		select 1
		from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id = auth.uid()
	);
$$;

-- True when the signed-in user may post in a thread: group members always can,
-- and direct threads only while the two people are still friends. Storage RLS
-- uses this so an unfriended pair cannot upload new photos either.
create or replace function public.vidjo_dm_can_send(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select auth.uid() is not null and exists (
		select 1
		from public.vidjo_dm_threads t
		join public.vidjo_dm_participants me
			on me.thread_id = t.id and me.user_id = auth.uid()
		where t.id = p_thread
			and (
				t.kind = 'group'
				or exists (
					select 1
					from public.vidjo_dm_participants other
					where other.thread_id = t.id
						and other.user_id <> auth.uid()
						and public.vidjo_are_friends(auth.uid(), other.user_id)
				)
			)
	);
$$;

create or replace function public.vidjo_dm_direct_key(a uuid, b uuid)
returns text
language sql
immutable
set search_path = public
as $$
	select least(a, b)::text || ':' || greatest(a, b)::text;
$$;

-- Internal: returns the one direct thread for a pair, creating it if needed.
create or replace function public.vidjo_dm_ensure_direct(p_user uuid, p_friend uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_thread uuid;
	v_key text := public.vidjo_dm_direct_key(p_user, p_friend);
begin
	if auth.uid() is null or p_user <> auth.uid() then
		raise exception 'Not allowed.';
	end if;

	insert into public.vidjo_dm_threads (kind, direct_key, created_by)
	values ('direct', v_key, p_user)
	on conflict (direct_key) do update
	set direct_key = excluded.direct_key
	returning id into v_thread;

	insert into public.vidjo_dm_participants (thread_id, user_id, role)
	values (v_thread, p_user, 'member'), (v_thread, p_friend, 'member')
	on conflict (thread_id, user_id) do nothing;

	return v_thread;
end;
$$;

-- Internal: validates length and applies the per-sender rate limit.
create or replace function public.vidjo_dm_validate_body(p_body text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_body text := btrim(coalesce(p_body, ''));
	v_recent integer;
	v_daily integer;
begin
	if v_user is null then
		raise exception 'Sign in to send messages.';
	end if;

	if char_length(v_body) > 2000 then
		raise exception 'Messages can be at most 2000 characters.';
	end if;

	select count(*) into v_recent
	from public.vidjo_dm_messages
	where sender_id = v_user and created_at > now() - interval '1 minute';

	if v_recent >= 20 then
		raise exception 'You are sending messages too quickly. Take a breath and try again.';
	end if;

	select count(*) into v_daily
	from public.vidjo_dm_messages
	where sender_id = v_user and created_at > now() - interval '1 day';

	if v_daily >= 200 then
		raise exception 'You have reached the daily message limit.';
	end if;

	return v_body;
end;
$$;

-- ---------------------------------------------------------------------------
-- Messaging RPCs
-- ---------------------------------------------------------------------------

-- The 3-argument version predates photo messages and the 4-argument version
-- predates GIFs. Drop both so PostgREST never has to choose between overloads.
drop function if exists public.vidjo_dm_send(uuid, text, uuid);
drop function if exists public.vidjo_dm_send(uuid, text, uuid, text);

create or replace function public.vidjo_dm_send(
	p_thread uuid,
	p_body text,
	p_client_id uuid,
	p_image_path text default null,
	p_gif_url text default null
)
returns table (
	id uuid,
	thread_id uuid,
	sender_id uuid,
	client_id uuid,
	body text,
	image_path text,
	gif_url text,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_client uuid := coalesce(p_client_id, gen_random_uuid());
	v_body text;
	v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
	v_gif text := nullif(btrim(coalesce(p_gif_url, '')), '');
	v_kind text;
	v_other uuid;
	v_existing public.vidjo_dm_messages%rowtype;
begin
	if v_user is null then
		raise exception 'Sign in to send messages.';
	end if;

	if not public.vidjo_is_member() then
		raise exception 'Create a VidJo account before sending messages.';
	end if;

	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	select t.kind into v_kind from public.vidjo_dm_threads t where t.id = p_thread;

	if v_kind = 'direct' then
		select p.user_id into v_other
		from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id <> v_user
		limit 1;

		if v_other is null or not public.vidjo_are_friends(v_user, v_other) then
			raise exception 'You can only message friends.';
		end if;
	end if;

	-- Retrying the same client id must return the original message, not a copy.
	select * into v_existing
	from public.vidjo_dm_messages m
	where m.thread_id = p_thread
		and m.sender_id = v_user
		and m.client_id = v_client
	limit 1;

	if found then
		return query
		select v_existing.id, v_existing.thread_id, v_existing.sender_id,
			v_existing.client_id, v_existing.body, v_existing.image_path,
			v_existing.gif_url, v_existing.created_at;
		return;
	end if;

	v_body := btrim(coalesce(p_body, ''));

	if char_length(v_body) = 0 and v_image is null and v_gif is null then
		raise exception 'Write a message first.';
	end if;

	if v_image is not null and v_gif is not null then
		raise exception 'Send one attachment at a time.';
	end if;

	if v_image is not null then
		-- The uploader must use their own folder inside this thread, and the
		-- object must really exist in the private bucket before it is linked.
		if v_image !~ (
			'^' || p_thread::text || '/' || v_user::text
			|| '/[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp|gif)$'
		) then
			raise exception 'That photo could not be sent.';
		end if;

		if not exists (
			select 1
			from storage.objects o
			where o.bucket_id = 'vidjo-dm-images' and o.name = v_image
		) then
			raise exception 'Upload the photo first.';
		end if;
	end if;

	if v_gif is not null and (
		char_length(v_gif) > 500
		or v_gif !~* '^https://(media[0-9]*|i)\.giphy\.com/'
	) then
		raise exception 'That GIF could not be sent.';
	end if;

	v_body := public.vidjo_dm_validate_body(v_body);

	begin
		insert into public.vidjo_dm_messages (thread_id, sender_id, client_id, body, image_path, gif_url)
		values (p_thread, v_user, v_client, v_body, v_image, v_gif)
		returning * into v_existing;
	exception
		when unique_violation then
			select * into v_existing
			from public.vidjo_dm_messages m
			where m.thread_id = p_thread
				and m.sender_id = v_user
				and m.client_id = v_client
			limit 1;
	end;

	if v_existing.id is null then
		raise exception 'Could not send that message. Try again.';
	end if;

	update public.vidjo_dm_participants p
	set last_read_at = greatest(p.last_read_at, v_existing.created_at)
	where p.thread_id = p_thread and p.user_id = v_user;

	return query
	select v_existing.id, v_existing.thread_id, v_existing.sender_id,
		v_existing.client_id, v_existing.body, v_existing.image_path,
		v_existing.gif_url, v_existing.created_at;
end;
$$;

drop function if exists public.vidjo_dm_send_direct(uuid, text, uuid);
drop function if exists public.vidjo_dm_send_direct(uuid, text, uuid, text);

create or replace function public.vidjo_dm_send_direct(
	p_friend uuid,
	p_body text,
	p_client_id uuid,
	p_image_path text default null,
	p_gif_url text default null
)
returns table (
	id uuid,
	thread_id uuid,
	sender_id uuid,
	client_id uuid,
	body text,
	image_path text,
	gif_url text,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_client uuid := coalesce(p_client_id, gen_random_uuid());
	v_body text;
	v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
	v_gif text := nullif(btrim(coalesce(p_gif_url, '')), '');
	v_thread uuid;
	v_existing public.vidjo_dm_messages%rowtype;
begin
	if v_user is null then
		raise exception 'Sign in to send messages.';
	end if;

	if not public.vidjo_is_member() then
		raise exception 'Create a VidJo account before sending messages.';
	end if;

	if p_friend is null or p_friend = v_user then
		raise exception 'Choose a friend to message.';
	end if;

	if not exists (select 1 from public.vidjo_profiles where user_id = p_friend) then
		raise exception 'That account no longer exists.';
	end if;

	if not public.vidjo_are_friends(v_user, p_friend) then
		raise exception 'You can only message friends.';
	end if;

	v_thread := public.vidjo_dm_ensure_direct(v_user, p_friend);

	select * into v_existing
	from public.vidjo_dm_messages m
	where m.thread_id = v_thread
		and m.sender_id = v_user
		and m.client_id = v_client
	limit 1;

	if found then
		return query
		select v_existing.id, v_existing.thread_id, v_existing.sender_id,
			v_existing.client_id, v_existing.body, v_existing.image_path,
			v_existing.gif_url, v_existing.created_at;
		return;
	end if;

	v_body := btrim(coalesce(p_body, ''));

	if char_length(v_body) = 0 and v_image is null and v_gif is null then
		raise exception 'Write a message first.';
	end if;

	if v_image is not null and v_gif is not null then
		raise exception 'Send one attachment at a time.';
	end if;

	if v_image is not null then
		if v_image !~ (
			'^' || v_thread::text || '/' || v_user::text
			|| '/[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp|gif)$'
		) then
			raise exception 'That photo could not be sent.';
		end if;

		if not exists (
			select 1
			from storage.objects o
			where o.bucket_id = 'vidjo-dm-images' and o.name = v_image
		) then
			raise exception 'Upload the photo first.';
		end if;
	end if;

	if v_gif is not null and (
		char_length(v_gif) > 500
		or v_gif !~* '^https://(media[0-9]*|i)\.giphy\.com/'
	) then
		raise exception 'That GIF could not be sent.';
	end if;

	v_body := public.vidjo_dm_validate_body(v_body);

	begin
		insert into public.vidjo_dm_messages (thread_id, sender_id, client_id, body, image_path, gif_url)
		values (v_thread, v_user, v_client, v_body, v_image, v_gif)
		returning * into v_existing;
	exception
		when unique_violation then
			select * into v_existing
			from public.vidjo_dm_messages m
			where m.thread_id = v_thread
				and m.sender_id = v_user
				and m.client_id = v_client
			limit 1;
	end;

	if v_existing.id is null then
		raise exception 'Could not send that message. Try again.';
	end if;

	update public.vidjo_dm_participants p
	set last_read_at = greatest(p.last_read_at, v_existing.created_at)
	where p.thread_id = v_thread and p.user_id = v_user;

	return query
	select v_existing.id, v_existing.thread_id, v_existing.sender_id,
		v_existing.client_id, v_existing.body, v_existing.image_path,
		v_existing.gif_url, v_existing.created_at;
end;
$$;

-- Opens (or creates) the direct thread for a friendship without sending
-- anything. Empty direct threads stay out of the inbox until the first message.
create or replace function public.vidjo_dm_open_direct(p_friend uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
begin
	if v_user is null then
		raise exception 'Sign in to send messages.';
	end if;

	if not public.vidjo_is_member() then
		raise exception 'Create a VidJo account before sending messages.';
	end if;

	if p_friend is null or p_friend = v_user then
		raise exception 'Choose a friend to message.';
	end if;

	if not public.vidjo_are_friends(v_user, p_friend) then
		raise exception 'You can only message friends.';
	end if;

	return public.vidjo_dm_ensure_direct(v_user, p_friend);
end;
$$;

create or replace function public.vidjo_dm_create_group(
	p_title text,
	p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_title text := btrim(coalesce(p_title, ''));
	v_ids uuid[];
	v_id uuid;
	v_thread uuid;
begin
	if v_user is null then
		raise exception 'Sign in to create a group.';
	end if;

	if not public.vidjo_is_member() then
		raise exception 'Create a VidJo account first.';
	end if;

	if char_length(v_title) = 0 or char_length(v_title) > 60 then
		raise exception 'Group names must be 1-60 characters.';
	end if;

	select array_agg(distinct t.member_id) into v_ids
	from unnest(p_member_ids) as t(member_id)
	where t.member_id is not null and t.member_id <> v_user;

	if v_ids is null or cardinality(v_ids) = 0 then
		raise exception 'Choose at least one friend.';
	end if;

	if cardinality(v_ids) > 11 then
		raise exception 'Groups can have at most 12 people.';
	end if;

	foreach v_id in array v_ids loop
		if not public.vidjo_are_friends(v_user, v_id) then
			raise exception 'You can only add your friends to a group.';
		end if;
	end loop;

	insert into public.vidjo_dm_threads (kind, title, created_by)
	values ('group', v_title, v_user)
	returning id into v_thread;

	insert into public.vidjo_dm_participants (thread_id, user_id, role, last_read_at)
	values (v_thread, v_user, 'owner', now());

	insert into public.vidjo_dm_participants (thread_id, user_id, role, last_read_at)
	select v_thread, t.member_id, 'member', now()
	from unnest(v_ids) as t(member_id);

	return v_thread;
end;
$$;

create or replace function public.vidjo_dm_add_members(
	p_thread uuid,
	p_member_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_role text;
	v_kind text;
	v_ids uuid[];
	v_id uuid;
	v_count integer;
	v_added integer := 0;
begin
	if v_user is null then
		raise exception 'Sign in first.';
	end if;

	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	select kind into v_kind from public.vidjo_dm_threads where id = p_thread;

	if v_kind <> 'group' then
		raise exception 'Only group chats can add members.';
	end if;

	select role into v_role
	from public.vidjo_dm_participants
	where thread_id = p_thread and user_id = v_user;

	if v_role <> 'owner' then
		raise exception 'Only the group owner can add people.';
	end if;

	select array_agg(distinct t.member_id) into v_ids
	from unnest(p_member_ids) as t(member_id)
	where t.member_id is not null
		and t.member_id <> v_user
		and not exists (
			select 1
			from public.vidjo_dm_participants p
			where p.thread_id = p_thread and p.user_id = t.member_id
		);

	if v_ids is null or cardinality(v_ids) = 0 then
		return 0;
	end if;

	select count(*) into v_count
	from public.vidjo_dm_participants
	where thread_id = p_thread;

	if v_count + cardinality(v_ids) > 12 then
		raise exception 'Groups can have at most 12 people.';
	end if;

	foreach v_id in array v_ids loop
		if not public.vidjo_are_friends(v_user, v_id) then
			raise exception 'You can only add your friends to a group.';
		end if;
	end loop;

	insert into public.vidjo_dm_participants (thread_id, user_id, role, last_read_at)
	select p_thread, t.member_id, 'member', now()
	from unnest(v_ids) as t(member_id);

	get diagnostics v_added = row_count;
	return v_added;
end;
$$;

create or replace function public.vidjo_dm_remove_member(
	p_thread uuid,
	p_user uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_role text;
	v_kind text;
begin
	if v_user is null then
		raise exception 'Sign in first.';
	end if;

	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	select kind into v_kind from public.vidjo_dm_threads where id = p_thread;

	if v_kind <> 'group' then
		raise exception 'Only group chats have members to remove.';
	end if;

	select role into v_role
	from public.vidjo_dm_participants
	where thread_id = p_thread and user_id = v_user;

	if v_role <> 'owner' then
		raise exception 'Only the group owner can remove people.';
	end if;

	if p_user = v_user then
		raise exception 'Use Leave group to remove yourself.';
	end if;

	delete from public.vidjo_dm_participants
	where thread_id = p_thread and user_id = p_user;

	if not found then
		raise exception 'That person is not in this group.';
	end if;
end;
$$;

create or replace function public.vidjo_dm_leave_group(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_role text;
	v_kind text;
	v_next uuid;
begin
	if v_user is null then
		raise exception 'Sign in first.';
	end if;

	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	select kind into v_kind from public.vidjo_dm_threads where id = p_thread;

	if v_kind <> 'group' then
		raise exception 'Direct conversations cannot be left.';
	end if;

	select role into v_role
	from public.vidjo_dm_participants
	where thread_id = p_thread and user_id = v_user;

	if v_role = 'owner' then
		select user_id into v_next
		from public.vidjo_dm_participants
		where thread_id = p_thread and user_id <> v_user
		order by joined_at
		limit 1;

		if v_next is null then
			-- Last person out: remove the thread and everything in it.
			delete from public.vidjo_dm_threads where id = p_thread;
			return;
		end if;

		update public.vidjo_dm_participants
		set role = 'member'
		where thread_id = p_thread and user_id = v_user;

		update public.vidjo_dm_participants
		set role = 'owner'
		where thread_id = p_thread and user_id = v_next;
	end if;

	delete from public.vidjo_dm_participants
	where thread_id = p_thread and user_id = v_user;
end;
$$;

create or replace function public.vidjo_dm_rename_group(
	p_thread uuid,
	p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_role text;
	v_kind text;
	v_title text := btrim(coalesce(p_title, ''));
begin
	if v_user is null then
		raise exception 'Sign in first.';
	end if;

	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	select kind into v_kind from public.vidjo_dm_threads where id = p_thread;

	if v_kind <> 'group' then
		raise exception 'Only group chats can be renamed.';
	end if;

	select role into v_role
	from public.vidjo_dm_participants
	where thread_id = p_thread and user_id = v_user;

	if v_role <> 'owner' then
		raise exception 'Only the group owner can rename it.';
	end if;

	if char_length(v_title) = 0 or char_length(v_title) > 60 then
		raise exception 'Group names must be 1-60 characters.';
	end if;

	update public.vidjo_dm_threads
	set title = v_title
	where id = p_thread;
end;
$$;

-- Photo and GIF messages added columns to this result, and Postgres cannot
-- change a function's return type in place. Drop it first so re-running works.
drop function if exists public.vidjo_dm_inbox();

create or replace function public.vidjo_dm_inbox()
returns table (
	thread_id uuid,
	kind text,
	title text,
	members jsonb,
	last_body text,
	last_image_path text,
	last_gif_url text,
	last_sender uuid,
	last_sender_name text,
	last_at timestamptz,
	unread_count integer,
	can_reply boolean
)
language sql
stable
security definer
set search_path = public
as $$
	select
		t.id,
		t.kind,
		t.title,
		coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', p.user_id,
					'name', coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student'),
					'username', pr.username,
					'avatar', pr.avatar_url,
					'role', p.role
				)
				order by p.joined_at
			)
			from public.vidjo_dm_participants p
			left join public.vidjo_profiles pr on pr.user_id = p.user_id
			where p.thread_id = t.id
		), '[]'::jsonb),
		m.body,
		m.image_path,
		m.gif_url,
		m.sender_id,
		coalesce(nullif(btrim(sp.display_name), ''), sp.username, 'VidJo student'),
		m.created_at,
		coalesce((
			select count(*)::integer
			from public.vidjo_dm_messages x
			where x.thread_id = t.id
				and x.sender_id <> me.user_id
				and x.deleted_at is null
				and x.created_at > me.last_read_at
		), 0),
		case
			when t.kind = 'group' then true
			else public.vidjo_are_friends(
				me.user_id,
				(
					select p2.user_id
					from public.vidjo_dm_participants p2
					where p2.thread_id = t.id and p2.user_id <> me.user_id
					limit 1
				)
			)
		end
	from public.vidjo_dm_threads t
	join public.vidjo_dm_participants me
		on me.thread_id = t.id and me.user_id = auth.uid()
	left join lateral (
		select mm.body, mm.image_path, mm.gif_url, mm.sender_id, mm.created_at
		from public.vidjo_dm_messages mm
		where mm.thread_id = t.id and mm.deleted_at is null
		order by mm.created_at desc, mm.id desc
		limit 1
	) m on true
	left join public.vidjo_profiles sp on sp.user_id = m.sender_id
	where auth.uid() is not null
		and (t.last_message_at is not null or t.kind = 'group')
	order by coalesce(t.last_message_at, t.created_at) desc;
$$;

-- Same reason as `vidjo_dm_inbox`: the result gained image/GIF fields.
drop function if exists public.vidjo_dm_thread(uuid, timestamptz, integer);

create or replace function public.vidjo_dm_thread(
	p_thread uuid,
	p_before timestamptz default now(),
	p_limit integer default 30
)
returns table (
	id uuid,
	thread_id uuid,
	sender_id uuid,
	client_id uuid,
	sender_name text,
	sender_username text,
	sender_avatar text,
	body text,
	image_path text,
	gif_url text,
	created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
begin
	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	return query
	select
		recent.id,
		recent.thread_id,
		recent.sender_id,
		recent.client_id,
		recent.sender_name,
		recent.sender_username,
		recent.sender_avatar,
		recent.body,
		recent.image_path,
		recent.gif_url,
		recent.created_at
	from (
		select
			m.id,
			m.thread_id,
			m.sender_id,
			m.client_id,
			coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student') as sender_name,
			coalesce(pr.username, 'student') as sender_username,
			pr.avatar_url as sender_avatar,
			m.body,
			m.image_path,
			m.gif_url,
			m.created_at
		from public.vidjo_dm_messages m
		left join public.vidjo_profiles pr on pr.user_id = m.sender_id
		where m.thread_id = p_thread
			and m.deleted_at is null
			and m.created_at < coalesce(p_before, now())
		order by m.created_at desc, m.id desc
		limit v_limit
	) recent
	order by recent.created_at asc, recent.id asc;
end;
$$;

create or replace function public.vidjo_dm_thread_members(p_thread uuid)
returns table (
	user_id uuid,
	name text,
	username text,
	avatar text,
	role text,
	joined_at timestamptz,
	is_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
	if not public.vidjo_dm_is_participant(p_thread) then
		raise exception 'Conversation not found.';
	end if;

	return query
	select
		p.user_id,
		coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student'),
		coalesce(pr.username, 'student'),
		pr.avatar_url,
		p.role,
		p.joined_at,
		p.user_id = auth.uid()
	from public.vidjo_dm_participants p
	left join public.vidjo_profiles pr on pr.user_id = p.user_id
	where p.thread_id = p_thread
	order by (p.role = 'owner') desc, p.joined_at asc;
end;
$$;

create or replace function public.vidjo_dm_mark_read(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'Sign in first.';
	end if;

	update public.vidjo_dm_participants
	set last_read_at = greatest(last_read_at, now())
	where thread_id = p_thread and user_id = auth.uid();

	if not found then
		raise exception 'Conversation not found.';
	end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Messaging access control
-- ---------------------------------------------------------------------------

alter table public.vidjo_dm_threads enable row level security;
alter table public.vidjo_dm_participants enable row level security;
alter table public.vidjo_dm_messages enable row level security;

drop policy if exists "vidjo dm threads select" on public.vidjo_dm_threads;
create policy "vidjo dm threads select" on public.vidjo_dm_threads
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_dm_is_participant(id));

drop policy if exists "vidjo dm participants select" on public.vidjo_dm_participants;
create policy "vidjo dm participants select" on public.vidjo_dm_participants
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_dm_is_participant(thread_id));

drop policy if exists "vidjo dm messages select" on public.vidjo_dm_messages;
create policy "vidjo dm messages select" on public.vidjo_dm_messages
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_dm_is_participant(thread_id));

revoke all on public.vidjo_dm_threads from anon;
revoke all on public.vidjo_dm_participants from anon;
revoke all on public.vidjo_dm_messages from anon;

grant select on public.vidjo_dm_threads to authenticated;
grant select on public.vidjo_dm_participants to authenticated;
grant select on public.vidjo_dm_messages to authenticated;

revoke insert, update, delete on public.vidjo_dm_threads from authenticated;
revoke insert, update, delete on public.vidjo_dm_participants from authenticated;
revoke insert, update, delete on public.vidjo_dm_messages from authenticated;

-- Trigger functions are never called directly.
revoke all on function public.vidjo_dm_check_participants() from public;
revoke all on function public.vidjo_dm_touch_thread() from public;
revoke all on function public.vidjo_dm_censor_message() from public;
revoke all on function public.vidjo_dm_check_participants() from anon, authenticated;
revoke all on function public.vidjo_dm_touch_thread() from anon, authenticated;
revoke all on function public.vidjo_dm_censor_message() from anon, authenticated;

-- Helpers used by RLS or by other SECURITY DEFINER functions.
revoke all on function public.vidjo_dm_is_participant(uuid) from public;
revoke all on function public.vidjo_dm_is_participant(uuid) from anon;
grant execute on function public.vidjo_dm_is_participant(uuid) to authenticated;

revoke all on function public.vidjo_dm_can_send(uuid) from public;
revoke all on function public.vidjo_dm_can_send(uuid) from anon;
grant execute on function public.vidjo_dm_can_send(uuid) to authenticated;

revoke all on function public.vidjo_dm_direct_key(uuid, uuid) from public;
revoke all on function public.vidjo_dm_direct_key(uuid, uuid) from anon, authenticated;

revoke all on function public.vidjo_dm_ensure_direct(uuid, uuid) from public;
revoke all on function public.vidjo_dm_ensure_direct(uuid, uuid) from anon, authenticated;

revoke all on function public.vidjo_dm_validate_body(text) from public;
revoke all on function public.vidjo_dm_validate_body(text) from anon, authenticated;

-- Public RPCs.
revoke all on function public.vidjo_dm_send(uuid, text, uuid, text, text) from public;
revoke all on function public.vidjo_dm_send(uuid, text, uuid, text, text) from anon;
grant execute on function public.vidjo_dm_send(uuid, text, uuid, text, text) to authenticated;

revoke all on function public.vidjo_dm_send_direct(uuid, text, uuid, text, text) from public;
revoke all on function public.vidjo_dm_send_direct(uuid, text, uuid, text, text) from anon;
grant execute on function public.vidjo_dm_send_direct(uuid, text, uuid, text, text) to authenticated;

revoke all on function public.vidjo_dm_open_direct(uuid) from public;
revoke all on function public.vidjo_dm_open_direct(uuid) from anon;
grant execute on function public.vidjo_dm_open_direct(uuid) to authenticated;

revoke all on function public.vidjo_dm_create_group(text, uuid[]) from public;
revoke all on function public.vidjo_dm_create_group(text, uuid[]) from anon;
grant execute on function public.vidjo_dm_create_group(text, uuid[]) to authenticated;

revoke all on function public.vidjo_dm_add_members(uuid, uuid[]) from public;
revoke all on function public.vidjo_dm_add_members(uuid, uuid[]) from anon;
grant execute on function public.vidjo_dm_add_members(uuid, uuid[]) to authenticated;

revoke all on function public.vidjo_dm_remove_member(uuid, uuid) from public;
revoke all on function public.vidjo_dm_remove_member(uuid, uuid) from anon;
grant execute on function public.vidjo_dm_remove_member(uuid, uuid) to authenticated;

revoke all on function public.vidjo_dm_leave_group(uuid) from public;
revoke all on function public.vidjo_dm_leave_group(uuid) from anon;
grant execute on function public.vidjo_dm_leave_group(uuid) to authenticated;

revoke all on function public.vidjo_dm_rename_group(uuid, text) from public;
revoke all on function public.vidjo_dm_rename_group(uuid, text) from anon;
grant execute on function public.vidjo_dm_rename_group(uuid, text) to authenticated;

revoke all on function public.vidjo_dm_inbox() from public;
revoke all on function public.vidjo_dm_inbox() from anon;
grant execute on function public.vidjo_dm_inbox() to authenticated;

revoke all on function public.vidjo_dm_thread(uuid, timestamptz, integer) from public;
revoke all on function public.vidjo_dm_thread(uuid, timestamptz, integer) from anon;
grant execute on function public.vidjo_dm_thread(uuid, timestamptz, integer) to authenticated;

revoke all on function public.vidjo_dm_thread_members(uuid) from public;
revoke all on function public.vidjo_dm_thread_members(uuid) from anon;
grant execute on function public.vidjo_dm_thread_members(uuid) to authenticated;

revoke all on function public.vidjo_dm_mark_read(uuid) from public;
revoke all on function public.vidjo_dm_mark_read(uuid) from anon;
grant execute on function public.vidjo_dm_mark_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Message photo storage (PRIVATE bucket, participants only)
-- ---------------------------------------------------------------------------
-- Photos live at `vidjo-dm-images/<thread_id>/<auth.uid()>/<file>`. The first
-- folder lets storage RLS check thread membership; the second proves ownership
-- for updates and deletes. The app displays them through short-lived signed
-- URLs, so a shared link stops working after it expires.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'vidjo-dm-images',
	'vidjo-dm-images',
	false,
	5242880,
	array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
	public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vidjo dm image read" on storage.objects;
drop policy if exists "vidjo dm image upload" on storage.objects;
drop policy if exists "vidjo dm image update" on storage.objects;
drop policy if exists "vidjo dm image delete" on storage.objects;

create policy "vidjo dm image read" on storage.objects
	for select to authenticated
	using (
		bucket_id = 'vidjo-dm-images'
		and public.vidjo_is_member()
		and public.vidjo_dm_is_participant(
			public.vidjo_try_uuid((storage.foldername(name))[1])
		)
	);

create policy "vidjo dm image upload" on storage.objects
	for insert to authenticated
	with check (
		bucket_id = 'vidjo-dm-images'
		and public.vidjo_is_member()
		and public.vidjo_dm_can_send(
			public.vidjo_try_uuid((storage.foldername(name))[1])
		)
		and (storage.foldername(name))[2] = auth.uid()::text
	);

create policy "vidjo dm image update" on storage.objects
	for update to authenticated
	using (
		bucket_id = 'vidjo-dm-images'
		and public.vidjo_is_member()
		and (storage.foldername(name))[2] = auth.uid()::text
	)
	with check (
		bucket_id = 'vidjo-dm-images'
		and public.vidjo_is_member()
		and public.vidjo_dm_can_send(
			public.vidjo_try_uuid((storage.foldername(name))[1])
		)
		and (storage.foldername(name))[2] = auth.uid()::text
	);

create policy "vidjo dm image delete" on storage.objects
	for delete to authenticated
	using (
		bucket_id = 'vidjo-dm-images'
		and public.vidjo_is_member()
		and (storage.foldername(name))[2] = auth.uid()::text
	);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

-- The app subscribes to these tables for live friend requests, comments, and
-- shared pages. `alter publication` is not idempotent, so only add a table when
-- it is not already published.
do $$
declare
	table_name text;
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		return;
	end if;

	foreach table_name in array array[
		'vidjo_entries',
		'vidjo_friends',
		'vidjo_friend_requests',
		'vidjo_comments',
		'vidjo_reactions',
		'vidjo_community_members',
		'vidjo_dm_threads',
		'vidjo_dm_participants',
		'vidjo_dm_messages'
	] loop
		if not exists (
			select 1
			from pg_publication_tables
			where pubname = 'supabase_realtime'
				and schemaname = 'public'
				and tablename = table_name
		) then
			execute format('alter publication supabase_realtime add table public.%I', table_name);
		end if;
	end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privacy-friendly product analytics
-- ---------------------------------------------------------------------------
-- Only aggregate-friendly, non-content facts are stored. Journal text, titles,
-- reflections, bios, names, emails, search terms, IP addresses, user agents,
-- and referrers are never written here. Clients cannot read the table; the
-- admin-only RPC below returns aggregates only.
--
-- Events are inserted through `vidjo_track_event` so the server can enforce an
-- event allowlist, a metadata allowlist, and a per-user rate limit. This keeps a
-- modified client from stuffing journal content or arbitrary text into stats.

create table if not exists public.vidjo_analytics_events (
	id bigint generated always as identity primary key,
	user_id uuid references auth.users(id) on delete set null,
	event text not null,
	route text not null default '',
	meta jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create index if not exists vidjo_analytics_created_idx
	on public.vidjo_analytics_events (created_at desc);
create index if not exists vidjo_analytics_user_created_idx
	on public.vidjo_analytics_events (user_id, created_at desc);
create index if not exists vidjo_analytics_event_created_idx
	on public.vidjo_analytics_events (event, created_at desc);

alter table public.vidjo_analytics_events enable row level security;
-- No policies on purpose: only the SECURITY DEFINER functions below may touch
-- this table, and clients get aggregates rather than raw rows.
revoke all on public.vidjo_analytics_events from anon;
revoke all on public.vidjo_analytics_events from authenticated;

create or replace function public.vidjo_track_event(
	p_event text,
	p_route text default '',
	p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
	safe_meta jsonb;
	recent int;
begin
	-- Unknown or unauthenticated callers are ignored rather than raising: a
	-- blocked analytics beacon must never break the journal.
	if curr_user is null or not public.vidjo_is_member() then
		return;
	end if;

	if p_event is null or p_event not in (
		'session_start',
		'view_changed',
		'entry_saved',
		'video_added',
		'video_removed',
		'video_play_failed',
		'friend_request_sent',
		'friend_request_accepted',
		'friend_request_declined',
		'friend_removed',
		'community_joined',
		'community_left',
		'comment_posted',
		'reaction_added',
		'profile_updated'
	) then
		return;
	end if;

	-- Keep only known, scalar, short metadata. Anything else is dropped before
	-- it reaches the table, so a client bug cannot leak writing or bios.
	select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
	into safe_meta
	from jsonb_each(coalesce(p_meta, '{}'::jsonb))
	where key in (
		'view',
		'privacy',
		'has_video',
		'mood',
		'mode',
		'mime',
		'surface',
		'reason',
		'count'
	)
		and jsonb_typeof(value) in ('string', 'number', 'boolean')
		and length(value::text) <= 80;

	-- Bound the write rate so one account cannot distort the numbers.
	select count(*) into recent
	from public.vidjo_analytics_events
	where user_id = curr_user
		and created_at > now() - interval '1 hour';

	if recent >= 300 then
		return;
	end if;

	insert into public.vidjo_analytics_events (user_id, event, route, meta)
	values (
		curr_user,
		p_event,
		left(coalesce(p_route, ''), 40),
		safe_meta
	);
end;
$$;

revoke all on function public.vidjo_track_event(text, text, jsonb) from public;
revoke all on function public.vidjo_track_event(text, text, jsonb) from anon;
grant execute on function public.vidjo_track_event(text, text, jsonb) to authenticated;

-- Admin dashboard: one call returns counts plus 30-day activity. Aggregates
-- only; the raw event rows are never exposed to the client.
create or replace function public.vidjo_admin_overview(days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	window_days int := greatest(1, least(coalesce(days, 30), 365));
	since timestamptz := now() - make_interval(days => window_days);
	day_start date := current_date - (window_days - 1);
	result jsonb;
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	select jsonb_build_object(
		'window_days', window_days,
		'generated_at', now(),
		'users_total', (select count(*) from public.vidjo_profiles),
		'users_new', (
			select count(*) from public.vidjo_profiles where created_at >= since
		),
		'entries_total', (select count(*) from public.vidjo_entries),
		'entries_shared', (
			select count(*) from public.vidjo_entries
			where privacy in ('friends', 'community') or share_with_friends
		),
		'entries_video', (
			select count(*) from public.vidjo_entries
			where coalesce(video_path, '') <> ''
		),
		'reports_total', (select count(*) from public.vidjo_comment_reports),
		'reports_new', (
			select count(*) from public.vidjo_comment_reports where created_at >= since
		),
		'events_total', (
			select count(*) from public.vidjo_analytics_events where created_at >= since
		),
		'events_today', (
			select count(*) from public.vidjo_analytics_events where created_at >= current_date
		),
		'active_users', (
			select count(distinct user_id)
			from public.vidjo_analytics_events
			where created_at >= since and user_id is not null
		),
		'active_users_today', (
			select count(distinct user_id)
			from public.vidjo_analytics_events
			where created_at >= current_date and user_id is not null
		),
		'daily', (
			select coalesce(
				jsonb_agg(
					jsonb_build_object(
						'day', d.day::date,
						'events', coalesce(e.events, 0),
						'users', coalesce(e.users, 0)
					)
					order by d.day
				),
				'[]'::jsonb
			)
			from generate_series(day_start, current_date, interval '1 day') as d(day)
			left join (
				select
					created_at::date as day,
					count(*) as events,
					count(distinct user_id) as users
				from public.vidjo_analytics_events
				where created_at >= since
				group by 1
			) e on e.day = d.day::date
		),
		'top_events', (
			select coalesce(
				jsonb_agg(
					jsonb_build_object('event', t.event, 'count', t.event_count)
					order by t.event_count desc
				),
				'[]'::jsonb
			)
			from (
				select event, count(*) as event_count
				from public.vidjo_analytics_events
				where created_at >= since
				group by event
				order by count(*) desc
				limit 8
			) t
		)
	) into result;

	return result;
end;
$$;

revoke all on function public.vidjo_admin_overview(int) from public;
revoke all on function public.vidjo_admin_overview(int) from anon;
grant execute on function public.vidjo_admin_overview(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Moderation: warnings, bans, and time-safe journal days
-- ---------------------------------------------------------------------------
-- Warnings are additive: a warning never deletes a page or comment. Bans flip
-- `user_role` to 'banned' but leave every journal row, video, friend, and
-- comment in place. The metadata columns explain a ban to the member.
alter table public.vidjo_profiles add column if not exists ban_reason text;
alter table public.vidjo_profiles add column if not exists banned_at timestamptz;
alter table public.vidjo_profiles add column if not exists banned_by uuid references auth.users(id) on delete set null;

create table if not exists public.vidjo_warnings (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	reason text not null,
	message text not null default '',
	source_type text not null default 'manual',
	source_id text,
	issued_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now(),
	acknowledged_at timestamptz
);

-- A reported comment or a shared page can only generate one warning per source,
-- even if the author edits the text several times.
create unique index if not exists vidjo_warnings_source_idx
	on public.vidjo_warnings (user_id, source_type, source_id)
	where source_id is not null;

create index if not exists vidjo_warnings_user_created_idx
	on public.vidjo_warnings (user_id, created_at desc);

alter table public.vidjo_warnings enable row level security;

drop policy if exists "vidjo warnings select own" on public.vidjo_warnings;
create policy "vidjo warnings select own" on public.vidjo_warnings
	for select to authenticated
	using (auth.uid() = user_id);

drop policy if exists "vidjo warnings select admin" on public.vidjo_warnings;
create policy "vidjo warnings select admin" on public.vidjo_warnings
	for select to authenticated
	using (
		exists (
			select 1 from public.vidjo_profiles
			where user_id = auth.uid() and user_role = 'admin'
		)
	);

revoke all on public.vidjo_warnings from anon;
grant select on public.vidjo_warnings to authenticated;

-- Detect an insult aimed at a person. This is intentionally conservative:
-- second-person wording must sit next to an insult or threat. Private journal
-- text is never scanned; only comments and text the author chose to share.
create or replace function public.vidjo_has_direct_abuse(input text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
	text_value text := lower(coalesce(input, ''));
begin
	if char_length(text_value) < 3 then
		return false;
	end if;

	if text_value ~* '\m(you|youre|you''re|your|u|ur|yourself)\M[^\n]{0,40}\m(idiot|stupid|dumb|moron|loser|worthless|useless|pathetic|ugly|fat|freak|trash|garbage|disgusting|nasty|suck|slut|whore|bitch|bastard|asshole|cunt|retard|faggot|nigger)\M' then
		return true;
	end if;

	if text_value ~* '\m(idiot|stupid|dumb|moron|loser|worthless|useless|pathetic|ugly|fat|freak|trash|garbage|disgusting|nasty|suck|slut|whore|bitch|bastard|asshole|cunt|retard|faggot|nigger)\M[^\n]{0,20}\m(you|u|your|ur)\M' then
		return true;
	end if;

	if text_value ~* '\m(fuck|screw|piss)\M[^\n]{0,10}\m(you|u|off)\M' then
		return true;
	end if;

	if text_value ~* '\m(shut up|nobody likes you|no one likes you|i hate you|kill yourself|go die|drop dead|go to hell)\M' then
		return true;
	end if;

	return false;
end;
$$;

revoke all on function public.vidjo_has_direct_abuse(text) from public;
revoke all on function public.vidjo_has_direct_abuse(text) from anon;
revoke all on function public.vidjo_has_direct_abuse(text) from authenticated;

-- Keep the server mask in sync with src/lib/censor.ts. This runs for comments
-- only. Shared page text is masked when it is displayed, so a private page that
-- was never shared keeps its original words.
create or replace function public.vidjo_censor_text(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
	result text := coalesce(input, '');
	word text;
	words text[] := array[
		'arse', 'ass', 'asshole', 'bastard', 'bitch', 'bullshit', 'crap', 'cunt',
		'damn', 'dick', 'dickhead', 'douche', 'douchebag', 'dumbass', 'faggot',
		'fuck', 'fucked', 'fucker', 'fucking', 'hell', 'idiot', 'jerk', 'moron',
		'motherfucker', 'nigger', 'nigga', 'penis', 'piss', 'prick', 'pussy',
		'retard', 'shit', 'shitty', 'slut', 'tard', 'twat', 'wanker', 'whore'
	];
begin
	foreach word in array words loop
		-- Allow repeated letters ("shiiit") just like the client pattern.
		result := regexp_replace(
			result,
			'\m' || regexp_replace(word, '(.)', '\1+', 'g') || '\M',
			'***',
			'gi'
		);
	end loop;
	return result;
end;
$$;

create or replace function public.vidjo_censor_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	raw_body text := coalesce(new.body, '');
begin
	if public.vidjo_has_direct_abuse(raw_body) then
		insert into public.vidjo_warnings (user_id, reason, message, source_type, source_id)
		values (
			new.author_id,
			'Comment insulted another member',
			'One of your comments was flagged for insulting another member. The comment was kept, but the insulting words are masked. Repeated abuse can lead to a ban.',
			'comment',
			new.id::text
		)
		on conflict do nothing;
	end if;

	new.body := public.vidjo_censor_text(raw_body);
	return new;
end;
$$;

-- Shared pages are scanned when they become visible to friends or a community.
-- The page is never modified or removed; the author only receives a warning.
create or replace function public.vidjo_warn_shared_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	target_user uuid := public.vidjo_try_uuid(new.owner_id);
	text_blob text;
	shared boolean :=
		new.privacy in ('friends', 'community')
		or coalesce(new.share_with_friends, false);
begin
	if target_user is null
		or not exists (select 1 from auth.users where id = target_user) then
		return new;
	end if;

	if not shared then
		return new;
	end if;

	text_blob := concat_ws(E'\n', new.title, new.mind, new.refl);

	if public.vidjo_has_direct_abuse(text_blob) then
		insert into public.vidjo_warnings (user_id, reason, message, source_type, source_id)
		values (
			target_user,
			'Shared page insulted another member',
			'One of your shared pages was flagged for insulting another member. The page was kept, but swear words are hidden from friends and Community. Repeated abuse can lead to a ban.',
			'entry',
			new.owner_id || ':' || new.entry_date::text
		)
		on conflict do nothing;
	end if;

	return new;
end;
$$;

drop trigger if exists vidjo_warn_shared_entry on public.vidjo_entries;
create trigger vidjo_warn_shared_entry
	after insert or update of title, mind, refl, privacy, share_with_friends
	on public.vidjo_entries
	for each row execute function public.vidjo_warn_shared_entry();

-- One VidJo per day means every day up to today, never a future day. This is
-- enforced in the database so a direct API call cannot create tomorrow's page.
--
-- "Today" here is the member's local date, but Postgres runs in UTC. Someone in
-- UTC+10 is already on tomorrow's date while UTC is still on yesterday's, so
-- allow one day of slack. Without it, everyone east of UTC cannot save a page
-- for the first few hours after their local midnight. The app still blocks
-- future pages on the client, so this only widens the API guard by a day.
create or replace function public.vidjo_reject_future_entry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	if new.entry_date > current_date + 1 then
		raise exception 'VidJo pages can only be created for today or an earlier date.'
			using errcode = 'P0001';
	end if;
	return new;
end;
$$;

drop trigger if exists vidjo_reject_future_entry on public.vidjo_entries;
create trigger vidjo_reject_future_entry
	before insert or update of entry_date on public.vidjo_entries
	for each row execute function public.vidjo_reject_future_entry();

revoke all on function public.vidjo_reject_future_entry() from public;
revoke all on function public.vidjo_reject_future_entry() from anon;
revoke all on function public.vidjo_reject_future_entry() from authenticated;

-- Admin-only moderation actions. They validate the caller inside the database,
-- so hiding the buttons in the UI is not the only protection.
create or replace function public.vidjo_admin_warn_user(
	p_user_id uuid,
	p_reason text,
	p_message text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	warning_id uuid;
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	if not exists (select 1 from auth.users where id = p_user_id) then
		raise exception 'That member could not be found.' using errcode = 'P0001';
	end if;

	insert into public.vidjo_warnings (user_id, reason, message, source_type, issued_by)
	values (
		p_user_id,
		coalesce(nullif(trim(p_reason), ''), 'Community guidelines'),
		coalesce(
			nullif(trim(p_message), ''),
			'A moderator warned you about your recent activity. Your journal and posts have not been deleted. Please keep VidJo kind and respectful.'
		),
		'manual',
		auth.uid()
	)
	returning id into warning_id;

	return warning_id;
end;
$$;

revoke all on function public.vidjo_admin_warn_user(uuid, text, text) from public;
revoke all on function public.vidjo_admin_warn_user(uuid, text, text) from anon;
grant execute on function public.vidjo_admin_warn_user(uuid, text, text) to authenticated;

create or replace function public.vidjo_admin_ban_user(p_user_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	if p_user_id = auth.uid() then
		raise exception 'You cannot ban your own admin account.' using errcode = 'P0001';
	end if;

	if exists (
		select 1 from public.vidjo_profiles
		where user_id = p_user_id and user_role = 'admin'
	) then
		raise exception 'Admin accounts cannot be banned.' using errcode = 'P0001';
	end if;

	-- Only the role and ban metadata change. No journal row, comment, friend,
	-- reaction, or video is deleted.
	update public.vidjo_profiles
	set
		user_role = 'banned',
		ban_reason = coalesce(nullif(trim(p_reason), ''), 'Repeated or serious community guideline violations.'),
		banned_at = now(),
		banned_by = auth.uid(),
		updated_at = now()
	where user_id = p_user_id;

	if not found then
		raise exception 'That member could not be found.' using errcode = 'P0001';
	end if;
end;
$$;

revoke all on function public.vidjo_admin_ban_user(uuid, text) from public;
revoke all on function public.vidjo_admin_ban_user(uuid, text) from anon;
grant execute on function public.vidjo_admin_ban_user(uuid, text) to authenticated;

create or replace function public.vidjo_admin_unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	update public.vidjo_profiles
	set
		user_role = 'user',
		ban_reason = null,
		banned_at = null,
		banned_by = null,
		updated_at = now()
	where user_id = p_user_id and user_role <> 'admin';

	if not found then
		raise exception 'That member is not banned.' using errcode = 'P0001';
	end if;
end;
$$;

revoke all on function public.vidjo_admin_unban_user(uuid) from public;
revoke all on function public.vidjo_admin_unban_user(uuid) from anon;
grant execute on function public.vidjo_admin_unban_user(uuid) to authenticated;

-- Status RPC used by the app shell. It is SECURITY DEFINER and does not require
-- `vidjo_is_member()`, so a banned member can still read the reason and sign out.
create or replace function public.vidjo_moderation_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	curr_user uuid := auth.uid();
	result jsonb;
	warning_rows jsonb;
begin
	if curr_user is null then
		return jsonb_build_object(
			'user_role', 'user',
			'ban_reason', null,
			'banned_at', null,
			'warnings', '[]'::jsonb
		);
	end if;

	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'id', w.id,
				'reason', w.reason,
				'message', w.message,
				'source_type', w.source_type,
				'created_at', w.created_at,
				'acknowledged_at', w.acknowledged_at
			)
			order by w.created_at desc
		),
		'[]'::jsonb
	)
	into warning_rows
	from (
		select *
		from public.vidjo_warnings
		where user_id = curr_user
		order by (acknowledged_at is null) desc, created_at desc
		limit 20
	) w;

	select jsonb_build_object(
		'user_role', coalesce(p.user_role, 'user'),
		'ban_reason', p.ban_reason,
		'banned_at', p.banned_at,
		'warnings', warning_rows
	)
	into result
	from (select 1) as seed
	left join public.vidjo_profiles p on p.user_id = curr_user;

	return result;
end;
$$;

revoke all on function public.vidjo_moderation_status() from public;
revoke all on function public.vidjo_moderation_status() from anon;
grant execute on function public.vidjo_moderation_status() to authenticated;

create or replace function public.vidjo_ack_warning(p_warning_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	changed int;
begin
	update public.vidjo_warnings
	set acknowledged_at = now()
	where id = p_warning_id
		and user_id = auth.uid()
		and acknowledged_at is null;

	get diagnostics changed = row_count;
	return changed > 0;
end;
$$;

revoke all on function public.vidjo_ack_warning(uuid) from public;
revoke all on function public.vidjo_ack_warning(uuid) from anon;
grant execute on function public.vidjo_ack_warning(uuid) to authenticated;

-- Add the comment author id so admins can warn/ban directly from a report.
drop function if exists public.vidjo_admin_list_reports(int);
create or replace function public.vidjo_admin_list_reports(max_rows int default 50)
returns table (
	id uuid,
	comment_id uuid,
	reason text,
	created_at timestamptz,
	reporter_name text,
	reported_user text,
	comment_body text,
	reported_user_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	return query
	select
		r.id,
		r.comment_id,
		r.reason,
		r.created_at,
		coalesce(nullif(rp.display_name, ''), rp.username, 'Unknown') as reporter_name,
		coalesce(nullif(ap.display_name, ''), ap.username, 'Unknown') as reported_user,
		c.body as comment_body,
		c.author_id as reported_user_id
	from public.vidjo_comment_reports r
	left join public.vidjo_profiles rp on rp.user_id = r.reporter_id
	left join public.vidjo_comments c on c.id = r.comment_id
	left join public.vidjo_profiles ap on ap.user_id = c.author_id
	order by r.created_at desc
	limit greatest(1, least(coalesce(max_rows, 50), 200));
end;
$$;

revoke all on function public.vidjo_admin_list_reports(int) from public;
grant execute on function public.vidjo_admin_list_reports(int) to authenticated;

-- Realtime warning delivery is optional; RLS limits a member to their own rows.
do $$
begin
	if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
		and not exists (
			select 1
			from pg_publication_tables
			where pubname = 'supabase_realtime'
				and schemaname = 'public'
				and tablename = 'vidjo_warnings'
		) then
		execute 'alter publication supabase_realtime add table public.vidjo_warnings';
	end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal streaks
-- ---------------------------------------------------------------------------
-- Streaks are aggregate only: current run, best run, and how many days have a
-- page. No entry content crosses the wire, and the RPC refuses anyone who is
-- not the owner or an accepted friend.

create or replace function public.vidjo_entry_counts(
	p_saved boolean,
	p_mood text,
	p_title text,
	p_mind text,
	p_refl text,
	p_stickers jsonb,
	p_video_path text,
	p_video_thumb_path text,
	p_included text[],
	p_excluded text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
	select
		coalesce(p_saved, false)
		or p_mood is not null
		or length(btrim(coalesce(p_title, ''))) > 0
		or length(btrim(coalesce(p_mind, ''))) > 0
		or length(btrim(coalesce(p_refl, ''))) > 0
		or coalesce(jsonb_array_length(p_stickers), 0) > 0
		or length(coalesce(p_video_path, '')) > 0
		or length(coalesce(p_video_thumb_path, '')) > 0
		or coalesce(array_length(p_included, 1), 0) > 0
		or coalesce(array_length(p_excluded, 1), 0) > 0;
$$;

-- The signature gained `p_today`; drop the old one so PostgREST never has to
-- choose between overloads.
drop function if exists public.vidjo_streak_for(uuid);

-- `p_today` is the viewer's local date. Postgres runs in UTC, so a member east
-- of UTC would otherwise see a friend's streak as one day behind (and
-- `todayCounted` false) for the first hours after their local midnight. Clamp
-- it to one day either side of UTC so a client cannot ask about an arbitrary
-- date.
create or replace function public.vidjo_streak_for(target uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	viewer uuid := auth.uid();
	today date := greatest(current_date - 1, least(coalesce(p_today, current_date), current_date + 1));
	current_run integer := 0;
	longest_run integer := 0;
	total_days integer := 0;
	today_counted boolean := false;
	cursor_day date;
begin
	if viewer is null or target is null then
		return null;
	end if;

	if viewer <> target and not public.vidjo_are_friends(viewer, target) then
		return null;
	end if;

	with counted as (
		select e.entry_date as day
		from public.vidjo_entries e
		where e.owner_id = target::text
			and e.sample = false
			and e.entry_date <= today
			and public.vidjo_entry_counts(
				e.saved,
				e.mood,
				e.title,
				e.mind,
				e.refl,
				e.stickers,
				e.video_path,
				e.video_thumb_path,
				e.included_friend_ids,
				e.excluded_friend_ids
			)
	), runs as (
		select day, day - (row_number() over (order by day))::integer as grp
		from counted
	), grouped as (
		select count(*)::integer as len, max(day) as last_day
		from runs
		group by grp
	)
	select
		coalesce(sum(len), 0)::integer,
		coalesce(max(len), 0)::integer,
		coalesce(bool_or(last_day = today), false)
	into total_days, longest_run, today_counted
	from grouped;

	-- A streak stays alive through the whole of today. When today is still
	-- blank, count back from yesterday so the number does not drop at midnight
	-- before the member has had a chance to write.
	cursor_day := case when today_counted then today else today - 1 end;

	loop
		exit when current_run >= 3660;
		exit when not exists (
			select 1
			from public.vidjo_entries e
			where e.owner_id = target::text
				and e.entry_date = cursor_day
				and e.sample = false
				and public.vidjo_entry_counts(
					e.saved,
					e.mood,
					e.title,
					e.mind,
					e.refl,
					e.stickers,
					e.video_path,
					e.video_thumb_path,
					e.included_friend_ids,
					e.excluded_friend_ids
				)
		);
		current_run := current_run + 1;
		cursor_day := cursor_day - 1;
	end loop;

	if current_run > longest_run then
		longest_run := current_run;
	end if;

	return jsonb_build_object(
		'current', current_run,
		'longest', longest_run,
		'totalDays', total_days,
		'todayCounted', today_counted
	);
end;
$$;

-- The helper is internal: only the definer-owned RPC needs to run it.
revoke all on function public.vidjo_entry_counts(boolean, text, text, text, text, jsonb, text, text, text[], text[]) from public;
revoke all on function public.vidjo_entry_counts(boolean, text, text, text, text, jsonb, text, text, text[], text[]) from anon;
revoke all on function public.vidjo_entry_counts(boolean, text, text, text, text, jsonb, text, text, text[], text[]) from authenticated;

revoke all on function public.vidjo_streak_for(uuid, date) from public;
revoke all on function public.vidjo_streak_for(uuid, date) from anon;
grant execute on function public.vidjo_streak_for(uuid, date) to authenticated;

-- Moderators can pull a page out of the community feed. RLS only lets a member
-- update their own rows, so this SECURITY DEFINER function checks the role and
-- unshares the row without touching the author's journal content.
drop function if exists public.vidjo_admin_unshare_post(text, date);
create or replace function public.vidjo_admin_unshare_post(
	p_owner_id text,
	p_entry_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
	if not exists (
		select 1 from public.vidjo_profiles
		where user_id = auth.uid() and user_role = 'admin'
	) then
		raise exception 'Admin access required.' using errcode = '42501';
	end if;

	update public.vidjo_entries
	   set privacy = 'private',
	       community_slug = null,
	       share_with_friends = false
	 where owner_id = p_owner_id
	   and entry_date = p_entry_date
	   and privacy = 'community';

	return found;
end;
$$;

revoke all on function public.vidjo_admin_unshare_post(text, date) from public;
revoke all on function public.vidjo_admin_unshare_post(text, date) from anon;
grant execute on function public.vidjo_admin_unshare_post(text, date) to authenticated;

notify pgrst, 'reload schema';
