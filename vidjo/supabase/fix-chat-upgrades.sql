-- VidJo chat upgrades: document attachments, a pinned-message viewer, message
-- reports, chat photos, chat themes and per-chat nicknames.
--
-- Run once in the Supabase SQL Editor, after schema.sql,
-- fix-messaging-features.sql and fix-group-chat-friends.sql. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Document attachments
-- ---------------------------------------------------------------------------

alter table public.vidjo_dm_messages
	add column if not exists file_path text,
	add column if not exists file_name text,
	add column if not exists file_mime text,
	add column if not exists file_size integer;

alter table public.vidjo_dm_messages
	drop constraint if exists vidjo_dm_messages_file_check;
alter table public.vidjo_dm_messages
	add constraint vidjo_dm_messages_file_check check (
		file_path is null
		or (
			char_length(file_path) between 1 and 300
			and char_length(coalesce(file_name, '')) between 1 and 180
			and char_length(coalesce(file_mime, '')) between 1 and 120
			and coalesce(file_size, 0) > 0
			and coalesce(file_size, 0) <= 20971520
		)
	);

-- Only one attachment kind per message.
alter table public.vidjo_dm_messages
	drop constraint if exists vidjo_dm_messages_media_check;
alter table public.vidjo_dm_messages
	add constraint vidjo_dm_messages_media_check check (
		(case when image_path is not null then 1 else 0 end)
		+ (case when gif_url is not null then 1 else 0 end)
		+ (case when file_path is not null then 1 else 0 end) <= 1
	);

-- Private bucket. Only PDF and Word documents are accepted; no executables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'vidjo-dm-files',
	'vidjo-dm-files',
	false,
	20971520,
	array[
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	]
)
on conflict (id) do update set
	public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "vidjo dm file read" on storage.objects;
drop policy if exists "vidjo dm file upload" on storage.objects;
drop policy if exists "vidjo dm file delete" on storage.objects;

create policy "vidjo dm file read" on storage.objects
	for select to authenticated
	using (
		bucket_id = 'vidjo-dm-files'
		and public.vidjo_is_member()
		and public.vidjo_dm_is_participant(
			public.vidjo_try_uuid((storage.foldername(name))[1])
		)
	);

create policy "vidjo dm file upload" on storage.objects
	for insert to authenticated
	with check (
		bucket_id = 'vidjo-dm-files'
		and public.vidjo_is_member()
		and public.vidjo_dm_can_send(
			public.vidjo_try_uuid((storage.foldername(name))[1])
		)
		and (storage.foldername(name))[2] = auth.uid()::text
	);

create policy "vidjo dm file delete" on storage.objects
	for delete to authenticated
	using (
		bucket_id = 'vidjo-dm-files'
		and public.vidjo_is_member()
		and (storage.foldername(name))[2] = auth.uid()::text
	);

-- ---------------------------------------------------------------------------
-- 2. Chat settings: group photo, personal theme, per-chat nicknames
-- ---------------------------------------------------------------------------

alter table public.vidjo_dm_threads
	add column if not exists photo_path text;

