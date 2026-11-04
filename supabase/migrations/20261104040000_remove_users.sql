-- Removing people.
--   remove_member: company owners/admins (and super admins, who are owner of every company) take
--     someone out of a company. Their messages stay; they lose the company, its channels and projects.
--   platform_delete_user: super admins delete an account from the platform entirely.

create or replace function public.remove_member(p_user uuid, p_company uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := coalesce(p_company, current_company());
begin
  if coalesce(company_role(co), '') not in ('owner', 'admin') then raise exception 'admins only'; end if;
  if p_user = auth.uid() then raise exception 'use Leave company to remove yourself'; end if;
  if not exists (select 1 from company_members where company_id = co and user_id = p_user) then
    raise exception 'that person is not in this company';
  end if;
  if (select role from company_members where company_id = co and user_id = p_user) = 'owner' then
    raise exception 'the owner cannot be removed; transfer ownership first';
  end if;
  delete from channel_members where user_id = p_user and channel_id in (select id from channels where company_id = co and kind <> 'dm');
  delete from project_members where user_id = p_user and project_id in (select id from projects where company_id = co);
  delete from company_members where company_id = co and user_id = p_user;
  update profiles set current_company_id = (select company_id from company_members where user_id = p_user and status = 'active' limit 1)
  where id = p_user and (current_company_id = co or current_company_id is null);
end $$;

create or replace function public.platform_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare owned text;
begin
  if not is_super_admin() then raise exception 'super admins only'; end if;
  if p_user = auth.uid() then raise exception 'you cannot delete your own account here'; end if;
  select string_agg(name, ', ') into owned from companies where owner_id = p_user;
  if owned is not null then
    raise exception 'this user owns %; transfer ownership or delete the company first', owned;
  end if;
  -- profiles and everything referencing them cascade from auth.users
  delete from auth.users where id = p_user;
end $$;

revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.platform_delete_user(uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.platform_delete_user(uuid) to authenticated;
