-- ---------------------------------------------------------------------------
-- Hotfix: "Error running hook URI: pg-functions://postgres/public/vidjo_block_deleted_signup"
-- ---------------------------------------------------------------------------
-- Symptom: every signup fails with "could not sign in" because the Before User
-- Created hook raises a runtime error. The cause was a PL/pgSQL variable named
-- `email` shadowing the `email` column of vidjo_deleted_accounts, which makes
-- Postgres abort the query with: column reference "email" is ambiguous.
--
-- Paste this whole file into the Supabase SQL editor and run it. It is safe to
-- run more than once.
--
-- While you are in the dashboard, check Authentication -> Hooks -> Before User
-- Created still points at public.vidjo_block_deleted_signup.
--
-- To restore signups *before* running this file, temporarily disable that hook
-- in Authentication -> Hooks. Re-enable it after the SQL succeeds.

create table if not exists public.vidjo_deleted_accounts (
	email text primary key,
	user_id uuid,
	deleted_at timestamptz not null default now()
);

alter table public.vidjo_deleted_accounts enable row level security;

create or replace function public.vidjo_block_deleted_signup(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	-- Named v_email so it cannot shadow vidjo_deleted_accounts.email.
	v_email text := lower(coalesce(event->'user'->>'email', ''));
	v_blocked boolean := false;
begin
	begin
		if v_email <> '' then
			select exists (
				select 1 from public.vidjo_deleted_accounts d where d.email = v_email
			) into v_blocked;
		end if;
	exception
		when others then
			-- A failure here would block every signup, so log and allow instead.
			raise warning 'vidjo_block_deleted_signup skipped: %', sqlerrm;
			return '{}'::jsonb;
	end;

	if v_blocked then
		return jsonb_build_object(
			'error', jsonb_build_object(
				'message', 'This email belonged to a deleted VidJo account. Ask a moderator to restore it before signing up again.',
				'http_code', 403
			)
		);
	end if;

	return '{}'::jsonb;
end;
$$;

grant execute on function public.vidjo_block_deleted_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.vidjo_block_deleted_signup(jsonb) from authenticated, anon, public;

-- The hook runs as supabase_auth_admin, but SECURITY DEFINER means it executes
-- with the owner's rights. Confirm the owner can read the table:
--   select public.vidjo_block_deleted_signup(
--     '{"user":{"email":"test@example.com"}}'::jsonb
--   );
-- Expected result: {}
