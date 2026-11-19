-- VidJo messaging upgrade: replies, edits, deletes with tombstones, per-user
-- pins, reactions, seen receipts, forwarding and shared journal pages.
--
-- Run once in Supabase SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Message metadata
-- ---------------------------------------------------------------------------

alter table public.vidjo_dm_messages add column if not exists edited_at timestamptz;
alter table public.vidjo_dm_messages add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.vidjo_dm_messages add column if not exists reply_to uuid;
alter table public.vidjo_dm_messages add column if not exists shared_entry jsonb;
alter table public.vidjo_dm_messages add column if not exists forwarded_from jsonb;

-- A deleted message becomes an empty tombstone. The old check required a body
-- or an attachment, which made that impossible; sending is validated in the
-- RPCs below, so the table only needs a length guard.
alter table public.vidjo_dm_messages drop constraint if exists vidjo_dm_messages_body_check;
alter table public.vidjo_dm_messages add constraint vidjo_dm_messages_body_check check (
	char_length(btrim(coalesce(body, ''))) <= 2000
);

alter table public.vidjo_dm_messages drop constraint if exists vidjo_dm_messages_shared_entry_check;
alter table public.vidjo_dm_messages add constraint vidjo_dm_messages_shared_entry_check check (
	shared_entry is null or (jsonb_typeof(shared_entry) = 'object' and pg_column_size(shared_entry) <= 12000)
);

create index if not exists vidjo_dm_messages_reply_idx on public.vidjo_dm_messages (reply_to);

