-- ---------------------------------------------------------------------------
-- Hotfix: timezone handling for pages and streaks
-- ---------------------------------------------------------------------------
-- Symptom 1: members east of UTC cannot save a page for the first hours after
-- their local midnight. Postgres runs in UTC, so `current_date` is still
-- yesterday while the app (which uses the local date) is already on today.
-- The future-page trigger rejected that save, so the page stayed device-only
-- and never reached friends or the community.
--
-- Symptom 2: a friend's streak on their profile showed as one day behind (and
-- `todayCounted` false) for the same reason, because `vidjo_streak_for` used
-- the UTC date.
--
-- Paste this whole file into the Supabase SQL editor and run it. It is safe to
-- run more than once. Run it after supabase/fix-signup-hook.sql.
--
-- The app now sends its local date to `vidjo_streak_for`, so the old
-- single-argument function is dropped to keep PostgREST from having to choose
-- between overloads.

-- ---------------------------------------------------------------------------
-- 1. Allow one day of slack when creating pages
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_reject_future_entry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	-- `+ 1` covers every positive UTC offset. The app still blocks future
	-- pages before they are saved, so this only widens the API guard by a day.
	if new.entry_date > current_date + 1 then
		raise exception 'VidJo pages can only be created for today or an earlier date.'
			using errcode = 'P0001';
	end if;
	return new;
end;
$$;

revoke all on function public.vidjo_reject_future_entry() from public;

-- ---------------------------------------------------------------------------
-- 2. Let the streak RPC use the viewer's local date
-- ---------------------------------------------------------------------------

drop function if exists public.vidjo_streak_for(uuid);

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

revoke all on function public.vidjo_streak_for(uuid, date) from public;
revoke all on function public.vidjo_streak_for(uuid, date) from anon;
grant execute on function public.vidjo_streak_for(uuid, date) to authenticated;

notify pgrst, 'reload schema';

-- Quick check (replace the id with a real profile):
--   select public.vidjo_streak_for('<user-id>'::uuid, current_date);
-- Expected: a JSON object with current/longest/totalDays/todayCounted.
