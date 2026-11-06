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
	excluded_friend_ids text[] not null default '{}',
	included_friend_ids text[] not null default '{}',
	share_with_friends boolean not null default false,
	video_url text,
	video_name text,
	updated_at timestamptz not null default now(),
	primary key (owner_id, entry_date)
);

alter table public.vidjo_entries add column if not exists video_path text;
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
alter table public.vidjo_profiles add column if not exists banner_url text;
alter table public.vidjo_profiles add column if not exists user_role text not null default 'user';

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

-- Trigger to automatically create a profile row when a new user registers
create or replace function public.vidjo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	raw_user text := coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'user_name', '');
	clean_user text := trim(raw_user);
	display text := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'display_name', clean_user);
	candidate text := clean_user;
	counter integer := 1;
begin
	if candidate = '' then
		candidate := 'user_' || substr(new.id::text, 1, 8);
	end if;

	-- If username candidate conflicts, append a suffix
	while exists (select 1 from public.vidjo_profiles where lower(username) = lower(candidate) and user_id <> new.id) loop
		candidate := clean_user || counter::text;
		counter := counter + 1;
	end loop;

	if display = '' then
		display := candidate;
	end if;

	insert into public.vidjo_profiles (user_id, username, display_name, avatar_url, banner_url, user_role)
	values (
		new.id,
		candidate,
		display,
		coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', null),
		coalesce(new.raw_user_meta_data->>'banner_url', null),
		'user'
	)
	on conflict (user_id) do update set
		username = excluded.username,
		display_name = excluded.display_name,
		banner_url = excluded.banner_url,
		updated_at = now();

	return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
	after insert on auth.users
	for each row execute function public.vidjo_handle_new_user();

-- Backfill existing users into vidjo_profiles
insert into public.vidjo_profiles (user_id, username, display_name, avatar_url, banner_url, user_role)
select
	u.id,
	coalesce(nullif(trim(u.raw_user_meta_data->>'username'), ''), 'user_' || substr(u.id::text, 1, 8)),
	coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'username'), ''), 'Friend'),
	coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', null),
	coalesce(u.raw_user_meta_data->>'banner_url', null),
	'user'
from auth.users u
where u.raw_app_meta_data->>'vidjo_registered' = 'true'
on conflict (user_id) do nothing;

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
	array['video/webm', 'video/mp4', 'video/quicktime', 'video/x-matroska']
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
create policy "vidjo video read" on storage.objects
	for select to authenticated
	using (
		bucket_id = 'vidjo-videos'
		and public.vidjo_is_member()
		and (
			(storage.foldername(name))[1] = auth.uid()::text
			or exists (
				select 1 from public.vidjo_entries e
				where e.video_path = storage.objects.name
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

alter table public.vidjo_comments add column if not exists context text not null default 'friends';

revoke all on public.vidjo_comments from anon;
grant select, insert, delete on public.vidjo_comments to authenticated;

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
		'damn', 'dick', 'dickhead', 'dumbass', 'faggot', 'hell', 'idiot', 'jerk',
		'moron', 'nigger', 'nigga', 'penis', 'piss', 'prick', 'pussy', 'shit',
		'slut', 'tard', 'twat', 'wanker'
	];
begin
	foreach word in array words loop
		result := regexp_replace(result, '\m' || word || '\M', '***', 'gi');
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
create or replace function public.vidjo_admin_list_reports(max_rows int default 50)
returns table (
	id uuid,
	comment_id uuid,
	reason text,
	created_at timestamptz,
	reporter_name text,
	reported_user text,
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

	return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.vidjo_delete_account() from public;
grant execute on function public.vidjo_delete_account() to authenticated;

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
		'vidjo_community_members'
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
