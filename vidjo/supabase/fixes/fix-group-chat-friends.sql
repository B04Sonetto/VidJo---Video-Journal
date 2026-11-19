-- Fix: a friend without an existing conversation "vanishes" from Messages /
-- group-chat pickers because vidjo_dm_inbox() hides direct threads that have no
-- messages. Two changes make every friendship visible right away:
--   1. Seeding the new direct thread with a friendly "now friends" note.
--   2. Letting empty direct threads through the inbox (covers older friendships
--      that were created before this migration).
-- Run this AFTER schema.sql and fix-messaging-features.sql, then rerun the app.

-- ---------------------------------------------------------------------------
-- 1. Internal helper: seed a direct conversation for a new friendship
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_dm_seed_friendship(p_user uuid, p_friend uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_thread uuid;
	v_name text;
begin
	if p_user is null or p_friend is null or p_user = p_friend then
		return;
	end if;

	-- Must be called by the accepting user; vidjo_dm_ensure_direct enforces this.
	v_thread := public.vidjo_dm_ensure_direct(p_user, p_friend);

	-- Only seed once. Re-accepting a request must not duplicate the note.
	if exists (select 1 from public.vidjo_dm_messages where thread_id = v_thread) then
		return;
	end if;

	select coalesce(nullif(btrim(display_name), ''), username, 'VidJo student')
	into v_name
	from public.vidjo_profiles
	where user_id = p_friend;

	insert into public.vidjo_dm_messages (thread_id, sender_id, client_id, body)
	values (
		v_thread,
		p_user,
		gen_random_uuid(),
		'🎉 ' || coalesce(v_name, 'Your new friend') || ' and you are now friends! Say hello.'
	);
end;
$$;

revoke all on function public.vidjo_dm_seed_friendship(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Accepting a request now opens the conversation with that note
-- ---------------------------------------------------------------------------

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

	-- Give the new friendship a conversation so it never disappears from
	-- Messages, the new-message picker, or the group-chat invite list.
	perform public.vidjo_dm_seed_friendship(curr_user, request_row.from_user);

	return jsonb_build_object('success', true, 'message', 'You are now friends!');
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Inbox: keep empty direct threads visible
--    (same rich signature as fix-messaging-features.sql, minus the filter)
-- ---------------------------------------------------------------------------

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
	can_reply boolean,
	last_shared_entry jsonb,
	last_deleted boolean,
	last_deleted_by_name text
)
language sql
stable
security definer
set search_path = public
as $$
	select
		t.id, t.kind, t.title,
		coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', p.user_id,
				'name', coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student'),
				'username', pr.username,
				'avatar', pr.avatar_url,
				'role', p.role
			) order by p.joined_at)
			from public.vidjo_dm_participants p
			left join public.vidjo_profiles pr on pr.user_id = p.user_id
			where p.thread_id = t.id
		), '[]'::jsonb),
		m.body, m.image_path, m.gif_url, m.sender_id,
		coalesce(nullif(btrim(sp.display_name), ''), sp.username, 'VidJo student'),
		coalesce(m.created_at, t.created_at),
		coalesce((
			select count(*)::integer from public.vidjo_dm_messages x
			where x.thread_id = t.id and x.sender_id <> me.user_id
				and x.deleted_at is null and x.created_at > me.last_read_at
		), 0),
		case when t.kind = 'group' then true else public.vidjo_are_friends(
			me.user_id,
			(select p2.user_id from public.vidjo_dm_participants p2
				where p2.thread_id = t.id and p2.user_id <> me.user_id limit 1)
		) end,
		m.shared_entry,
		m.deleted_at is not null,
		coalesce(nullif(btrim(dsp.display_name), ''), dsp.username, 'Someone')
	from public.vidjo_dm_threads t
	join public.vidjo_dm_participants me on me.thread_id = t.id and me.user_id = auth.uid()
	left join lateral (
		select mm.body, mm.image_path, mm.gif_url, mm.sender_id, mm.created_at,
			mm.shared_entry, mm.deleted_at, mm.deleted_by
		from public.vidjo_dm_messages mm
		where mm.thread_id = t.id
		order by mm.created_at desc, mm.id desc
		limit 1
	) m on true
	left join public.vidjo_profiles sp on sp.user_id = m.sender_id
	left join public.vidjo_profiles dsp on dsp.user_id = m.deleted_by
	where auth.uid() is not null
	order by coalesce(t.last_message_at, t.created_at) desc;
$$;

revoke all on function public.vidjo_dm_inbox() from public, anon;
grant execute on function public.vidjo_dm_inbox() to authenticated;
