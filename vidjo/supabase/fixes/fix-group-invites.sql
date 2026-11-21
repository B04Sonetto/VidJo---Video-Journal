-- Allow any group member to invite their friends, not just the owner.
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- The app's GroupInfoModal now shows "Add people" to every member. This RPC
-- still requires the caller to be a participant, the thread to be a group, the
-- invitee to be the caller's friend, and the 12-person cap to be respected.
-- Only the owner-only check is removed.

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

grant execute on function public.vidjo_dm_add_members(uuid, uuid[]) to authenticated;

-- Verify: the function exists and is executable by signed-in users.
--   select proname, prosecdef from pg_proc where proname = 'vidjo_dm_add_members';
