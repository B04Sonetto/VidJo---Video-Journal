-- VidJo community features: ownership, moderators, rules, pins, and reports.
-- Safe to re-run in the Supabase SQL editor after supabase/schema.sql.

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------

alter table public.vidjo_communities
	add column if not exists owner_id uuid references auth.users(id) on delete set null,
	add column if not exists rules text not null default '',
	add column if not exists updated_at timestamptz not null default now();

alter table public.vidjo_community_members
	add column if not exists role text not null default 'member';

do $$
begin
	alter table public.vidjo_community_members
		drop constraint if exists vidjo_community_members_role_check;
	alter table public.vidjo_community_members
		add constraint vidjo_community_members_role_check
		check (role in ('member', 'moderator', 'admin', 'owner'));
end $$;

-- Joining must never grant a privileged role directly through PostgREST.
drop policy if exists "vidjo community members insert own" on public.vidjo_community_members;
create policy "vidjo community members insert own" on public.vidjo_community_members
	for insert to authenticated
	with check (
		public.vidjo_is_member()
		and auth.uid() = user_id
		and role = 'member'
	);

-- Normalize legacy owner rows before assigning an owner from the global admins.
update public.vidjo_community_members m
set role = 'admin'
where m.role = 'owner'
	and not exists (
		select 1
		from public.vidjo_communities c
		where c.slug = m.community_slug and c.owner_id = m.user_id
	);

-- Give each existing community a named owner when the project already has an
-- admin. Communities without an admin are shown as run by the VidJo team.
update public.vidjo_communities c
set owner_id = chosen.user_id
from (
	select p.user_id
	from public.vidjo_profiles p
	where lower(coalesce(p.user_role, 'user')) = 'admin'
	order by p.created_at
	limit 1
) chosen
where c.owner_id is null;

insert into public.vidjo_community_members (community_slug, user_id, role)
select c.slug, c.owner_id, 'owner'
from public.vidjo_communities c
where c.owner_id is not null
on conflict (community_slug, user_id) do update
set role = case
	when public.vidjo_community_members.role = 'owner' then public.vidjo_community_members.role
	else excluded.role
end;

-- Sticky posts and post reports are Reddit-style community tools.
create table if not exists public.vidjo_community_pinned_posts (
	community_slug text not null
		references public.vidjo_communities(slug) on delete cascade,
	post_owner_id uuid not null references auth.users(id) on delete cascade,
	post_date date not null,
	pinned_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now(),
	primary key (community_slug, post_owner_id, post_date)
);

alter table public.vidjo_community_pinned_posts enable row level security;

drop policy if exists "vidjo community pins select" on public.vidjo_community_pinned_posts;
create policy "vidjo community pins select" on public.vidjo_community_pinned_posts
	for select to authenticated
	using (public.vidjo_is_member());

revoke all on public.vidjo_community_pinned_posts from anon;
grant select on public.vidjo_community_pinned_posts to authenticated;

create table if not exists public.vidjo_community_reports (
	id bigint generated always as identity primary key,
	community_slug text not null
		references public.vidjo_communities(slug) on delete cascade,
	post_owner_id uuid not null references auth.users(id) on delete cascade,
	post_date date not null,
	reporter_id uuid not null references auth.users(id) on delete cascade,
	reason text not null default '',
	created_at timestamptz not null default now(),
	unique (community_slug, post_owner_id, post_date, reporter_id)
);

alter table public.vidjo_community_reports enable row level security;

drop policy if exists "vidjo community reports select" on public.vidjo_community_reports;
create policy "vidjo community reports select" on public.vidjo_community_reports
	for select to authenticated
	using (
		auth.uid() = reporter_id
		or exists (
			select 1 from public.vidjo_profiles p
			where p.user_id = auth.uid() and lower(coalesce(p.user_role, 'user')) = 'admin'
		)
	);

revoke all on public.vidjo_community_reports from anon;
grant select on public.vidjo_community_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Role helpers
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_is_global_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select p_user is not null and exists (
		select 1
		from public.vidjo_profiles p
		where p.user_id = p_user
			and lower(coalesce(p.user_role, 'user')) = 'admin'
	);
$$;

