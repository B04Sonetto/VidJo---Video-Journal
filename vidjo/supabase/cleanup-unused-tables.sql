-- Remove empty, unused starter tables from the public schema.
--
-- VidJo only uses tables prefixed with `vidjo_`. Any other public table is a
-- leftover from a starter template or an older project. These tables often
-- reference each other with foreign keys, so they must be dropped together
-- with CASCADE.
--
-- Safety rules:
--   1. Every non-`vidjo_` public table must be empty. If any has rows, the
--      whole script aborts and nothing is dropped.
--   2. Only tables in the `public` schema are considered.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Preview what this will remove:
-- select tablename
-- from pg_tables
-- where schemaname = 'public' and tablename not like 'vidjo_%'
-- order by tablename;

do $$
declare
	v_tables text[];
	v_table text;
	v_rows bigint;
	v_nonempty text[] := array[]::text[];
begin
	select array_agg(tablename order by tablename)
	into v_tables
	from pg_tables
	where schemaname = 'public'
		and tablename not like 'vidjo_%';

	if v_tables is null or array_length(v_tables, 1) is null then
		raise notice 'No unused public tables found. Nothing to do.';
		return;
	end if;

	-- Refuse to touch anything that actually contains data.
	foreach v_table in array v_tables loop
		execute format('select count(*) from public.%I', v_table) into v_rows;
		if v_rows > 0 then
			v_nonempty := array_append(v_nonempty, format('%s (%s rows)', v_table, v_rows));
		end if;
	end loop;

	if array_length(v_nonempty, 1) > 0 then
		raise exception
			'Refusing to drop tables because these non-VidJo tables contain data: %',
			array_to_string(v_nonempty, ', ');
	end if;

	-- All leftovers are empty, so remove the whole starter cluster.
	foreach v_table in array v_tables loop
		execute format('drop table if exists public.%I cascade', v_table);
		raise notice 'Dropped unused table public.%', v_table;
	end loop;
end $$;
