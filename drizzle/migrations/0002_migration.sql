
create or replace function public.username_available(_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(_username))
$$;
grant execute on function public.username_available(text) to anon, authenticated;