create or replace function public.vidjo_community_role(
	p_slug text,
	p_user uuid default auth.uid()
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	v_user uuid := coalesce(p_user, auth.uid());
	v_role text;
begin
	if v_user is null then return 'none'; end if;
	if public.vidjo_is_global_admin(v_user) then return 'admin'; end if;

	select c.role into v_role
	from public.vidjo_community_members c
	where c.community_slug = p_slug and c.user_id = v_user;

	if v_role is not null then return v_role; end if;

	if exists (
		select 1 from public.vidjo_communities x
		where x.slug = p_slug and x.owner_id = v_user
	) then
		return 'owner';
	end if;

	return 'none';
end;
$$;

create or replace function public.vidjo_community_can_moderate(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.vidjo_is_member()
		and public.vidjo_community_role(p_slug, auth.uid()) in ('owner', 'admin', 'moderator');
$$;

-- ---------------------------------------------------------------------------
-- 3. Moderation RPCs
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_community_set_role(
	p_slug text,
	p_user uuid,
	p_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_global boolean;
	v_actor_role text;
	v_target_global boolean;
	v_target_role text;
	v_owner uuid;
begin
	if v_actor is null then raise exception 'Sign in to manage this community.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;
	if p_user is null then raise exception 'Choose a member first.'; end if;
	if p_role not in ('member', 'moderator', 'admin', 'owner') then
		raise exception 'Unknown community role.';
	end if;

	v_actor_global := public.vidjo_is_global_admin(v_actor);
	v_actor_role := public.vidjo_community_role(p_slug, v_actor);

	if not v_actor_global then
		if v_actor_role = 'owner' and p_role in ('member', 'moderator', 'admin') then
			null;
		elsif v_actor_role = 'admin' and p_role in ('member', 'moderator') then
			null;
		else
			raise exception 'You cannot assign that role.';
		end if;
	end if;

	if p_user = v_actor then
		raise exception 'Use community settings to change your own role.';
	end if;

	select c.owner_id into v_owner
	from public.vidjo_communities c where c.slug = p_slug;
	if v_owner is null then
		raise exception 'This community has no owner yet. Ask a VidJo admin to assign one.';
	end if;

	v_target_global := public.vidjo_is_global_admin(p_user);
	if v_target_global and not v_actor_global then
		raise exception 'VidJo admins cannot be given a community role.';
	end if;

	select m.role into v_target_role
	from public.vidjo_community_members m
	where m.community_slug = p_slug and m.user_id = p_user;

	if v_target_role = 'owner' and p_role <> 'owner' then
		raise exception 'Assign a new owner before changing this one.';
	end if;

	if p_role = 'owner' then
		if not v_actor_global then
			raise exception 'Only VidJo admins can transfer ownership.';
		end if;
		update public.vidjo_community_members m
		set role = 'admin'
		where m.community_slug = p_slug and m.role = 'owner';
		update public.vidjo_communities c
		set owner_id = p_user, updated_at = now()
		where c.slug = p_slug;
	end if;

	insert into public.vidjo_community_members (community_slug, user_id, role)
	values (p_slug, p_user, p_role)
	on conflict (community_slug, user_id) do update
	set role = excluded.role;

	return true;
end;
$$;

create or replace function public.vidjo_community_kick_member(
	p_slug text,
	p_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_global boolean;
	v_actor_role text;
	v_target_role text;
	v_owner uuid;
begin
	if v_actor is null then raise exception 'Sign in to manage this community.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;
	if p_user is null or p_user = v_actor then
		raise exception 'Use the leave button to exit a community.';
	end if;

	select c.owner_id into v_owner
	from public.vidjo_communities c where c.slug = p_slug;
	if p_user = v_owner then
		raise exception 'The community owner cannot be removed.';
	end if;

	select m.role into v_target_role
	from public.vidjo_community_members m
	where m.community_slug = p_slug and m.user_id = p_user;
	if v_target_role is null then return false; end if;

	v_actor_global := public.vidjo_is_global_admin(v_actor);
	v_actor_role := public.vidjo_community_role(p_slug, v_actor);

	if not v_actor_global then
		if v_actor_role = 'owner' and v_target_role in ('member', 'moderator', 'admin') then
			null;
		elsif v_actor_role = 'admin' and v_target_role in ('member', 'moderator') then
			null;
		elsif v_actor_role = 'moderator' and v_target_role = 'member' then
			null;
		else
			raise exception 'You cannot remove that member.';
		end if;
	end if;

	if public.vidjo_is_global_admin(p_user) and not v_actor_global then
		raise exception 'VidJo admins cannot be removed from a community.';
	end if;

	delete from public.vidjo_community_members m
	where m.community_slug = p_slug and m.user_id = p_user;

	return true;
end;
$$;

create or replace function public.vidjo_community_update_details(
	p_slug text,
	p_rules text,
	p_description text default null,
	p_icon text default null,
	p_color text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
begin
	if v_actor is null then raise exception 'Sign in to manage this community.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;

	v_role := public.vidjo_community_role(p_slug, v_actor);
	if v_role not in ('owner', 'admin') then
		raise exception 'Only owners and admins can edit community details.';
	end if;

	update public.vidjo_communities c
	set
		rules = left(coalesce(p_rules, ''), 4000),
		description = case
			when p_description is null then c.description
			else left(p_description, 1000)
		end,
		icon = case when p_icon is null then c.icon else left(p_icon, 40) end,
		color = case when p_color is null then c.color else left(p_color, 40) end,
		updated_at = now()
	where c.slug = p_slug;

	return found;
end;
$$;

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
	v_actor uuid := auth.uid();
	v_pinned boolean := false;
begin
	if not public.vidjo_community_can_moderate(p_slug) then
		raise exception 'Only community moderators can pin posts.';
	end if;

	if not exists (
		select 1 from public.vidjo_entries e
		where e.owner_id = p_post_owner_id
			and e.entry_date = p_post_date
			and e.privacy = 'community'
			and e.community_slug = p_slug
	) then
		raise exception 'That page is no longer shared in this community.';
	end if;

	if exists (
		select 1 from public.vidjo_community_pinned_posts p
		where p.community_slug = p_slug
			and p.post_owner_id = p_post_owner_id
			and p.post_date = p_post_date
	) then
		delete from public.vidjo_community_pinned_posts p
		where p.community_slug = p_slug
			and p.post_owner_id = p_post_owner_id
			and p.post_date = p_post_date;
		v_pinned := false;
	else
		insert into public.vidjo_community_pinned_posts
			(community_slug, post_owner_id, post_date, pinned_by)
		values (p_slug, p_post_owner_id, p_post_date, v_actor);
		v_pinned := true;
	end if;

	return v_pinned;
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
begin
	if not public.vidjo_community_can_moderate(p_slug) then
		raise exception 'Only community moderators can remove pages.';
	end if;

	update public.vidjo_entries e
	set
		privacy = case when e.share_with_friends then 'friends' else 'private' end,
		share_with_friends = false,
		community_slug = null,
		updated_at = now()
	where e.owner_id = p_post_owner_id
		and e.entry_date = p_post_date
		and e.privacy = 'community'
		and e.community_slug = p_slug;

	return found;
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
			where e.owner_id = c.post_owner_id
				and e.entry_date = c.post_date
				and e.privacy = 'community'
				and e.community_slug = p_slug
		);

	return found;
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
	v_actor uuid := auth.uid();
	v_reason text := left(btrim(coalesce(p_reason, '')), 240);
begin
	if v_actor is null then raise exception 'Sign in to report a page.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;

	if not exists (
		select 1 from public.vidjo_entries e
		where e.owner_id = p_post_owner_id
			and e.entry_date = p_post_date
			and e.privacy = 'community'
			and e.community_slug = p_slug
	) then
		raise exception 'That page is no longer shared in this community.';
	end if;

	if v_reason = '' then v_reason := 'No reason given'; end if;

	insert into public.vidjo_community_reports
		(community_slug, post_owner_id, post_date, reporter_id, reason)
	values (p_slug, p_post_owner_id, p_post_date, v_actor, v_reason)
	on conflict (community_slug, post_owner_id, post_date, reporter_id) do nothing;

	return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.vidjo_is_global_admin(uuid) from public, anon;
grant execute on function public.vidjo_is_global_admin(uuid) to authenticated;

revoke all on function public.vidjo_community_role(text, uuid) from public, anon;
grant execute on function public.vidjo_community_role(text, uuid) to authenticated;

revoke all on function public.vidjo_community_can_moderate(text) from public, anon;
grant execute on function public.vidjo_community_can_moderate(text) to authenticated;

revoke all on function public.vidjo_community_set_role(text, uuid, text) from public, anon;
grant execute on function public.vidjo_community_set_role(text, uuid, text) to authenticated;

revoke all on function public.vidjo_community_kick_member(text, uuid) from public, anon;
grant execute on function public.vidjo_community_kick_member(text, uuid) to authenticated;

revoke all on function public.vidjo_community_update_details(text, text, text, text, text) from public, anon;
grant execute on function public.vidjo_community_update_details(text, text, text, text, text) to authenticated;

revoke all on function public.vidjo_community_toggle_pin(text, uuid, date) from public, anon;
grant execute on function public.vidjo_community_toggle_pin(text, uuid, date) to authenticated;

revoke all on function public.vidjo_community_unshare_post(text, uuid, date) from public, anon;
grant execute on function public.vidjo_community_unshare_post(text, uuid, date) to authenticated;

revoke all on function public.vidjo_community_delete_comment(text, uuid) from public, anon;
grant execute on function public.vidjo_community_delete_comment(text, uuid) to authenticated;

revoke all on function public.vidjo_community_report_post(text, uuid, date, text) from public, anon;
grant execute on function public.vidjo_community_report_post(text, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime publication
-- ---------------------------------------------------------------------------

do $$
declare
	table_name text;
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		return;
	end if;

	foreach table_name in array array[
		'vidjo_communities',
		'vidjo_community_members',
		'vidjo_community_pinned_posts',
		'vidjo_community_reports'
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
