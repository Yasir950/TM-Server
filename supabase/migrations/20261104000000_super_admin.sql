-- Super admins: platform operators who see every company and act as its owner.
-- Grant the first one from the SQL editor (service role), e.g.
--   insert into public.super_admins (user_id) select id from auth.users where email = 'you@example.com';
-- After that, super admins can grant and revoke each other from the Super admin view.

create table public.super_admins (
  user_id uuid primary key references public.profiles on delete cascade,
  granted_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
alter table public.super_admins enable row level security;
create policy "see own grant" on public.super_admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from super_admins where user_id = auth.uid());
$$;

-- Access ------------------------------------------------------------------

-- Super admins are owner of every company, so every admin/owner check passes for them
create or replace function public.company_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'owner' from companies where id = cid and is_super_admin()),
    (select role from company_members where company_id = cid and user_id = auth.uid() and status = 'active')
  );
$$;

-- Super admins also read private channels and DMs of the company they are viewing
create or replace function public.can_read(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channels where id = cid and kind = 'public' and company_role(company_id) in ('owner', 'admin', 'member'))
    or is_member(cid)
    or (is_super_admin() and exists (select 1 from channels where id = cid and company_id = current_company()));
$$;

-- ...and the profiles of that company's members
create or replace function public.shares_company(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select uid = auth.uid() or exists (
    select 1 from company_members a join company_members b on a.company_id = b.company_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = uid
  ) or (is_super_admin() and exists (select 1 from company_members where company_id = current_company() and user_id = uid));
$$;

-- company_role() no longer means "my membership row" for super admins: these two look at the row itself

create or replace function public.transfer_ownership(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if company_role(co) <> 'owner' then raise exception 'only the owner can transfer ownership'; end if;
  if (select role from company_members where company_id = co and user_id = p_user and status = 'active') is null then
    raise exception 'the new owner must be an active member';
  end if;
  perform set_config('app.company_rpc', 'on', true);
  update company_members set role = 'admin' where company_id = co and role = 'owner';
  update company_members set role = 'owner' where company_id = co and user_id = p_user;
  update companies set owner_id = p_user where id = co;
end $$;

create or replace function public.leave_company() returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if (select role from company_members where company_id = co and user_id = auth.uid()) = 'owner' then
    raise exception 'transfer ownership before leaving';
  end if;
  delete from channel_members where user_id = auth.uid() and channel_id in (select id from channels where company_id = co and kind <> 'dm');
  delete from company_members where company_id = co and user_id = auth.uid();
  update profiles set current_company_id = (select company_id from company_members where user_id = auth.uid() and status = 'active' limit 1)
  where id = auth.uid();
end $$;

-- Platform RPCs -------------------------------------------------------------

create or replace function public.platform_stats() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'super admins only'; end if;
  return json_build_object(
    'companies', (select count(*) from companies),
    'companies_30d', (select count(*) from companies where created_at > now() - interval '30 days'),
    'users', (select count(*) from profiles),
    'users_30d', (select count(*) from profiles where created_at > now() - interval '30 days'),
    'channels', (select count(*) from channels where kind <> 'dm'),
    'messages', (select count(*) from messages),
    'messages_7d', (select count(*) from messages where created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct user_id) from messages where created_at > now() - interval '7 days' and bot_name is null),
    'daily_companies', (
      select coalesce(json_agg(json_build_object('day', d, 'count', n) order by d), '[]')
      from (select created_at::date d, count(*) n from companies where created_at > now() - interval '30 days' group by 1) t
    )
  );
end $$;

create or replace function public.platform_companies()
returns table (id uuid, name text, handle text, logo_url text, created_at timestamptz, owner_id uuid, owner_name text, owner_email text,
               members bigint, channels bigint, messages bigint, messages_7d bigint, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.handle, c.logo_url, c.created_at, c.owner_id, coalesce(nullif(p.full_name, ''), p.username), u.email::text,
         (select count(*) from company_members m where m.company_id = c.id and m.status = 'active'),
         (select count(*) from channels ch where ch.company_id = c.id and ch.kind <> 'dm'),
         s.messages, s.messages_7d, s.last_activity
  from companies c
  left join profiles p on p.id = c.owner_id
  left join auth.users u on u.id = c.owner_id
  left join lateral (
    select count(*) messages, count(*) filter (where m.created_at > now() - interval '7 days') messages_7d, max(m.created_at) last_activity
    from messages m join channels ch on ch.id = m.channel_id where ch.company_id = c.id
  ) s on true
  where is_super_admin()
  order by c.created_at desc;
$$;

-- Every conversation in a company, DMs included, with the people in each DM
create or replace function public.platform_company_channels(p_company uuid)
returns table (id uuid, name text, kind text, archived boolean, members bigint, messages bigint, last_activity timestamptz, people text)
language sql stable security definer set search_path = public as $$
  select ch.id, ch.name, ch.kind, ch.archived,
         (select count(*) from channel_members cm where cm.channel_id = ch.id),
         (select count(*) from messages m where m.channel_id = ch.id),
         (select max(m.created_at) from messages m where m.channel_id = ch.id),
         case when ch.kind = 'dm' then (
           select string_agg(coalesce(nullif(p.full_name, ''), p.username), ', ')
           from channel_members cm join profiles p on p.id = cm.user_id where cm.channel_id = ch.id
         ) end
  from channels ch
  where ch.company_id = p_company and is_super_admin()
  order by ch.kind = 'dm', 7 desc nulls last;
$$;

create or replace function public.platform_users()
returns table (id uuid, full_name text, username text, avatar_url text, email text, created_at timestamptz,
               last_sign_in_at timestamptz, super_admin boolean, companies json)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.username, p.avatar_url, u.email::text, p.created_at, u.last_sign_in_at,
         exists (select 1 from super_admins s where s.user_id = p.id),
         coalesce((
           select json_agg(json_build_object('id', c.id, 'name', c.name, 'role', m.role, 'status', m.status) order by c.name)
           from company_members m join companies c on c.id = m.company_id where m.user_id = p.id
         ), '[]')
  from profiles p join auth.users u on u.id = p.id
  where is_super_admin()
  order by p.created_at desc;
$$;

create or replace function public.platform_delete_company(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'super admins only'; end if;
  delete from companies where id = p_company;
  update profiles p set current_company_id = (select company_id from company_members m where m.user_id = p.id and m.status = 'active' limit 1)
  where current_company_id is null;
end $$;

create or replace function public.set_super_admin(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'super admins only'; end if;
  if p_user = auth.uid() and not p_on then raise exception 'you cannot remove your own super admin access'; end if;
  if p_on then
    insert into super_admins (user_id, granted_by) values (p_user, auth.uid()) on conflict do nothing;
  else
    delete from super_admins where user_id = p_user;
  end if;
end $$;
