-- VidJo: remove stale vidjo_dm_send overloads
--
-- Symptom: messaging fails with
--   "Could not choose the best candidate function between:
--    public.vidjo_dm_send(...6 args...), public.vidjo_dm_send(...10 args...)"
--
-- Cause: schema.sql creates a 5-argument vidjo_dm_send, fix-messaging-features.sql
-- adds a 6-argument one, and fix-chat-upgrades.sql adds the current 10-argument
-- one. Each migration only drops the immediately older signature. Re-running an
-- older migration (the README recommends re-running schema.sql) recreates the
-- old signatures. Because every overload has defaults on its trailing
-- parameters, a call naming only the first few arguments matches several
-- functions and PostgreSQL cannot pick one.
--
-- Run this ONCE in Dashboard -> SQL -> New query after fix-chat-upgrades.sql.
-- It is safe to re-run. The app also now names all ten arguments on every send,
-- so future accidental overloads can no longer break message sending.

begin;

do $$
begin
	if not exists (
		select 1
		from pg_proc p
		where p.proname = 'vidjo_dm_send'
			and p.pronamespace = 'public'::regnamespace
			and p.pronargs = 10
	) then
		raise exception
			'Current vidjo_dm_send(..., p_file_size integer) is missing. Run fix-chat-upgrades.sql first.';
	end if;

	-- Only the attachment-aware 10-argument function should remain.
	execute 'drop function if exists public.vidjo_dm_send(uuid, text, uuid)';
	execute 'drop function if exists public.vidjo_dm_send(uuid, text, uuid, text)';
	execute 'drop function if exists public.vidjo_dm_send(uuid, text, uuid, text, text)';
	execute 'drop function if exists public.vidjo_dm_send(uuid, text, uuid, text, text, uuid)';

	-- Threads have the same pattern: keep only the pinned-aware signature.
	if exists (
		select 1
		from pg_proc p
		where p.proname = 'vidjo_dm_thread'
			and p.pronamespace = 'public'::regnamespace
			and p.pronargs = 4
	) then
		execute 'drop function if exists public.vidjo_dm_thread(uuid, timestamptz, integer)';
	end if;
end $$;

revoke all on function public.vidjo_dm_send(uuid, text, uuid, text, text, uuid, text, text, text, integer) from public, anon;
grant execute on function public.vidjo_dm_send(uuid, text, uuid, text, text, uuid, text, text, text, integer) to authenticated;

commit;

-- Verify: this must return exactly one row.
-- select p.oid::regprocedure as signature
-- from pg_proc p
-- where p.proname = 'vidjo_dm_send'
--   and p.pronamespace = 'public'::regnamespace
-- order by p.pronargs;
