-- Remove empty, unused starter tables from the public schema.
--
-- VidJo only uses tables prefixed with `vidjo_`. The tables below are not
-- referenced anywhere in the app and are not created by any migration in this
-- repository, so they are almost certainly leftovers from a starter template
-- or an older project that used the same Supabase database.
--
-- This is deliberately cautious: a table is only dropped when it is empty.
-- Run in the Supabase SQL Editor. Safe to re-run.

-- Use this first if you want to see every non-VidJo table still in public:
-- select tablename
-- from pg_tables
-- where schemaname = 'public' and tablename not like 'vidjo_%'
-- order by tablename;

do $$
declare
	v_table text;
	v_rows bigint;
begin
	foreach v_table in array array[
		'subjects',
		'suggestions',
		'topics',
		'quiz_attempts',
		'programs'
	] loop
		if to_regclass('public.' || v_table) is null then
			raise notice 'Already gone: public.%', v_table;
			continue;
		end if;

		execute format('select count(*) from public.%I', v_table) into v_rows;

		if v_rows > 0 then
			raise notice 'Kept public.% because it still has % row(s).', v_table, v_rows;
			continue;
		end if;

		execute format('drop table public.%I', v_table);
		raise notice 'Dropped empty unused table public.%', v_table;
	end loop;
end $$;
