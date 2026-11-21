-- VidJo message push notifications.
-- Run this once in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- Stores one browser push subscription per device so the dm-push Edge Function
-- can deliver a notification when a friend sends a message. The private key
-- never enters the database; only the subscription keys are stored here.

create table if not exists public.vidjo_push_subscriptions (
	endpoint text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	p256dh text not null,
	auth text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists vidjo_push_subscriptions_user_idx
	on public.vidjo_push_subscriptions (user_id);

alter table public.vidjo_push_subscriptions enable row level security;

drop policy if exists "vidjo push select own" on public.vidjo_push_subscriptions;
create policy "vidjo push select own" on public.vidjo_push_subscriptions
	for select using (auth.uid() = user_id);

drop policy if exists "vidjo push insert own" on public.vidjo_push_subscriptions;
create policy "vidjo push insert own" on public.vidjo_push_subscriptions
	for insert with check (auth.uid() = user_id);

drop policy if exists "vidjo push update own" on public.vidjo_push_subscriptions;
create policy "vidjo push update own" on public.vidjo_push_subscriptions
	for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "vidjo push delete own" on public.vidjo_push_subscriptions;
create policy "vidjo push delete own" on public.vidjo_push_subscriptions
	for delete using (auth.uid() = user_id);

revoke all on public.vidjo_push_subscriptions from anon;
grant select, insert, update, delete on public.vidjo_push_subscriptions to authenticated;

-- The Edge Function uses the service role, which bypasses RLS, to read every
-- recipient's subscription. No policy needs to expose other members' rows.

-- Verify:
--   select endpoint, user_id, updated_at from public.vidjo_push_subscriptions;
