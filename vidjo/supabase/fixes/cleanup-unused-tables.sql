-- Remove empty, unused starter tables from the public schema.
--
-- VidJo only uses tables prefixed with `vidjo_`. Any other public table is a
-- leftover from a starter template or an older project. These tables often
-- reference each other with foreign keys, so they are dropped together
-- with CASCADE.
--
-- Safety rules:
--   1. Tables that contain rows are never dropped.
--   2. An empty table is also kept if a kept table has a foreign key to it.
--   3. Only tables in the `public` schema are considered.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Preview the leftovers and their row counts before running:
-- select tablename from pg_tables
-- where schemaname = 'public' and tablename not like 'vidjo_%'
-- order by tablename;

do $$
declare
	v_all text[];
	v_keep text[] := array[]::text[];
	v_empty text[];
	v_keep_oids oid[];
	v_final text[] := array[]::text[];
	v_table text;
	v_rows bigint;
	v_blocker text;
begin
	select array_agg(tablename order by tablename)
	into v_all
	from pg_tables
	where schemaname = 'public'
		and tablename not like 'vidjo_%';

	if v_all is null or array_length(v_all, 1) is null then
		raise notice 'No unused public tables found. Nothing to do.';
		return;
	end if;

	-- Never touch a table that still has data.
	foreach v_table in array v_all loop
		execute format('select count(*) from public.%I', v_table) into v_rows;
		if v_rows > 0 then
			v_keep := array_append(v_keep, v_table);
			raise notice 'Keeping public.% because it has % row(s).', v_table, v_rows;
		end if;
	end loop;

	select coalesce(array_agg(to_regclass(format('public.%I', k))::oid), array[]::oid[])
	into v_keep_oids
	from unnest(coalesce(v_keep, array[]::text[])) as k;

	select coalesce(array_agg(t order by t), array[]::text[])
	into v_empty
	from unnest(v_all) as t
	where not (t = any(coalesce(v_keep, array[]::text[])));

	-- Keep an empty table if a table we are keeping points at it.
	foreach v_table in array coalesce(v_empty, array[]::text[]) loop
		select string_agg(distinct c.conrelid::regclass::text, ', ')
		into v_blocker
		from pg_constraint c
		where c.contype = 'f'
			and c.confrelid = to_regclass(format('public.%I', v_table))::oid
			and c.conrelid = any(v_keep_oids);

		if v_blocker is not null then
			raise notice 'Keeping public.% because % depends on it.', v_table, v_blocker;
		else
			v_final := array_append(v_final, v_table);
		end if;
	end loop;

	if array_length(v_final, 1) is null then
		raise notice 'No empty unused tables to drop.';
		return;
	end if;

	foreach v_table in array v_final loop
		execute format('drop table if exists public.%I cascade', v_table);
		raise notice 'Dropped unused table public.%', v_table;
	end loop;
end $$;
