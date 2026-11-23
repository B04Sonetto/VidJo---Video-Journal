-- Multiple journal pages per local date and server-enforced daily quotas.
-- Run after schema.sql, fix-community-features.sql, and fix-friend-page-seen.sql.
-- Existing pages retain their content and receive stable IDs.

alter table public.vidjo_entries
	add column if not exists id text;

update public.vidjo_entries
set id = gen_random_uuid()::text
where id is null;

alter table public.vidjo_entries
	alter column id set default gen_random_uuid()::text,
	alter column id set not null;

alter table public.vidjo_entries
	add column if not exists created_at timestamptz;

update public.vidjo_entries
set created_at = entry_date::timestamp at time zone 'UTC'
where created_at is null;

alter table public.vidjo_entries
	alter column created_at set default now(),
	alter column created_at set not null;

do $$
declare
	pk_name text;
begin
	select conname into pk_name
	from pg_constraint
	where conrelid = 'public.vidjo_entries'::regclass
		and contype = 'p';
	if pk_name is not null then
		execute format('alter table public.vidjo_entries drop constraint %I', pk_name);
	end if;
end;
$$;

alter table public.vidjo_entries
	add constraint vidjo_entries_pkey primary key (id);

create index if not exists vidjo_entries_owner_date_idx
	on public.vidjo_entries (owner_id, entry_date, created_at);

-- A member's chosen IANA timezone is stored server-side so requests cannot
-- switch timezone on every insert to reset their daily quota.
create table if not exists public.vidjo_user_timezones (
	user_id uuid primary key references auth.users(id) on delete cascade,
	timezone text not null,
	updated_at timestamptz not null default now()
);

alter table public.vidjo_user_timezones enable row level security;
revoke all on public.vidjo_user_timezones from public, anon, authenticated;

create table if not exists public.vidjo_community_share_events (
	entry_id text primary key references public.vidjo_entries(id) on delete cascade,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now()
);

create index if not exists vidjo_community_share_events_owner_created_idx
	on public.vidjo_community_share_events (owner_id, created_at desc);

alter table public.vidjo_community_share_events enable row level security;
revoke all on public.vidjo_community_share_events from public, anon, authenticated;

