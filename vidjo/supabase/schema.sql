-- VidJo Journal — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- It is safe to re-run: tables, policies, triggers, and the bucket are upserted.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Registered members
-- ---------------------------------------------------------------------------
-- A VidJo member is an account created through the email/password signup flow.
-- `auth.users.raw_app_meta_data` is server-controlled: a signed-in user cannot
-- edit it with `updateUser()`. At insert time we stamp email signups with
-- `vidjo_registered = true`. Accounts auto-created by an OAuth provider (for
-- example, the first Google sign-in) never get the stamp, so they cannot reach
-- journal data even if they later add an email identity or password.
--
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
	if new.raw_app_meta_data->>'provider' = 'email' then
		new.raw_app_meta_data :=
			coalesce(new.raw_app_meta_data, '{}'::jsonb)
			|| jsonb_build_object('vidjo_registered', true);
	end if;
	return new;
end;
$$;

drop trigger if exists vidjo_mark_registered_user on auth.users;
create trigger vidjo_mark_registered_user
	before insert on auth.users
	for each row execute function public.vidjo_mark_registered_user();

-- Backfill accounts that registered with email before this trigger existed.
update auth.users
set raw_app_meta_data =
	coalesce(raw_app_meta_data, '{}'::jsonb)
	|| jsonb_build_object('vidjo_registered', true)
where raw_app_meta_data->>'provider' = 'email'
	and raw_app_meta_data->>'vidjo_registered' is distinct from 'true';

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
			and u.raw_app_meta_data->>'vidjo_registered' = 'true'
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
	video_url text,
	video_name text,
	updated_at timestamptz not null default now(),
	primary key (owner_id, entry_date)
);

alter table public.vidjo_entries add column if not exists video_path text;

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
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

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

-- Users can update their own profile
drop policy if exists "vidjo profiles update own" on public.vidjo_profiles;
create policy "vidjo profiles update own" on public.vidjo_profiles
	for update to authenticated
	using (public.vidjo_is_member() and auth.uid() = user_id)
	with check (public.vidjo_is_member() and auth.uid() = user_id);

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

	insert into public.vidjo_profiles (user_id, username, display_name, avatar_url)
	values (
		new.id,
		candidate,
		display,
		coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', null)
	)
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

-- Backfill existing users into vidjo_profiles
insert into public.vidjo_profiles (user_id, username, display_name, avatar_url)
select
	u.id,
	coalesce(nullif(trim(u.raw_user_meta_data->>'username'), ''), 'user_' || substr(u.id::text, 1, 8)),
	coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'username'), ''), 'Friend'),
	coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', null)
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
				where (e.video_path = storage.objects.name or storage.objects.name like '%' || e.video_path)
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
-- Google/social sign-in is for existing accounts only
-- ---------------------------------------------------------------------------

create or replace function public.hook_reject_social_signups(event jsonb)
returns jsonb
language plpgsql
as $$
declare
	provider text := coalesce(event->'user'->'app_metadata'->>'provider', '');
begin
	if provider <> 'email' then
		return jsonb_build_object(
			'error', jsonb_build_object(
				'message', 'Create your VidJo account with email and password first. Google sign-in only works after your account exists.',
				'http_code', 403
			)
		);
	end if;

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

-- Backfill friend codes for existing profiles
update public.vidjo_profiles
set friend_code = 'VJ-' || upper(substr(md5(user_id::text), 1, 6))
where friend_code is null;

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
create policy "vidjo friends insert" on public.vidjo_friends
	for insert to authenticated
	with check (public.vidjo_is_member() and auth.uid() = user_id);

drop policy if exists "vidjo friends delete" on public.vidjo_friends;
create policy "vidjo friends delete" on public.vidjo_friends
	for delete to authenticated
	using (public.vidjo_is_member() and auth.uid() = user_id);

revoke all on public.vidjo_friends from anon;
grant select, insert, delete on public.vidjo_friends to authenticated;

create or replace function public.add_friend_by_code(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	target_profile record;
	curr_user uuid := auth.uid();
begin
	if curr_user is null then
		return jsonb_build_object('success', false, 'message', 'Sign in to add friends.');
	end if;

	select * into target_profile
	from public.vidjo_profiles
	where upper(friend_code) = upper(trim(code));

	if not found then
		return jsonb_build_object('success', false, 'message', 'Friend code not found. Check with your friend!');
	end if;

	if target_profile.user_id = curr_user then
		return jsonb_build_object('success', false, 'message', 'You cannot add yourself as a friend.');
	end if;

	-- Mutual friendship
	insert into public.vidjo_friends (user_id, friend_id, status)
	values (curr_user, target_profile.user_id, 'accepted')
	on conflict (user_id, friend_id) do nothing;

	insert into public.vidjo_friends (user_id, friend_id, status)
	values (target_profile.user_id, curr_user, 'accepted')
	on conflict (user_id, friend_id) do nothing;

	return jsonb_build_object(
		'success', true,
		'message', 'Added ' || target_profile.display_name || ' to your friends!',
		'friend', jsonb_build_object(
			'id', target_profile.user_id,
			'username', target_profile.username,
			'displayName', target_profile.display_name,
			'avatarUrl', target_profile.avatar_url,
			'bio', target_profile.bio,
			'friendCode', target_profile.friend_code
		)
	);
end;
$$;

revoke all on function public.add_friend_by_code(text) from public;
grant execute on function public.add_friend_by_code(text) to authenticated;
