-- Optional photo highlights for journal pages.
-- Run after schema.sql and fixes/fix-multiple-pages-and-daily-limits.sql.
-- Safe to re-run. Highlights use the existing private vidjo-videos bucket with
-- short-lived signed URLs; only object paths are stored on the journal row.

alter table public.vidjo_entries
	add column if not exists highlight_path text;

alter table public.vidjo_entries
	add column if not exists highlight_name text;

-- The bucket already accepts JPEG. Add the other raster formats the picker
-- validates on the client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'vidjo-videos',
	'vidjo-videos',
	false,
	52428800,
	array[
		'video/webm', 'video/mp4', 'video/quicktime', 'video/x-matroska',
		'image/jpeg', 'image/png', 'image/gif', 'image/webp'
	]
)
on conflict (id) do update set
	public = false,
	allowed_mime_types = excluded.allowed_mime_types;

-- Signed URLs must be creatable for a highlight on a page the viewer may read.
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
				where (e.video_path = storage.objects.name or e.highlight_path = storage.objects.name)
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

-- Preserve highlight fields when pre-account device rows are claimed.
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
		stickers, saved, sample, video_path, video_url, video_name,
		highlight_path, highlight_name, updated_at
	)
	select
		uid_text, entry_date, mood, title, mind, refl, privacy,
		stickers, saved, sample, video_path, video_url, video_name,
		highlight_path, highlight_name, updated_at
	from public.vidjo_entries
	where owner_id = device_id
	on conflict (id) do nothing;

	get diagnostics moved = row_count;

	delete from public.vidjo_entries where owner_id = device_id;

	return moved;
end;
$$;

revoke all on function public.claim_device_entries(text) from public;
grant execute on function public.claim_device_entries(text) to authenticated;

-- A page with only a photo still counts toward a streak.
drop function if exists public.vidjo_streak_for(uuid);
drop function if exists public.vidjo_streak_for(uuid, date);

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
			and (
				public.vidjo_entry_counts(
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
				or length(coalesce(e.highlight_path, '')) > 0
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

	cursor_day := case when today_counted then today else today - 1 end;

	loop
		exit when current_run >= 3660;
		exit when not exists (
			select 1
			from public.vidjo_entries e
			where e.owner_id = target::text
				and e.entry_date = cursor_day
				and e.sample = false
				and (
					public.vidjo_entry_counts(
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
					or length(coalesce(e.highlight_path, '')) > 0
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

revoke all on function public.vidjo_streak_for(uuid, date) from public;
revoke all on function public.vidjo_streak_for(uuid, date) from anon;
grant execute on function public.vidjo_streak_for(uuid, date) to authenticated;

-- Allow the two new privacy-friendly analytics events emitted by the picker.
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
		'highlight_added',
		'highlight_removed',
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
