-- Keep profile provisioning errors from aborting Supabase account creation.
-- Users without a profile are prompted to complete one after signing in.

create or replace function public.vidjo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	begin
		if new.email_confirmed_at is not null then
			perform public.vidjo_create_profile_for_user(new.id, new.raw_user_meta_data);
		end if;
	exception
		when others then
			raise warning 'vidjo_handle_new_user profile setup failed for %: %', new.id, sqlerrm;
	end;
	return new;
end;
$$;

create or replace function public.vidjo_handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	begin
		if new.email_confirmed_at is not null
			and old.email_confirmed_at is distinct from new.email_confirmed_at
		then
			perform public.vidjo_create_profile_for_user(new.id, new.raw_user_meta_data);
		end if;
	exception
		when others then
			raise warning 'vidjo_handle_confirmed_user profile setup failed for %: %', new.id, sqlerrm;
	end;
	return new;
end;
$$;