create table if not exists public.vidjo_dm_chat_themes (
	thread_id uuid not null references public.vidjo_dm_threads(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	theme text not null default 'classic',
	primary key (thread_id, user_id)
);

create table if not exists public.vidjo_dm_nicknames (
	thread_id uuid not null references public.vidjo_dm_threads(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	nickname text not null,
	primary key (thread_id, user_id),
	constraint vidjo_dm_nicknames_length check (char_length(btrim(nickname)) between 1 and 24)
);

alter table public.vidjo_dm_chat_themes enable row level security;
alter table public.vidjo_dm_nicknames enable row level security;

drop policy if exists "vidjo dm chat themes select" on public.vidjo_dm_chat_themes;
create policy "vidjo dm chat themes select" on public.vidjo_dm_chat_themes
	for select to authenticated using (user_id = auth.uid());

drop policy if exists "vidjo dm nicknames select" on public.vidjo_dm_nicknames;
create policy "vidjo dm nicknames select" on public.vidjo_dm_nicknames
	for select to authenticated using (
		public.vidjo_dm_is_participant(thread_id)
	);

revoke all on public.vidjo_dm_chat_themes from anon;
revoke all on public.vidjo_dm_nicknames from anon;
grant select on public.vidjo_dm_chat_themes to authenticated;
grant select on public.vidjo_dm_nicknames to authenticated;

create or replace function public.vidjo_dm_chat_settings(p_thread uuid)
returns table (
	thread_id uuid,
	kind text,
	title text,
	photo_path text,
	theme text,
	created_at timestamptz,
	member_count integer
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
		t.id,
		t.kind,
		t.title,
		t.photo_path,
		coalesce(ct.theme, 'classic'),
		t.created_at,
		(select count(*)::integer from public.vidjo_dm_participants p where p.thread_id = t.id)
	from public.vidjo_dm_threads t
	left join public.vidjo_dm_chat_themes ct
		on ct.thread_id = t.id and ct.user_id = auth.uid()
	where t.id = p_thread;
end;
$$;

create or replace function public.vidjo_dm_set_chat_photo(p_thread uuid, p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_path text := nullif(btrim(coalesce(p_path, '')), '');
	v_kind text;
begin
	if v_user is null then raise exception 'Sign in to update this chat.'; end if;
	if not public.vidjo_dm_is_participant(p_thread) then raise exception 'Conversation not found.'; end if;

	select t.kind into v_kind from public.vidjo_dm_threads t where t.id = p_thread;
	if v_kind <> 'group' then raise exception 'Only group chats can have a photo.'; end if;
	if not exists (
		select 1 from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id = v_user and p.role = 'owner'
	) then
		raise exception 'Only the group owner can change its photo.';
	end if;

	if v_path is null then
		update public.vidjo_dm_threads set photo_path = null where id = p_thread;
		return true;
	end if;

	if v_path !~ ('^' || p_thread::text || '/' || v_user::text ||
		'/[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp|gif)$') then
		raise exception 'That photo could not be used.';
	end if;
	if not exists (
		select 1 from storage.objects o
		where o.bucket_id = 'vidjo-dm-images' and o.name = v_path
	) then
		raise exception 'Upload the photo first.';
	end if;

	update public.vidjo_dm_threads set photo_path = v_path where id = p_thread;
	return true;
end;
$$;

create or replace function public.vidjo_dm_set_chat_theme(p_thread uuid, p_theme text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_theme text := lower(btrim(coalesce(p_theme, '')));
begin
	if auth.uid() is null then raise exception 'Sign in to update this chat.'; end if;
	if not public.vidjo_dm_is_participant(p_thread) then raise exception 'Conversation not found.'; end if;
	if v_theme not in ('classic', 'sunset', 'midnight', 'evergreen', 'rosewood', 'harbor') then
		raise exception 'Unknown chat theme.';
	end if;

	insert into public.vidjo_dm_chat_themes (thread_id, user_id, theme)
	values (p_thread, auth.uid(), v_theme)
	on conflict (thread_id, user_id) do update set theme = excluded.theme;
	return true;
end;
$$;

create or replace function public.vidjo_dm_set_nickname(
	p_thread uuid,
	p_target uuid,
	p_nickname text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_name text := btrim(coalesce(p_nickname, ''));
begin
	if v_user is null then raise exception 'Sign in to update this chat.'; end if;
	if not public.vidjo_dm_is_participant(p_thread) then raise exception 'Conversation not found.'; end if;
	if char_length(v_name) < 1 or char_length(v_name) > 24 then
		raise exception 'Nicknames must be 1 to 24 characters.';
	end if;
	if not exists (
		select 1 from public.vidjo_dm_participants p
		where p.thread_id = p_thread and p.user_id = p_target
	) then
		raise exception 'That member is not in this chat.';
	end if;

	if p_target <> v_user then
		if not exists (
			select 1 from public.vidjo_dm_participants p
			where p.thread_id = p_thread and p.user_id = v_user and p.role = 'owner'
		) then
			raise exception 'Only the group owner can rename other members.';
		end if;
	end if;

	insert into public.vidjo_dm_nicknames (thread_id, user_id, nickname)
	values (p_thread, p_target, v_name)
	on conflict (thread_id, user_id) do update set nickname = excluded.nickname;
	return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Message reports
-- ---------------------------------------------------------------------------

create table if not exists public.vidjo_dm_reports (
	id uuid primary key default gen_random_uuid(),
	message_id uuid not null references public.vidjo_dm_messages(id) on delete cascade,
	thread_id uuid not null references public.vidjo_dm_threads(id) on delete cascade,
	reporter_id uuid not null references auth.users(id) on delete cascade,
	reason text not null,
	created_at timestamptz not null default now(),
	constraint vidjo_dm_reports_reason check (char_length(btrim(reason)) between 3 and 240),
	constraint vidjo_dm_reports_once unique (message_id, reporter_id)
);

create index if not exists vidjo_dm_reports_created_idx
	on public.vidjo_dm_reports (created_at desc);

alter table public.vidjo_dm_reports enable row level security;

drop policy if exists "vidjo dm reports select" on public.vidjo_dm_reports;
create policy "vidjo dm reports select" on public.vidjo_dm_reports
	for select to authenticated
	using (
		reporter_id = auth.uid()
		or public.vidjo_is_global_admin(auth.uid())
	);

revoke all on public.vidjo_dm_reports from anon;
grant select on public.vidjo_dm_reports to authenticated;

create or replace function public.vidjo_dm_report_message(p_message uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user uuid := auth.uid();
	v_msg public.vidjo_dm_messages%rowtype;
	v_reason text := btrim(coalesce(p_reason, ''));
begin
	if v_user is null then raise exception 'Sign in to report a message.'; end if;
	if not public.vidjo_is_member() then raise exception 'Create a VidJo account first.'; end if;
	if char_length(v_reason) < 3 or char_length(v_reason) > 240 then
		raise exception 'Add a short reason (3 to 240 characters).';
	end if;

	select * into v_msg from public.vidjo_dm_messages m where m.id = p_message;
	if not found then raise exception 'Message not found.'; end if;
	if not public.vidjo_dm_is_participant(v_msg.thread_id) then
		raise exception 'Conversation not found.';
	end if;
	if v_msg.sender_id = v_user then raise exception 'You cannot report your own message.'; end if;

	insert into public.vidjo_dm_reports (message_id, thread_id, reporter_id, reason)
	values (p_message, v_msg.thread_id, v_user, v_reason)
	on conflict (message_id, reporter_id) do update set reason = excluded.reason;
	return true;
end;
$$;

create or replace function public.vidjo_admin_list_dm_reports(p_max_rows integer default 50)
returns table (
	id uuid,
	message_id uuid,
	thread_id uuid,
	reporter_id uuid,
	reporter_name text,
	sender_id uuid,
	sender_name text,
	body text,
	file_name text,
	reason text,
	created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
	if not public.vidjo_is_global_admin(auth.uid()) then
		raise exception 'Admin access required.';
	end if;

	return query
	select
		r.id, r.message_id, r.thread_id, r.reporter_id,
		coalesce(nullif(btrim(rep.display_name), ''), rep.username, 'VidJo student'),
		m.sender_id,
		coalesce(nullif(btrim(snd.display_name), ''), snd.username, 'VidJo student'),
		m.body, m.file_name, r.reason, r.created_at
	from public.vidjo_dm_reports r
	join public.vidjo_dm_messages m on m.id = r.message_id
	left join public.vidjo_profiles rep on rep.user_id = r.reporter_id
	left join public.vidjo_profiles snd on snd.user_id = m.sender_id
	order by r.created_at desc
	limit greatest(1, least(coalesce(p_max_rows, 50), 200));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sending with a document; thread reads with file metadata and nicknames
-- ---------------------------------------------------------------------------

drop function if exists public.vidjo_dm_send(uuid, text, uuid, text, text, uuid);
drop function if exists public.vidjo_dm_thread(uuid, timestamptz, integer);

create or replace function public.vidjo_dm_send(
	p_thread uuid,
	p_body text,
	p_client_id uuid,
	p_image_path text default null,
	p_gif_url text default null,
	p_reply_to uuid default null,
	p_file_path text default null,
	p_file_name text default null,
	p_file_mime text default null,
	p_file_size integer default null
)
returns table (
	id uuid,
	thread_id uuid,
	sender_id uuid,
	client_id uuid,
	body text,
	image_path text,
	gif_url text,
	created_at timestamptz,
	file_path text,
	file_name text,
	file_mime text,
	file_size integer
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
	v_file text := nullif(btrim(coalesce(p_file_path, '')), '');
	v_file_name text := nullif(btrim(coalesce(p_file_name, '')), '');
	v_file_mime text := lower(btrim(coalesce(p_file_mime, '')));
	v_file_size integer := coalesce(p_file_size, 0);
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
			v_existing.gif_url, v_existing.created_at, v_existing.file_path,
			v_existing.file_name, v_existing.file_mime, v_existing.file_size;
		return;
	end if;

	v_body := btrim(coalesce(p_body, ''));
	if char_length(v_body) = 0 and v_image is null and v_gif is null and v_file is null then
		raise exception 'Write a message first.';
	end if;
	if (case when v_image is not null then 1 else 0 end)
		+ (case when v_gif is not null then 1 else 0 end)
		+ (case when v_file is not null then 1 else 0 end) > 1 then
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

	if v_file is not null then
		if v_file !~ ('^' || p_thread::text || '/' || v_user::text ||
			'/[A-Za-z0-9][A-Za-z0-9_-]*\.(pdf|doc|docx)$') then
			raise exception 'That file could not be sent.';
		end if;
		if v_file_mime not in (
			'application/pdf',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		) then
			raise exception 'Only PDF and Word documents are allowed.';
		end if;
		if v_file_name is null or char_length(v_file_name) > 180 then
			raise exception 'That file name is too long.';
		end if;
		if v_file_size <= 0 or v_file_size > 20971520 then
			raise exception 'Files must be 20 MB or smaller.';
		end if;
		if not exists (select 1 from storage.objects o
			where o.bucket_id = 'vidjo-dm-files' and o.name = v_file) then
			raise exception 'Upload the file first.';
		end if;
	end if;

	v_body := public.vidjo_dm_validate_body(v_body);

	begin
		insert into public.vidjo_dm_messages
			(thread_id, sender_id, client_id, body, image_path, gif_url, reply_to,
			 file_path, file_name, file_mime, file_size)
		values
			(p_thread, v_user, v_client, v_body, v_image, v_gif, p_reply_to,
			 v_file, v_file_name, v_file_mime, v_file_size)
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
		v_existing.gif_url, v_existing.created_at, v_existing.file_path,
		v_existing.file_name, v_existing.file_mime, v_existing.file_size;
end;
$$;

create or replace function public.vidjo_dm_thread(
	p_thread uuid,
	p_before timestamptz default now(),
	p_limit integer default 30,
	p_pinned_only boolean default false
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
	seen_by jsonb,
	file_path text,
	file_name text,
	file_mime text,
	file_size integer
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
				select coalesce(nullif(btrim(nn.nickname), ''),
						nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student') as name,
					p.last_read_at as at
				from public.vidjo_dm_participants p
				left join public.vidjo_profiles pr on pr.user_id = p.user_id
				left join public.vidjo_dm_nicknames nn
					on nn.thread_id = p_thread and nn.user_id = p.user_id
				where p.thread_id = p_thread
					and p.user_id <> recent.sender_id
					and p.last_read_at >= recent.created_at
			) seen
		), '[]'::jsonb) as seen_by,
		recent.file_path, recent.file_name, recent.file_mime, recent.file_size
	from (
		select
			m.id, m.thread_id, m.sender_id, m.client_id,
			coalesce(nullif(btrim(nn.nickname), ''),
				nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student') as sender_name,
			coalesce(pr.username, 'student') as sender_username,
			pr.avatar_url as sender_avatar,
			m.body, m.image_path, m.gif_url, m.created_at,
			m.edited_at, m.deleted_at,
			coalesce(nullif(btrim(dp.display_name), ''), dp.username, 'Someone') as deleted_by_name,
			m.reply_to,
			coalesce(nullif(btrim(rnn.nickname), ''),
				nullif(btrim(rp.display_name), ''), rp.username, 'Someone') as reply_sender,
			case when rm.deleted_at is not null then '' else rm.body end as reply_body,
			rm.deleted_at is not null as reply_deleted,
			m.shared_entry, m.forwarded_from,
			m.file_path, m.file_name, m.file_mime, m.file_size
		from public.vidjo_dm_messages m
		left join public.vidjo_profiles pr on pr.user_id = m.sender_id
		left join public.vidjo_dm_nicknames nn
			on nn.thread_id = m.thread_id and nn.user_id = m.sender_id
		left join public.vidjo_profiles dp on dp.user_id = m.deleted_by
		left join public.vidjo_dm_messages rm on rm.id = m.reply_to
		left join public.vidjo_profiles rp on rp.user_id = rm.sender_id
		left join public.vidjo_dm_nicknames rnn
			on rnn.thread_id = m.thread_id and rnn.user_id = rm.sender_id
		where m.thread_id = p_thread
			and m.created_at < coalesce(p_before, now())
			and (not coalesce(p_pinned_only, false) or exists (
				select 1 from public.vidjo_dm_pins pin
				where pin.message_id = m.id and pin.user_id = auth.uid()
			))
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
	is_me boolean,
	nickname text
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
		coalesce(nullif(btrim(nn.nickname), ''),
			nullif(btrim(pr.display_name), ''), pr.username, 'VidJo student'),
		coalesce(pr.username, 'student'),
		pr.avatar_url,
		p.role,
		p.joined_at,
		p.user_id = auth.uid(),
		coalesce(nn.nickname, '')
	from public.vidjo_dm_participants p
	left join public.vidjo_profiles pr on pr.user_id = p.user_id
	left join public.vidjo_dm_nicknames nn
		on nn.thread_id = p.thread_id and nn.user_id = p.user_id
	where p.thread_id = p_thread
	order by (p.role = 'owner') desc, p.joined_at asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants and realtime
-- ---------------------------------------------------------------------------

revoke all on function public.vidjo_dm_send(uuid, text, uuid, text, text, uuid, text, text, text, integer) from public, anon;
grant execute on function public.vidjo_dm_send(uuid, text, uuid, text, text, uuid, text, text, text, integer) to authenticated;

revoke all on function public.vidjo_dm_thread(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function public.vidjo_dm_thread(uuid, timestamptz, integer, boolean) to authenticated;

revoke all on function public.vidjo_dm_thread_members(uuid) from public, anon;
grant execute on function public.vidjo_dm_thread_members(uuid) to authenticated;

revoke all on function public.vidjo_dm_chat_settings(uuid) from public, anon;
grant execute on function public.vidjo_dm_chat_settings(uuid) to authenticated;

revoke all on function public.vidjo_dm_set_chat_photo(uuid, text) from public, anon;
grant execute on function public.vidjo_dm_set_chat_photo(uuid, text) to authenticated;

revoke all on function public.vidjo_dm_set_chat_theme(uuid, text) from public, anon;
grant execute on function public.vidjo_dm_set_chat_theme(uuid, text) to authenticated;

revoke all on function public.vidjo_dm_set_nickname(uuid, uuid, text) from public, anon;
grant execute on function public.vidjo_dm_set_nickname(uuid, uuid, text) to authenticated;

revoke all on function public.vidjo_dm_report_message(uuid, text) from public, anon;
grant execute on function public.vidjo_dm_report_message(uuid, text) to authenticated;

revoke all on function public.vidjo_admin_list_dm_reports(integer) from public, anon;
grant execute on function public.vidjo_admin_list_dm_reports(integer) to authenticated;

do $$
declare
	t text;
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		return;
	end if;

	foreach t in array array['vidjo_dm_nicknames', 'vidjo_dm_chat_themes'] loop
		if not exists (
			select 1 from pg_publication_tables
			where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
		) then
			execute format('alter publication supabase_realtime add table public.%I', t);
		end if;
	end loop;
end;
$$;
