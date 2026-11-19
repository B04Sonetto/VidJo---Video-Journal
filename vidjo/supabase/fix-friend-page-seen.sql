-- VidJo friends journal: cross-device "new page" read state.
--
-- Run once in the Supabase SQL Editor, after schema.sql and the other fix
-- files. Safe to re-run. Replaces the old browser-local only read tracking
-- with a small per-user table so a page marked read on one device is read on
-- every device.

create table if not exists public.vidjo_friend_page_seen (
	user_id uuid not null references auth.users(id) on delete cascade,
	owner_id uuid not null references auth.users(id) on delete cascade,
	page_date date not null,
	seen_at timestamptz not null default now(),
	primary key (user_id, owner_id, page_date)
);

create index if not exists vidjo_friend_page_seen_user_idx
	on public.vidjo_friend_page_seen (user_id, seen_at desc);

alter table public.vidjo_friend_page_seen enable row level security;

-- A student can only ever see their own read state.
drop policy if exists "vidjo friend page seen select" on public.vidjo_friend_page_seen;
create policy "vidjo friend page seen select" on public.vidjo_friend_page_seen
	for select to authenticated
	using (user_id = auth.uid());

revoke all on public.vidjo_friend_page_seen from anon;
revoke insert, update, delete on public.vidjo_friend_page_seen from authenticated;
grant select on public.vidjo_friend_page_seen to authenticated;

-- Writes go through this RPC so a client cannot forge another user's key.
-- Takes an array of { ownerId, date } pairs to seed or sync in one request.
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

	insert into public.vidjo_friend_page_seen (user_id, owner_id, page_date)
	select distinct
		auth.uid(),
		(entry->>'ownerId')::uuid,
		(entry->>'date')::date
	from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry
	where (entry->>'ownerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		and (entry->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
	on conflict (user_id, owner_id, page_date) do nothing;
end $$;

revoke all on function public.vidjo_friend_pages_mark_seen(jsonb) from public, anon;
grant execute on function public.vidjo_friend_pages_mark_seen(jsonb) to authenticated;