create or replace function public.vidjo_set_local_timezone(p_timezone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
	current_zone text;
begin
	if auth.uid() is null or not public.vidjo_is_member() then
		raise exception 'Sign in to set your timezone.' using errcode = '42501';
	end if;
	if not exists (select 1 from pg_timezone_names where name = p_timezone) then
		raise exception 'Invalid timezone.';
	end if;

	insert into public.vidjo_user_timezones (user_id, timezone)
	values (auth.uid(), p_timezone)
	on conflict (user_id) do nothing;

	select timezone into current_zone
	from public.vidjo_user_timezones
	where user_id = auth.uid()
	for update;

	if current_zone <> p_timezone then
		update public.vidjo_user_timezones
		set timezone = p_timezone, updated_at = now()
		where user_id = auth.uid()
			and updated_at < now() - interval '30 days';
		select timezone into current_zone
		from public.vidjo_user_timezones
		where user_id = auth.uid();
	end if;

	return current_zone;
end;
$$;

create or replace function public.vidjo_daily_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	zone text;
	local_today date;
	day_start timestamptz;
	day_end timestamptz;
	page_count integer;
	share_count integer;
begin
	if auth.uid() is null or not public.vidjo_is_member() then
		raise exception 'Sign in to view daily limits.' using errcode = '42501';
	end if;
	select timezone into zone
	from public.vidjo_user_timezones
	where user_id = auth.uid();
	zone := coalesce(zone, 'UTC');
	local_today := (now() at time zone zone)::date;
	day_start := local_today::timestamp at time zone zone;
	day_end := (local_today + 1)::timestamp at time zone zone;

	select count(*)::integer into page_count
	from public.vidjo_entries
	where owner_id = auth.uid()::text
		and created_at >= day_start
		and created_at < day_end;

	select count(*)::integer into share_count
	from public.vidjo_community_share_events
	where owner_id = auth.uid()
		and created_at >= day_start
		and created_at < day_end;

	return jsonb_build_object('pages', page_count, 'community_shares', share_count);
end;
$$;

-- Existing shares made today count toward the first post-migration quota check.
insert into public.vidjo_community_share_events (entry_id, owner_id, created_at)
select e.id, public.vidjo_try_uuid(e.owner_id), e.created_at
from public.vidjo_entries e
left join public.vidjo_user_timezones z
	on z.user_id = public.vidjo_try_uuid(e.owner_id)
where e.privacy = 'community'
	and public.vidjo_try_uuid(e.owner_id) is not null
	and e.created_at >= (
		(now() at time zone coalesce(z.timezone, 'UTC'))::date::timestamp
		at time zone coalesce(z.timezone, 'UTC')
	)
	and e.created_at < (
		((now() at time zone coalesce(z.timezone, 'UTC'))::date + 1)::timestamp
		at time zone coalesce(z.timezone, 'UTC')
	)
on conflict (entry_id) do nothing;

create or replace function public.vidjo_enforce_daily_page_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	zone text;
	local_today date;
	day_start timestamptz;
	day_end timestamptz;
	created_count integer;
	existing_created_at timestamptz;
begin
	if current_setting('vidjo.claiming_entries', true) = 'on' then
		return new;
	end if;
	if tg_op = 'UPDATE' then
		new.created_at := old.created_at;
		return new;
	end if;

	perform pg_advisory_xact_lock(hashtextextended(new.owner_id, 0));
	select created_at into existing_created_at
	from public.vidjo_entries
	where id = new.id
		and owner_id = new.owner_id;
	if existing_created_at is not null then
		new.created_at := existing_created_at;
		return new;
	end if;

	zone := 'UTC';
	if public.vidjo_try_uuid(new.owner_id) is not null then
		select timezone into zone
		from public.vidjo_user_timezones
		where user_id = public.vidjo_try_uuid(new.owner_id);
	end if;
	zone := coalesce(zone, 'UTC');
	new.created_at := now();
	local_today := (new.created_at at time zone zone)::date;
	day_start := local_today::timestamp at time zone zone;
	day_end := (local_today + 1)::timestamp at time zone zone;

	select count(*)::integer into created_count
	from public.vidjo_entries
	where owner_id = new.owner_id
		and created_at >= day_start
		and created_at < day_end;
	if created_count >= 3 then
		raise exception 'Daily page limit reached. You can create up to 3 pages each day.'
			using errcode = 'P0001';
	end if;
	return new;
end;
$$;

drop trigger if exists vidjo_daily_page_limit on public.vidjo_entries;
create trigger vidjo_daily_page_limit
	before insert or update on public.vidjo_entries
	for each row execute function public.vidjo_enforce_daily_page_limit();

create or replace function public.vidjo_enforce_daily_community_share_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	zone text;
	local_today date;
	day_start timestamptz;
	day_end timestamptz;
	share_count integer;
begin
	if current_setting('vidjo.claiming_entries', true) = 'on' then
		return new;
	end if;
	if tg_op = 'UPDATE' then
		if new.privacy <> 'community' or old.privacy = 'community' then
			return new;
		end if;
	elsif new.privacy <> 'community' then
		return new;
	end if;

	perform pg_advisory_xact_lock(hashtextextended(new.owner_id, 0));
	if exists (
		select 1 from public.vidjo_community_share_events
		where entry_id = new.id
	) then
		return new;
	end if;

	zone := 'UTC';
	if public.vidjo_try_uuid(new.owner_id) is not null then
		select timezone into zone
		from public.vidjo_user_timezones
		where user_id = public.vidjo_try_uuid(new.owner_id);
	end if;
	zone := coalesce(zone, 'UTC');
	local_today := (now() at time zone zone)::date;
	day_start := local_today::timestamp at time zone zone;
	day_end := (local_today + 1)::timestamp at time zone zone;

	select count(*)::integer into share_count
	from public.vidjo_community_share_events
	where owner_id = public.vidjo_try_uuid(new.owner_id)
		and created_at >= day_start
		and created_at < day_end;
	if share_count >= 3 then
		raise exception 'Daily Community share limit reached. You can share up to 3 pages each day.'
			using errcode = 'P0001';
	end if;

	return new;
end;
$$;

drop trigger if exists vidjo_daily_community_share_limit on public.vidjo_entries;
create trigger vidjo_daily_community_share_limit
	before insert or update of privacy on public.vidjo_entries
	for each row execute function public.vidjo_enforce_daily_community_share_limit();

create or replace function public.vidjo_record_community_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if current_setting('vidjo.claiming_entries', true) = 'on' then
		return new;
	end if;
	if tg_op = 'INSERT' then
		if new.privacy <> 'community' then
			return new;
		end if;
	elsif new.privacy <> 'community' or old.privacy = 'community' then
		return new;
	end if;
	if new.privacy = 'community' then
		insert into public.vidjo_community_share_events (entry_id, owner_id)
		values (new.id, public.vidjo_try_uuid(new.owner_id))
		on conflict (entry_id) do nothing;
	end if;
	return new;
end;
$$;

drop trigger if exists vidjo_record_community_share on public.vidjo_entries;
create trigger vidjo_record_community_share
	after insert or update of privacy on public.vidjo_entries
	for each row execute function public.vidjo_record_community_share();

-- Preserve legacy device-claim behavior while copying stable page IDs.
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
	if auth.uid() is null or not public.vidjo_is_member() then
		raise exception 'You must be signed in to claim entries.';
	end if;
	if device_id is null or device_id = '' or device_id = uid_text
		or exists (select 1 from auth.users u where u.id::text = device_id) then
		return 0;
	end if;

	perform set_config('vidjo.claiming_entries', 'on', true);
	insert into public.vidjo_entries (
		id, owner_id, entry_date, mood, title, mind, refl, privacy, community_slug,
		stickers, saved, sample, video_path, video_thumb_path, excluded_friend_ids,
		included_friend_ids, share_with_friends, video_url, video_name, song,
		created_at, updated_at
	)
	select
		id, uid_text, entry_date, mood, title, mind, refl, privacy, community_slug,
		stickers, saved, sample, video_path, video_thumb_path, excluded_friend_ids,
		included_friend_ids, share_with_friends, video_url, video_name, song,
		created_at, updated_at
	from public.vidjo_entries
	where owner_id = device_id
	on conflict (id) do nothing;

	get diagnostics moved = row_count;
	delete from public.vidjo_entries where owner_id = device_id;
	return moved;
end;
$$;

alter table public.vidjo_friend_page_seen
	add column if not exists post_entry_id text;
update public.vidjo_friend_page_seen s
set post_entry_id = (
	select e.id
	from public.vidjo_entries e
	where e.owner_id = s.owner_id::text
		and e.entry_date = s.page_date
	order by e.created_at desc
	limit 1
)
where s.post_entry_id is null;
delete from public.vidjo_friend_page_seen where post_entry_id is null;
alter table public.vidjo_friend_page_seen
	alter column post_entry_id set not null;
alter table public.vidjo_friend_page_seen
	drop constraint if exists vidjo_friend_page_seen_pkey;
alter table public.vidjo_friend_page_seen
	add constraint vidjo_friend_page_seen_pkey
	primary key (user_id, owner_id, post_entry_id);
alter table public.vidjo_friend_page_seen
	drop constraint if exists vidjo_friend_page_seen_entry_fk;
alter table public.vidjo_friend_page_seen
	add constraint vidjo_friend_page_seen_entry_fk
	foreign key (post_entry_id) references public.vidjo_entries(id) on delete cascade;

create or replace function public.vidjo_friend_pages_mark_seen(p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'Not signed in.';
	end if;

	insert into public.vidjo_friend_page_seen (user_id, owner_id, page_date, post_entry_id)
	select distinct
		auth.uid(),
		public.vidjo_try_uuid(entry->>'ownerId'),
		page.entry_date,
		page.id
	from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry
	cross join lateral (
		select e.id, e.entry_date
		from public.vidjo_entries e
		where e.owner_id = entry->>'ownerId'
			and (
				(nullif(entry->>'entryId', '') is not null and e.id = entry->>'entryId')
				or (
					nullif(entry->>'entryId', '') is null
					and (entry->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
					and e.entry_date = (entry->>'date')::date
				)
			)
		order by e.created_at desc
		limit 1
	) page
	where public.vidjo_try_uuid(entry->>'ownerId') is not null
	on conflict (user_id, owner_id, post_entry_id) do nothing;
end;
$$;

revoke all on function public.vidjo_friend_pages_mark_seen(jsonb) from public, anon;
grant execute on function public.vidjo_friend_pages_mark_seen(jsonb) to authenticated;

alter table public.vidjo_reactions
	add column if not exists post_entry_id text;
alter table public.vidjo_comments
	add column if not exists post_entry_id text;

update public.vidjo_reactions r
set post_entry_id = e.id
from public.vidjo_entries e
where r.post_entry_id is null
	and e.owner_id = r.post_owner_id::text
	and e.entry_date = r.post_date;

update public.vidjo_comments c
set post_entry_id = e.id
from public.vidjo_entries e
where c.post_entry_id is null
	and e.owner_id = c.post_owner_id::text
	and e.entry_date = c.post_date;

delete from public.vidjo_reactions where post_entry_id is null;
delete from public.vidjo_comments where post_entry_id is null;

alter table public.vidjo_reactions
	alter column post_entry_id set not null;
alter table public.vidjo_comments
	alter column post_entry_id set not null;

alter table public.vidjo_reactions
	drop constraint if exists vidjo_reactions_entry_fk;
alter table public.vidjo_reactions
	add constraint vidjo_reactions_entry_fk
	foreign key (post_entry_id) references public.vidjo_entries(id) on delete cascade;
alter table public.vidjo_comments
	drop constraint if exists vidjo_comments_entry_fk;
alter table public.vidjo_comments
	add constraint vidjo_comments_entry_fk
	foreign key (post_entry_id) references public.vidjo_entries(id) on delete cascade;

alter table public.vidjo_reactions drop constraint if exists vidjo_reactions_pkey;
alter table public.vidjo_reactions
	add constraint vidjo_reactions_pkey
	primary key (post_owner_id, post_entry_id, user_id, reaction);

create index if not exists vidjo_comments_entry_idx
	on public.vidjo_comments (post_owner_id, post_entry_id, context, created_at);

create or replace function public.vidjo_can_view_entry(owner uuid, entry_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select auth.uid() is not null and exists (
		select 1
		from public.vidjo_entries e
		where e.id = entry_id
			and e.owner_id = owner::text
			and (
				auth.uid() = owner
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

drop policy if exists "vidjo reactions select" on public.vidjo_reactions;
create policy "vidjo reactions select" on public.vidjo_reactions
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_can_view_entry(post_owner_id, post_entry_id));
drop policy if exists "vidjo reactions insert own" on public.vidjo_reactions;
create policy "vidjo reactions insert own" on public.vidjo_reactions
	for insert to authenticated
	with check (
		public.vidjo_is_member()
		and auth.uid() = user_id
		and public.vidjo_can_view_entry(post_owner_id, post_entry_id)
	);

drop policy if exists "vidjo comments select" on public.vidjo_comments;
create policy "vidjo comments select" on public.vidjo_comments
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_can_view_entry(post_owner_id, post_entry_id));
drop policy if exists "vidjo comments insert own" on public.vidjo_comments;
create policy "vidjo comments insert own" on public.vidjo_comments
	for insert to authenticated
	with check (
		public.vidjo_is_member()
		and auth.uid() = author_id
		and public.vidjo_can_view_entry(post_owner_id, post_entry_id)
	);
drop policy if exists "vidjo comments update own" on public.vidjo_comments;
create policy "vidjo comments update own" on public.vidjo_comments
	for update to authenticated
	using (public.vidjo_is_member() and auth.uid() = author_id)
	with check (
		public.vidjo_is_member()
		and auth.uid() = author_id
		and public.vidjo_can_view_entry(post_owner_id, post_entry_id)
	);
drop policy if exists "vidjo comments delete own" on public.vidjo_comments;
create policy "vidjo comments delete own" on public.vidjo_comments
	for delete to authenticated
	using (
		public.vidjo_is_member()
		and auth.uid() = author_id
		and public.vidjo_can_view_entry(post_owner_id, post_entry_id)
	);

drop policy if exists "vidjo comment reactions select" on public.vidjo_comment_reactions;
create policy "vidjo comment reactions select" on public.vidjo_comment_reactions
	for select to authenticated
	using (
		public.vidjo_is_member()
		and exists (
			select 1 from public.vidjo_comments c
			where c.id = comment_id
				and public.vidjo_can_view_entry(c.post_owner_id, c.post_entry_id)
		)
	);
drop policy if exists "vidjo comment reactions insert own" on public.vidjo_comment_reactions;
create policy "vidjo comment reactions insert own" on public.vidjo_comment_reactions
	for insert to authenticated
	with check (
		public.vidjo_is_member()
		and auth.uid() = user_id
		and exists (
			select 1 from public.vidjo_comments c
			where c.id = comment_id
				and public.vidjo_can_view_entry(c.post_owner_id, c.post_entry_id)
		)
	);

-- A short comment cooldown complements the existing per-minute spam limit.
create or replace function public.vidjo_enforce_write_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	recent integer;
begin
	if tg_table_name = 'vidjo_comments' then
		perform pg_advisory_xact_lock(hashtextextended(new.author_id::text, 1));
		select count(*) into recent
		from public.vidjo_comments
		where author_id = new.author_id
			and created_at > now() - interval '5 seconds';
		if recent >= 1 then
			raise exception 'Please wait a few seconds before commenting again.'
				using errcode = 'P0001';
		end if;
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

-- Update social references on moderator pins, if the community migration exists.
do $$
begin
	if to_regclass('public.vidjo_community_pinned_posts') is not null then
		alter table public.vidjo_community_pinned_posts
			add column if not exists post_entry_id text;
		update public.vidjo_community_pinned_posts p
		set post_entry_id = e.id
		from public.vidjo_entries e
		where p.post_entry_id is null
			and e.owner_id = p.post_owner_id::text
			and e.entry_date = p.post_date;
		delete from public.vidjo_community_pinned_posts
		where post_entry_id is null;
		alter table public.vidjo_community_pinned_posts
			alter column post_entry_id set not null;
		alter table public.vidjo_community_pinned_posts
			drop constraint if exists vidjo_community_pinned_posts_pkey;
		alter table public.vidjo_community_pinned_posts
			drop constraint if exists vidjo_community_pinned_posts_entry_fk;
		alter table public.vidjo_community_pinned_posts
			add constraint vidjo_community_pinned_posts_pkey
			primary key (community_slug, post_owner_id, post_entry_id);
		alter table public.vidjo_community_pinned_posts
			add constraint vidjo_community_pinned_posts_entry_fk
			foreign key (post_entry_id) references public.vidjo_entries(id) on delete cascade;
	end if;
end;
$$;

-- Reports also need a page identity so two pages from one date do not collide.
alter table public.vidjo_community_reports
	add column if not exists post_entry_id text;
update public.vidjo_community_reports r
set post_entry_id = e.id
from public.vidjo_entries e
where r.post_entry_id is null
	and e.owner_id = r.post_owner_id::text
	and e.entry_date = r.post_date;
delete from public.vidjo_community_reports where post_entry_id is null;
alter table public.vidjo_community_reports
	alter column post_entry_id set not null;
do $$
declare
	constraint_name text;
begin
	for constraint_name in
		select conname
		from pg_constraint
		where conrelid = 'public.vidjo_community_reports'::regclass
			and contype = 'u'
			and pg_get_constraintdef(oid) like '%post_date%'
	loop
		execute format(
			'alter table public.vidjo_community_reports drop constraint %I',
			constraint_name
		);
	end loop;
end;
$$;
alter table public.vidjo_community_reports
	drop constraint if exists vidjo_community_reports_entry_fk;
alter table public.vidjo_community_reports
	add constraint vidjo_community_reports_entry_fk
	foreign key (post_entry_id) references public.vidjo_entries(id) on delete cascade;
alter table public.vidjo_community_reports
	drop constraint if exists vidjo_community_reports_page_unique;
alter table public.vidjo_community_reports
	add constraint vidjo_community_reports_page_unique
	unique (community_slug, post_owner_id, post_entry_id, reporter_id);

create or replace function public.vidjo_community_unshare_entry(
	p_slug text,
	p_post_owner_id uuid,
	p_post_entry_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
	if not public.vidjo_community_can_moderate(p_slug) then
		raise exception 'Only community moderators can remove pages.';
	end if;
	update public.vidjo_entries e
	set privacy = case when e.share_with_friends then 'friends' else 'private' end,
		share_with_friends = false,
		community_slug = null,
		updated_at = now()
	where e.id = p_post_entry_id
		and e.owner_id = p_post_owner_id::text
		and e.privacy = 'community'
		and e.community_slug = p_slug;
	return found;
end;
$$;

create or replace function public.vidjo_community_toggle_pin_entry(
	p_slug text,
	p_post_owner_id uuid,
	p_post_entry_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	actor uuid := auth.uid();
	pinned boolean;
	page_date date;
begin
	if not public.vidjo_community_can_moderate(p_slug) then
		raise exception 'Only community moderators can pin posts.';
	end if;
	select entry_date into page_date
	from public.vidjo_entries
	where id = p_post_entry_id
		and owner_id = p_post_owner_id::text
		and privacy = 'community'
		and community_slug = p_slug;
	if page_date is null then
		raise exception 'That page is no longer shared in this community.';
	end if;
	if exists (
		select 1 from public.vidjo_community_pinned_posts
		where community_slug = p_slug and post_owner_id = p_post_owner_id
			and post_entry_id = p_post_entry_id
	) then
		delete from public.vidjo_community_pinned_posts
		where community_slug = p_slug and post_owner_id = p_post_owner_id
			and post_entry_id = p_post_entry_id;
		pinned := false;
	else
		insert into public.vidjo_community_pinned_posts
			(community_slug, post_owner_id, post_date, post_entry_id, pinned_by)
		values (p_slug, p_post_owner_id, page_date, p_post_entry_id, actor);
		pinned := true;
	end if;
	return pinned;
end;
$$;

create or replace function public.vidjo_community_report_entry(
	p_slug text,
	p_post_owner_id uuid,
	p_post_entry_id text,
	p_reason text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	page_date date;
begin
	if auth.uid() is null or not public.vidjo_is_member() then
		raise exception 'Sign in to report a page.';
	end if;
	select entry_date into page_date
	from public.vidjo_entries
	where id = p_post_entry_id
		and owner_id = p_post_owner_id::text
		and privacy = 'community'
		and community_slug = p_slug;
	if page_date is null then
		raise exception 'That page is no longer shared in this community.';
	end if;
	insert into public.vidjo_community_reports
		(community_slug, post_owner_id, post_date, post_entry_id, reporter_id, reason)
	values (
		p_slug, p_post_owner_id, page_date, p_post_entry_id, auth.uid(),
		left(coalesce(p_reason, ''), 240)
	)
	on conflict (community_slug, post_owner_id, post_entry_id, reporter_id)
	do update set reason = excluded.reason, created_at = now();
	return true;
end;
$$;

-- Keep the existing date-based RPCs working by resolving the newest page for
-- that date, matching calendar navigation behavior.
create or replace function public.vidjo_community_toggle_pin(
	p_slug text,
	p_post_owner_id uuid,
	p_post_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	page_id text;
begin
	select id into page_id
	from public.vidjo_entries
	where owner_id = p_post_owner_id::text
		and entry_date = p_post_date
		and privacy = 'community'
		and community_slug = p_slug
	order by created_at desc
	limit 1;
	if page_id is null then
		raise exception 'That page is no longer shared in this community.';
	end if;
	return public.vidjo_community_toggle_pin_entry(p_slug, p_post_owner_id, page_id);
end;
$$;

create or replace function public.vidjo_community_unshare_post(
	p_slug text,
	p_post_owner_id uuid,
	p_post_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	page_id text;
begin
	select id into page_id
	from public.vidjo_entries
	where owner_id = p_post_owner_id::text
		and entry_date = p_post_date
		and privacy = 'community'
		and community_slug = p_slug
	order by created_at desc
	limit 1;
	if page_id is null then
		return false;
	end if;
	return public.vidjo_community_unshare_entry(p_slug, p_post_owner_id, page_id);
end;
$$;

create or replace function public.vidjo_community_report_post(
	p_slug text,
	p_post_owner_id uuid,
	p_post_date date,
	p_reason text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	page_id text;
begin
	select id into page_id
	from public.vidjo_entries
	where owner_id = p_post_owner_id::text
		and entry_date = p_post_date
		and privacy = 'community'
		and community_slug = p_slug
	order by created_at desc
	limit 1;
	if page_id is null then
		raise exception 'That page is no longer shared in this community.';
	end if;
	return public.vidjo_community_report_entry(p_slug, p_post_owner_id, page_id, p_reason);
end;
$$;

create or replace function public.vidjo_community_delete_comment(
	p_slug text,
	p_comment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
	if not public.vidjo_community_can_moderate(p_slug) then
		raise exception 'Only community moderators can remove notes.';
	end if;
	delete from public.vidjo_comments c
	where c.id = p_comment_id
		and c.context = 'community'
		and exists (
			select 1 from public.vidjo_entries e
			where e.id = c.post_entry_id
				and e.owner_id = c.post_owner_id::text
				and e.privacy = 'community'
				and e.community_slug = p_slug
		);
	return found;
end;
$$;

revoke all on function public.vidjo_set_local_timezone(text) from public, anon;
revoke all on function public.vidjo_daily_limits() from public, anon;
revoke all on function public.vidjo_can_view_entry(uuid, text) from public, anon;
revoke all on function public.vidjo_community_unshare_entry(text, uuid, text) from public, anon;
revoke all on function public.vidjo_community_toggle_pin_entry(text, uuid, text) from public, anon;
revoke all on function public.vidjo_community_report_entry(text, uuid, text, text) from public, anon;
grant execute on function public.vidjo_set_local_timezone(text) to authenticated;
grant execute on function public.vidjo_daily_limits() to authenticated;
grant execute on function public.vidjo_can_view_entry(uuid, text) to authenticated;
grant execute on function public.vidjo_community_unshare_entry(text, uuid, text) to authenticated;
grant execute on function public.vidjo_community_toggle_pin_entry(text, uuid, text) to authenticated;
grant execute on function public.vidjo_community_report_entry(text, uuid, text, text) to authenticated;
revoke all on function public.vidjo_community_toggle_pin(text, uuid, date) from public, anon;
revoke all on function public.vidjo_community_unshare_post(text, uuid, date) from public, anon;
revoke all on function public.vidjo_community_report_post(text, uuid, date, text) from public, anon;
revoke all on function public.vidjo_community_delete_comment(text, uuid) from public, anon;
grant execute on function public.vidjo_community_toggle_pin(text, uuid, date) to authenticated;
grant execute on function public.vidjo_community_unshare_post(text, uuid, date) to authenticated;
grant execute on function public.vidjo_community_report_post(text, uuid, date, text) to authenticated;
grant execute on function public.vidjo_community_delete_comment(text, uuid) to authenticated;
grant select, insert, update, delete on public.vidjo_entries to authenticated;

notify pgrst, 'reload schema';