-- ---------------------------------------------------------------------------
-- 2. Reactions and personal pins
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_dm_reactions (
	message_id uuid not null references public.vidjo_dm_messages(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	emoji text not null check (char_length(emoji) between 1 and 8),
	created_at timestamptz not null default now(),
	primary key (message_id, user_id, emoji)
);

create table if not exists public.vidjo_dm_pins (
	thread_id uuid not null references public.vidjo_dm_threads(id) on delete cascade,
	message_id uuid not null references public.vidjo_dm_messages(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (thread_id, message_id, user_id)
);

create index if not exists vidjo_dm_reactions_message_idx on public.vidjo_dm_reactions (message_id);
create index if not exists vidjo_dm_pins_thread_idx on public.vidjo_dm_pins (thread_id, user_id);

create or replace function public.vidjo_dm_message_thread(p_message uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
	select m.thread_id from public.vidjo_dm_messages m where m.id = p_message;
$$;

alter table public.vidjo_dm_reactions enable row level security;
alter table public.vidjo_dm_pins enable row level security;

drop policy if exists "vidjo dm reactions select" on public.vidjo_dm_reactions;
create policy "vidjo dm reactions select" on public.vidjo_dm_reactions
	for select to authenticated
	using (
		public.vidjo_is_member()
		and public.vidjo_dm_is_participant(public.vidjo_dm_message_thread(message_id))
	);

drop policy if exists "vidjo dm pins select" on public.vidjo_dm_pins;
create policy "vidjo dm pins select" on public.vidjo_dm_pins
	for select to authenticated
	using (public.vidjo_is_member() and public.vidjo_dm_is_participant(thread_id));

revoke all on public.vidjo_dm_reactions from anon;
revoke all on public.vidjo_dm_pins from anon;
revoke insert, update, delete on public.vidjo_dm_reactions from authenticated;
revoke insert, update, delete on public.vidjo_dm_pins from authenticated;
grant select on public.vidjo_dm_reactions to authenticated;
grant select on public.vidjo_dm_pins to authenticated;

revoke all on function public.vidjo_dm_message_thread(uuid) from public, anon;
grant execute on function public.vidjo_dm_message_thread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Message actions
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_dm_edit_message(p_message uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_thread uuid;
	v_body text := btrim(coalesce(p_body, ''));
begin
	if v_user is null then raise exception 'Sign in first.'; end if;

	select m.thread_id into v_thread
	from public.vidjo_dm_messages m
	where m.id = p_message and m.sender_id = v_user and m.deleted_at is null;

	if v_thread is null then raise exception 'You can only edit your own messages.'; end if;
	if char_length(v_body) = 0 then raise exception 'Write a message first.'; end if;
	if char_length(v_body) > 2000 then raise exception 'Messages can be at most 2000 characters.'; end if;

	v_body := public.vidjo_dm_validate_body(v_body);

	update public.vidjo_dm_messages
	set body = v_body, edited_at = now()
	where id = p_message and sender_id = v_user;
end;
$$;

create or replace function public.vidjo_dm_delete_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_thread uuid;
begin
	if v_user is null then raise exception 'Sign in first.'; end if;

	select m.thread_id into v_thread
	from public.vidjo_dm_messages m
	where m.id = p_message and m.sender_id = v_user and m.deleted_at is null;

	if v_thread is null then raise exception 'You can only delete your own messages.'; end if;

	update public.vidjo_dm_messages
	set body = '',
		image_path = null,
		gif_url = null,
		shared_entry = null,
		forwarded_from = null,
		reply_to = null,
		deleted_at = now(),
		deleted_by = v_user
	where id = p_message and sender_id = v_user;
end;
$$;

create or replace function public.vidjo_dm_toggle_reaction(p_message uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_thread uuid;
	v_emoji text := btrim(coalesce(p_emoji, ''));
begin
	if v_user is null then raise exception 'Sign in first.'; end if;
	if char_length(v_emoji) = 0 or char_length(v_emoji) > 8 then
		raise exception 'Pick a valid reaction.';
	end if;

	select m.thread_id into v_thread
	from public.vidjo_dm_messages m
	where m.id = p_message and m.deleted_at is null;

	if v_thread is null or not public.vidjo_dm_is_participant(v_thread) then
		raise exception 'Conversation not found.';
	end if;

	delete from public.vidjo_dm_reactions r
	where r.message_id = p_message and r.user_id = v_user and r.emoji = v_emoji;

	if not found then
		insert into public.vidjo_dm_reactions (message_id, user_id, emoji)
		values (p_message, v_user, v_emoji)
		on conflict do nothing;
	end if;
end;
$$;

create or replace function public.vidjo_dm_toggle_pin(p_message uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_thread uuid;
	v_pinned boolean := false;
begin
	if v_user is null then raise exception 'Sign in first.'; end if;

	select m.thread_id into v_thread
	from public.vidjo_dm_messages m
	where m.id = p_message and m.deleted_at is null;

	if v_thread is null or not public.vidjo_dm_is_participant(v_thread) then
		raise exception 'Conversation not found.';
	end if;

	delete from public.vidjo_dm_pins p
	where p.message_id = p_message and p.user_id = v_user;

	if not found then
		insert into public.vidjo_dm_pins (thread_id, message_id, user_id)
		values (v_thread, p_message, v_user)
		on conflict do nothing;
		v_pinned := true;
	end if;

	return v_pinned;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sending a journal page
-- ---------------------------------------------------------------------------

create or replace function public.vidjo_dm_send_entry(
	p_thread uuid,
	p_entry jsonb,
	p_client_id uuid,
	p_reply_to uuid default null
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
	v_kind text;
	v_other uuid;
	v_existing public.vidjo_dm_messages%rowtype;
begin
	if v_user is null then raise exception 'Sign in to send messages.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;
	if not public.vidjo_dm_is_participant(p_thread) then raise exception 'Conversation not found.'; end if;

	select t.kind into v_kind from public.vidjo_dm_threads t where t.id = p_thread;
	if v_kind = 'direct' then
		select p.user_id into v_other
		from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id <> v_user limit 1;
		if v_other is null or not public.vidjo_are_friends(v_user, v_other) then
			raise exception 'You can only message friends.';
		end if;
	end if;

	if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
		raise exception 'Pick a journal page to share.';
	end if;
	if pg_column_size(p_entry) > 12000 then
		raise exception 'That page is too large to send.';
	end if;

	select * into v_existing
	from public.vidjo_dm_messages m
	where m.thread_id = p_thread and m.sender_id = v_user and m.client_id = v_client limit 1;
	if found then
		return query select v_existing.id, v_existing.thread_id, v_existing.sender_id,
			v_existing.client_id, v_existing.body, v_existing.image_path,
			v_existing.gif_url, v_existing.created_at;
		return;
	end if;

	begin
		insert into public.vidjo_dm_messages
			(thread_id, sender_id, client_id, body, shared_entry, reply_to)
		values (p_thread, v_user, v_client, '', p_entry, p_reply_to)
		returning * into v_existing;
	exception when unique_violation then
		select * into v_existing
		from public.vidjo_dm_messages m
		where m.thread_id = p_thread and m.sender_id = v_user and m.client_id = v_client limit 1;
	end;

	if v_existing.id is null then raise exception 'Could not send that page. Try again.'; end if;

	update public.vidjo_dm_participants p
	set last_read_at = greatest(p.last_read_at, v_existing.created_at)
	where p.thread_id = p_thread and p.user_id = v_user;

	return query select v_existing.id, v_existing.thread_id, v_existing.sender_id,
		v_existing.client_id, v_existing.body, v_existing.image_path,
		v_existing.gif_url, v_existing.created_at;
end;
$$;

-- `vidjo_dm_send` needs to accept a reply target too. Keep the 5-argument
-- version for older clients and add a 6-argument overload.
create or replace function public.vidjo_dm_send(
	p_thread uuid,
	p_body text,
	p_client_id uuid,
	p_image_path text default null,
	p_gif_url text default null,
	p_reply_to uuid default null
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
	if v_user is null then raise exception 'Sign in to send messages.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account before sending messages.'; end if;
	if not public.vidjo_dm_is_participant(p_thread) then raise exception 'Conversation not found.'; end if;

	select t.kind into v_kind from public.vidjo_dm_threads t where t.id = p_thread;
	if v_kind = 'direct' then
		select p.user_id into v_other from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id <> v_user limit 1;
		if v_other is null or not public.vidjo_are_friends(v_user, v_other) then
			raise exception 'You can only message friends.';
		end if;
	end if;

	select * into v_existing from public.vidjo_dm_messages m
	where m.thread_id = p_thread and m.sender_id = v_user and m.client_id = v_client limit 1;
	if found then
		return query select v_existing.id, v_existing.thread_id, v_existing.sender_id,
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
		if v_image !~ ('^' || p_thread::text || '/' || v_user::text ||
			'/[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp|gif)$') then
			raise exception 'That photo could not be sent.';
		end if;
		if not exists (select 1 from storage.objects o
			where o.bucket_id = 'vidjo-dm-images' and o.name = v_image) then
			raise exception 'Upload the photo first.';
		end if;
	end if;

	if v_gif is not null and (char_length(v_gif) > 500 or
		v_gif !~* '^https://(media[0-9]*|i)\.giphy\.com/') then
		raise exception 'That GIF could not be sent.';
	end if;

	v_body := public.vidjo_dm_validate_body(v_body);

	begin
		insert into public.vidjo_dm_messages (thread_id, sender_id, client_id, body, image_path, gif_url, reply_to)
		values (p_thread, v_user, v_client, v_body, v_image, v_gif, p_reply_to)
		returning * into v_existing;
	exception when unique_violation then
		select * into v_existing from public.vidjo_dm_messages m
		where m.thread_id = p_thread and m.sender_id = v_user and m.client_id = v_client limit 1;
	end;

	if v_existing.id is null then raise exception 'Could not send that message. Try again.'; end if;

	update public.vidjo_dm_participants p
	set last_read_at = greatest(p.last_read_at, v_existing.created_at)
	where p.thread_id = p_thread and p.user_id = v_user;

	return query select v_existing.id, v_existing.thread_id, v_existing.sender_id,
		v_existing.client_id, v_existing.body, v_existing.image_path,
		v_existing.gif_url, v_existing.created_at;
end;
$$;

-- Only the 6-argument version is callable now, matching the client's calls.
drop function if exists public.vidjo_dm_send(uuid, text, uuid, text, text);

-- Forwarding keeps the original attachment or journal card and records who
-- wrote it, so a forwarded bubble can render as a proper quote card.
create or replace function public.vidjo_dm_forward(
	p_thread uuid,
	p_source uuid,
	p_client_id uuid,
	p_reply_to uuid default null
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
	v_kind text;
	v_other uuid;
	v_source public.vidjo_dm_messages%rowtype;
	v_existing public.vidjo_dm_messages%rowtype;
	v_source_name text := 'Someone';
begin
	if v_user is null then raise exception 'Sign in to send messages.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;
	if not public.vidjo_dm_is_participant(p_thread) then raise exception 'Conversation not found.'; end if;

	select * into v_source from public.vidjo_dm_messages m
	where m.id = p_source and m.deleted_at is null;
	if v_source.id is null then raise exception 'That message is no longer available.'; end if;
	if not public.vidjo_dm_is_participant(v_source.thread_id) then
		raise exception 'Conversation not found.';
	end if;

	select coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'Someone')
	into v_source_name
	from public.vidjo_profiles pr where pr.user_id = v_source.sender_id;

	select t.kind into v_kind from public.vidjo_dm_threads t where t.id = p_thread;
	if v_kind = 'direct' then
		select p.user_id into v_other from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id <> v_user limit 1;
		if v_other is null or not public.vidjo_are_friends(v_user, v_other) then
			raise exception 'You can only message friends.';
		end if;
	end if;

	select * into v_existing from public.vidjo_dm_messages m
	where m.thread_id = p_thread and m.sender_id = v_user and m.client_id = v_client limit 1;
	if found then
		return query select v_existing.id, v_existing.thread_id, v_existing.sender_id,
			v_existing.client_id, v_existing.body, v_existing.image_path,
			v_existing.gif_url, v_existing.created_at;
		return;
	end if;

	begin
		insert into public.vidjo_dm_messages
			(thread_id, sender_id, client_id, body, image_path, gif_url,
			 shared_entry, forwarded_from, reply_to)
		values (
			p_thread, v_user, v_client,
			case when v_source.shared_entry is null then v_source.body else '' end,
			v_source.image_path, v_source.gif_url, v_source.shared_entry,
			jsonb_build_object('name', v_source_name, 'body', v_source.body),
			p_reply_to
		)
		returning * into v_existing;
	exception when unique_violation then
		select * into v_existing from public.vidjo_dm_messages m
		where m.thread_id = p_thread and m.sender_id = v_user and m.client_id = v_client limit 1;
	end;

	if v_existing.id is null then raise exception 'Could not forward that message. Try again.'; end if;

	update public.vidjo_dm_participants p
	set last_read_at = greatest(p.last_read_at, v_existing.created_at)
	where p.thread_id = p_thread and p.user_id = v_user;

	return query select v_existing.id, v_existing.thread_id, v_existing.sender_id,
		v_existing.client_id, v_existing.body, v_existing.image_path,
		v_existing.gif_url, v_existing.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rich thread read (tombstones, replies, reactions, pins, seen receipts)
-- ---------------------------------------------------------------------------

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
	created_at timestamptz,
	edited_at timestamptz,
	deleted_at timestamptz,
	deleted_by_name text,
	reply_to uuid,
	reply_sender text,
	reply_body text,
	reply_deleted boolean,
	shared_entry jsonb,
	forwarded_from jsonb,
	reactions jsonb,
	pinned boolean,
	seen_by jsonb
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
		recent.id, recent.thread_id, recent.sender_id, recent.client_id,
		recent.sender_name, recent.sender_username, recent.sender_avatar,
		recent.body, recent.image_path, recent.gif_url, recent.created_at,
		recent.edited_at, recent.deleted_at, recent.deleted_by_name,
		recent.reply_to, recent.reply_sender, recent.reply_body, recent.reply_deleted,
		recent.shared_entry, recent.forwarded_from,
		coalesce((
			select jsonb_agg(jsonb_build_object(
				'emoji', r.emoji, 'count', r.count, 'mine', r.mine
			) order by r.emoji)
			from (
				select re.emoji,
					count(*)::integer as count,
					bool_or(re.user_id = auth.uid()) as mine
				from public.vidjo_dm_reactions re
				where re.message_id = recent.id
				group by re.emoji
			) r
		), '[]'::jsonb) as reactions,
		exists (
			select 1 from public.vidjo_dm_pins pin
			where pin.message_id = recent.id and pin.user_id = auth.uid()
		) as pinned,
		coalesce((
			select jsonb_agg(jsonb_build_object('name', seen.name, 'at', seen.at) order by seen.at)
			from (
				select coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student') as name,
					p.last_read_at as at
				from public.vidjo_dm_participants p
				left join public.vidjo_profiles pr on pr.user_id = p.user_id
				where p.thread_id = p_thread
					and p.user_id <> recent.sender_id
					and p.last_read_at >= recent.created_at
			) seen
		), '[]'::jsonb) as seen_by
	from (
		select
			m.id, m.thread_id, m.sender_id, m.client_id,
			coalesce(nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student') as sender_name,
			coalesce(pr.username, 'student') as sender_username,
			pr.avatar_url as sender_avatar,
			m.body, m.image_path, m.gif_url, m.created_at,
			m.edited_at, m.deleted_at,
			coalesce(nullif(btrim(dp.display_name), ''), dp.username, 'Someone') as deleted_by_name,
			m.reply_to,
			coalesce(nullif(btrim(rp.display_name), ''), rp.username, 'Someone') as reply_sender,
			case when rm.deleted_at is not null then '' else rm.body end as reply_body,
			rm.deleted_at is not null as reply_deleted,
			m.shared_entry, m.forwarded_from
		from public.vidjo_dm_messages m
		left join public.vidjo_profiles pr on pr.user_id = m.sender_id
		left join public.vidjo_profiles dp on dp.user_id = m.deleted_by
		left join public.vidjo_dm_messages rm on rm.id = m.reply_to
		left join public.vidjo_profiles rp on rp.user_id = rm.sender_id
		where m.thread_id = p_thread
			and m.created_at < coalesce(p_before, now())
		order by m.created_at desc, m.id desc
		limit v_limit
	) recent
	order by recent.created_at asc, recent.id asc;
end;
$$;

-- Inbox needs the shared-page preview too.
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
		m.created_at,
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
		and (t.last_message_at is not null or t.kind = 'group')
	order by coalesce(t.last_message_at, t.created_at) desc;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants and realtime
-- ---------------------------------------------------------------------------

revoke all on function public.vidjo_dm_edit_message(uuid, text) from public, anon;
grant execute on function public.vidjo_dm_edit_message(uuid, text) to authenticated;

revoke all on function public.vidjo_dm_delete_message(uuid) from public, anon;
grant execute on function public.vidjo_dm_delete_message(uuid) to authenticated;

revoke all on function public.vidjo_dm_toggle_reaction(uuid, text) from public, anon;
grant execute on function public.vidjo_dm_toggle_reaction(uuid, text) to authenticated;

revoke all on function public.vidjo_dm_toggle_pin(uuid) from public, anon;
grant execute on function public.vidjo_dm_toggle_pin(uuid) to authenticated;

revoke all on function public.vidjo_dm_send_entry(uuid, jsonb, uuid, uuid) from public, anon;
grant execute on function public.vidjo_dm_send_entry(uuid, jsonb, uuid, uuid) to authenticated;

revoke all on function public.vidjo_dm_forward(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.vidjo_dm_forward(uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.vidjo_dm_send(uuid, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.vidjo_dm_send(uuid, text, uuid, text, text, uuid) to authenticated;

revoke all on function public.vidjo_dm_thread(uuid, timestamptz, integer) from public, anon;
grant execute on function public.vidjo_dm_thread(uuid, timestamptz, integer) to authenticated;

revoke all on function public.vidjo_dm_inbox() from public, anon;
grant execute on function public.vidjo_dm_inbox() to authenticated;

do $$
declare
	t text;
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		return;
	end if;

	foreach t in array array['vidjo_dm_reactions', 'vidjo_dm_pins'] loop
		if not exists (
			select 1 from pg_publication_tables
			where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
		) then
			execute format('alter publication supabase_realtime add table public.%I', t);
		end if;
	end loop;
end;
$$;
