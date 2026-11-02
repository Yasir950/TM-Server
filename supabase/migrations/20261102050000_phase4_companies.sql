-- Phase 4: company accounts (Slack workspaces), invitations, join requests, company + member profiles

-- Tables ----------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  logo_url text,
  email text not null default '',
  phone text not null default '',
  industry text not null default '',
  size text not null default '',
  website text not null default '',
  address text not null default '',
  description text not null default '' check (length(description) <= 500),
  owner_id uuid references public.profiles on delete set null,
  allow_join_requests boolean not null default true,
  members_can_invite boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid references public.companies on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'guest')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  designation text not null default '',
  department text not null default '',
  phone text not null default '',
  phone_visible boolean not null default false,
  invited_by uuid references public.profiles on delete set null,
  joined_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);

-- One row per email invitation (email set) or shareable invite link (email null)
create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  email text,
  role text not null default 'member' check (role in ('admin', 'member', 'guest')),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  invited_by uuid references public.profiles on delete set null,
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.join_requests (
  company_id uuid references public.companies on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.company_domains (
  domain text primary key check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  company_id uuid not null references public.companies on delete cascade
);

alter table public.profiles add column current_company_id uuid references public.companies on delete set null;
alter table public.channels add column company_id uuid references public.companies on delete cascade;

-- Backfill: the existing single workspace becomes the first company ------

do $$
declare cid uuid; own uuid;
begin
  if exists (select 1 from profiles) then
    select id into own from profiles order by (role = 'owner') desc, created_at limit 1;
    insert into companies (name, handle, owner_id) values ('My Company', 'my-company', own) returning id into cid;
    insert into company_members (company_id, user_id, role) select cid, id, role from profiles;
    update channels set company_id = cid;
    update profiles set current_company_id = cid;
  end if;
end $$;

drop index public.channels_name_key;
create unique index channels_name_key on public.channels (company_id, lower(name)) where kind <> 'dm';

-- Helpers ---------------------------------------------------------------

create or replace function public.current_company() returns uuid
language sql stable security definer set search_path = public as $$
  select current_company_id from profiles where id = auth.uid();
$$;

-- Caller's role in a company, null when not an active member
create or replace function public.company_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from company_members where company_id = cid and user_id = auth.uid() and status = 'active';
$$;

create or replace function public.is_company_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(company_role(cid) in ('owner', 'admin'), false);
$$;

-- Existing admin policies and RPCs now mean "admin of the company you are in"
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select is_company_admin(current_company());
$$;

create or replace function public.shares_company(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select uid = auth.uid() or exists (
    select 1 from company_members a join company_members b on a.company_id = b.company_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = uid
  );
$$;

-- Channel membership only counts while you are an active member of the channel's company
create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channel_members cm join channels c on c.id = cm.channel_id
    where cm.channel_id = cid and cm.user_id = auth.uid() and company_role(c.company_id) is not null
  );
$$;

-- Guests only see channels they were added to
create or replace function public.can_read(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channels where id = cid and kind = 'public' and company_role(company_id) in ('owner', 'admin', 'member'))
    or is_member(cid);
$$;

-- Adds a user to a company, puts them in its #general and makes it their current company
create or replace function public.add_company_member(cid uuid, uid uuid, p_role text, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare general uuid;
begin
  perform set_config('app.company_rpc', 'on', true);
  insert into company_members (company_id, user_id, role, invited_by) values (cid, uid, p_role, p_by)
  on conflict (company_id, user_id) do update set status = 'active';
  if p_role <> 'guest' then
    select id into general from channels where company_id = cid and kind = 'public' and lower(name) = 'general';
    if general is null then
      insert into channels (name, kind, topic, created_by, company_id)
      values ('general', 'public', 'Company-wide announcements and chat', uid, cid) returning id into general;
    end if;
    insert into channel_members (channel_id, user_id) values (general, uid) on conflict do nothing;
  end if;
  update profiles set current_company_id = cid where id = uid;
  update join_requests set status = 'approved' where company_id = cid and user_id = uid;
end $$;
revoke execute on function public.add_company_member(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Role and status only change through the RPCs below (they set app.company_rpc)
create or replace function public.guard_company_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.company_rpc', true), '') <> 'on'
     and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'use the member management actions to change roles or status';
  end if;
  -- Admins may edit another member's designation and department, nothing else of theirs
  if auth.uid() is not null and new.user_id <> auth.uid() and coalesce(current_setting('app.company_rpc', true), '') <> 'on'
     and (new.phone is distinct from old.phone or new.phone_visible is distinct from old.phone_visible) then
    raise exception 'only the member can change their phone number';
  end if;
  return new;
end $$;
create trigger company_members_guard before update on public.company_members
for each row execute function public.guard_company_member();

-- New auth user: profile only; join a company whose verified domain matches the email
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))), '[^a-z0-9_.-]', '', 'g');
  uname text := base;
  cid uuid;
begin
  if uname = '' then uname := 'user'; base := 'user'; end if;
  while exists (select 1 from profiles where username = uname) loop
    uname := base || floor(random() * 10000)::text;
  end loop;
  insert into profiles (id, username, full_name)
  values (new.id, uname, coalesce(new.raw_user_meta_data->>'full_name', ''));

  select company_id into cid from company_domains where domain = lower(split_part(new.email, '@', 2));
  if cid is not null then perform add_company_member(cid, new.id, 'member', null); end if;
  return new;
end $$;

-- The company owner is the owner now, not the first person to sign up
drop trigger if exists profiles_first_owner on public.profiles;

-- Channels and DMs belong to the current company --------------------------

create or replace function public.create_channel(p_name text, p_kind text, p_topic text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; co uuid := current_company();
begin
  if p_kind not in ('public', 'private') then raise exception 'invalid kind'; end if;
  if coalesce(company_role(co), 'guest') = 'guest' then raise exception 'guests cannot create channels'; end if;
  insert into channels (name, kind, topic, created_by, company_id)
  values (lower(regexp_replace(trim(p_name), '\s+', '-', 'g')), p_kind, coalesce(p_topic, ''), auth.uid(), co)
  returning id into cid;
  insert into channel_members (channel_id, user_id) values (cid, auth.uid());
  return cid;
end $$;

create or replace function public.get_or_create_dm(p_user_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ids uuid[] := array(select distinct unnest(p_user_ids || auth.uid()) order by 1);
  co uuid := current_company();
  cid uuid;
begin
  if array_length(ids, 1) > 9 then raise exception 'group DMs are limited to 9 people'; end if;
  if exists (select 1 from unnest(ids) u where not exists (
    select 1 from company_members where company_id = co and user_id = u and status = 'active')) then
    raise exception 'everyone in a DM must be in this company';
  end if;
  select c.id into cid from channels c
  where c.kind = 'dm' and c.company_id = co
    and array(select user_id from channel_members m where m.channel_id = c.id order by 1) = ids
  limit 1;
  if cid is null then
    insert into channels (kind, created_by, company_id) values ('dm', auth.uid(), co) returning id into cid;
    insert into channel_members (channel_id, user_id) select cid, unnest(ids);
  end if;
  return cid;
end $$;

-- Public channels can only be joined by non-guest members of their company
drop policy "join or add" on public.channel_members;
create policy "join or add" on public.channel_members for insert to authenticated with check (
  (user_id = auth.uid() and exists (
    select 1 from channels where id = channel_id and kind = 'public' and company_role(company_id) in ('owner', 'admin', 'member')))
  or (is_member(channel_id) and exists (
    select 1 from channels c join company_members m on m.company_id = c.company_id
    where c.id = channel_id and c.kind <> 'dm' and m.user_id = channel_members.user_id and m.status = 'active'))
);

drop policy "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (shares_company(id));

-- Company RPCs ------------------------------------------------------------

create or replace function public.create_company(p_name text, p_handle text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  insert into companies (name, handle, owner_id) values (trim(p_name), lower(trim(p_handle)), auth.uid()) returning id into cid;
  perform add_company_member(cid, auth.uid(), 'owner', null);
  return cid;
end $$;

create or replace function public.switch_company(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if company_role(p_company) is null then raise exception 'not a member of that company'; end if;
  update profiles set current_company_id = p_company where id = auth.uid();
end $$;

-- Email invitations: one row per address, returns the tokens for the join links
create or replace function public.invite_members(p_emails text[], p_role text default 'member')
returns table (email text, token text) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare co uuid := current_company();
begin
  if not (is_admin() or (company_role(co) = 'member' and (select members_can_invite from companies where id = co))) then
    raise exception 'you cannot invite people to this company';
  end if;
  if p_role not in ('admin', 'member', 'guest') or (p_role = 'admin' and not is_admin()) then raise exception 'invalid role'; end if;
  return query
    with ins as (
      insert into company_invites (company_id, email, role, invited_by, max_uses)
      select co, lower(trim(e)), p_role, auth.uid(), 1 from unnest(p_emails) e where trim(e) <> ''
      returning company_invites.email, company_invites.token
    )
    select ins.email, ins.token from ins;
end $$;

create or replace function public.create_invite_link(p_role text, p_days int, p_max_uses int default null) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_role not in ('member', 'guest') or p_days not in (1, 7, 30) then raise exception 'invalid link settings'; end if;
  insert into company_invites (company_id, role, invited_by, max_uses, expires_at)
  values (current_company(), p_role, auth.uid(), p_max_uses, now() + make_interval(days => p_days)) returning token into t;
  return t;
end $$;

create or replace function public.revoke_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update company_invites set revoked_at = now() where id = p_id and is_company_admin(company_id);
end $$;

-- What an invite link points at, shown before accepting
create or replace function public.invite_info(p_token text)
returns table (company_name text, company_logo text, role text, valid boolean)
language sql stable security definer set search_path = public as $$
  select c.name, c.logo_url, i.role,
         i.revoked_at is null and i.expires_at > now() and (i.max_uses is null or i.uses < i.max_uses)
  from company_invites i join companies c on c.id = i.company_id where i.token = p_token;
$$;

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv company_invites;
begin
  select * into inv from company_invites where token = p_token for update;
  if inv.id is null or inv.revoked_at is not null or inv.expires_at < now() or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'this invitation is invalid or has expired';
  end if;
  if inv.email is not null and inv.email <> lower((select email from auth.users where id = auth.uid())) then
    raise exception 'this invitation was sent to a different email address';
  end if;
  update company_invites set uses = uses + 1 where id = inv.id;
  if company_role(inv.company_id) is null then
    perform set_config('app.company_rpc', 'on', true);
    perform add_company_member(inv.company_id, auth.uid(), inv.role, inv.invited_by);
  else
    update profiles set current_company_id = inv.company_id where id = auth.uid();
  end if;
  return inv.company_id;
end $$;

-- Lets people find a company by its handle to ask to join
create or replace function public.find_company(p_handle text)
returns table (id uuid, name text, logo_url text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.logo_url, (select count(*) from company_members m where m.company_id = c.id and m.status = 'active')
  from companies c where c.handle = lower(trim(p_handle)) and c.allow_join_requests;
$$;

create or replace function public.request_join(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (select allow_join_requests from companies where id = p_company) then raise exception 'this company does not accept join requests'; end if;
  insert into join_requests (company_id, user_id) values (p_company, auth.uid())
  on conflict (company_id, user_id) do update set status = 'pending', created_at = now();
end $$;

create or replace function public.review_join(p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from join_requests where company_id = co and user_id = p_user and status = 'pending') then
    raise exception 'no pending request';
  end if;
  if p_approve then
    perform set_config('app.company_rpc', 'on', true);
    perform add_company_member(co, p_user, 'member', auth.uid());
    -- add_company_member switched the requester's current company; that's what they asked for
  else
    update join_requests set status = 'declined', reviewed_by = auth.uid() where company_id = co and user_id = p_user;
  end if;
end $$;

-- Requesters are not company members yet, so their profile is not otherwise readable
create or replace function public.pending_join_requests()
returns table (user_id uuid, full_name text, username text, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, p.full_name, p.username, u.email, r.created_at
  from join_requests r join profiles p on p.id = r.user_id join auth.users u on u.id = r.user_id
  where r.company_id = current_company() and r.status = 'pending' and is_admin()
  order by r.created_at;
$$;

create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_role not in ('admin', 'member', 'guest') then raise exception 'invalid role'; end if;
  if (select role from company_members where company_id = co and user_id = p_user) = 'owner' then raise exception 'the owner role cannot be changed'; end if;
  perform set_config('app.company_rpc', 'on', true);
  update company_members set role = p_role where company_id = co and user_id = p_user;
end $$;

create or replace function public.set_member_status(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if (select role from company_members where company_id = co and user_id = p_user) = 'owner' then raise exception 'the owner cannot be deactivated'; end if;
  perform set_config('app.company_rpc', 'on', true);
  update company_members set status = case when p_active then 'active' else 'deactivated' end where company_id = co and user_id = p_user;
end $$;

create or replace function public.transfer_ownership(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if company_role(co) <> 'owner' then raise exception 'only the owner can transfer ownership'; end if;
  if (select role from company_members where company_id = co and user_id = p_user and status = 'active') is null then
    raise exception 'the new owner must be an active member';
  end if;
  perform set_config('app.company_rpc', 'on', true);
  update company_members set role = 'admin' where company_id = co and user_id = auth.uid();
  update company_members set role = 'owner' where company_id = co and user_id = p_user;
  update companies set owner_id = p_user where id = co;
end $$;

create or replace function public.leave_company() returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if company_role(co) = 'owner' then raise exception 'transfer ownership before leaving'; end if;
  delete from channel_members where user_id = auth.uid() and channel_id in (select id from channels where company_id = co and kind <> 'dm');
  delete from company_members where company_id = co and user_id = auth.uid();
  update profiles set current_company_id = (select company_id from company_members where user_id = auth.uid() and status = 'active' limit 1)
  where id = auth.uid();
end $$;

create or replace function public.delete_company() returns void
language plpgsql security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if company_role(co) <> 'owner' then raise exception 'only the owner can delete the company'; end if;
  delete from companies where id = co;
  update profiles p set current_company_id = (select company_id from company_members m where m.user_id = p.id and m.status = 'active' limit 1)
  where current_company_id is null;
end $$;

-- Members directory with details masked by the viewer's role
create or replace function public.company_directory()
returns table (user_id uuid, role text, status text, designation text, department text, email text, phone text,
               phone_visible boolean, joined_at timestamptz, invited_by uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, m.status, m.designation, m.department,
         case when is_admin() or m.user_id = auth.uid() or company_role(m.company_id) <> 'guest' then u.email end,
         case when is_admin() or m.user_id = auth.uid() or (m.phone_visible and company_role(m.company_id) <> 'guest') then m.phone else '' end,
         m.phone_visible, m.joined_at,
         case when is_admin() then m.invited_by end,
         case when is_admin() then u.last_sign_in_at end
  from company_members m join auth.users u on u.id = m.user_id
  where m.company_id = current_company() and company_role(m.company_id) is not null
    and (is_admin() or m.status = 'active');
$$;

create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return json_build_object(
    'members', (select count(*) from company_members where company_id = co and status = 'active'),
    'channels', (select count(*) from channels where company_id = co and kind <> 'dm' and not archived),
    'messages_7d', (select count(*) from messages m join channels c on c.id = m.channel_id where c.company_id = co and m.created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct m.user_id) from messages m join channels c on c.id = m.channel_id
                  where c.company_id = co and m.created_at > now() - interval '7 days' and m.bot_name is null),
    'daily', (
      select coalesce(json_agg(json_build_object('day', d, 'count', n) order by d), '[]')
      from (select m.created_at::date d, count(*) n from messages m join channels c on c.id = m.channel_id
            where c.company_id = co and m.created_at > now() - interval '14 days' group by 1) t
    ),
    'top_channels', (
      select coalesce(json_agg(json_build_object('name', name, 'count', n)), '[]')
      from (
        select c.name, count(*) n from messages m join channels c on c.id = m.channel_id
        where c.company_id = co and c.kind <> 'dm' and m.created_at > now() - interval '30 days'
        group by c.name order by n desc limit 5
      ) t
    )
  );
end $$;

-- RLS -------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.join_requests enable row level security;
alter table public.company_domains enable row level security;

create policy "members read company" on public.companies for select to authenticated using (company_role(id) is not null);
create policy "admins edit company" on public.companies for update to authenticated using (is_company_admin(id));

create policy "co-members readable" on public.company_members for select to authenticated using (company_role(company_id) is not null);
create policy "edit own or as admin" on public.company_members for update to authenticated
  using (user_id = auth.uid() or is_company_admin(company_id));

create policy "admins read invites" on public.company_invites for select to authenticated using (is_company_admin(company_id));

create policy "requests readable" on public.join_requests for select to authenticated
  using (user_id = auth.uid() or is_company_admin(company_id));
create policy "withdraw request" on public.join_requests for delete to authenticated using (user_id = auth.uid());

create policy "domains readable" on public.company_domains for select to authenticated using (company_role(company_id) is not null);
create policy "owner adds domains" on public.company_domains for insert to authenticated with check (company_role(company_id) = 'owner');
create policy "owner removes domains" on public.company_domains for delete to authenticated using (company_role(company_id) = 'owner');

alter publication supabase_realtime add table public.company_members, public.join_requests;

-- Storage: profile photos at <user id>/..., company logos at company/<company id>/... ----

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload own avatar or company logo" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'company' and public.is_company_admin(((storage.foldername(name))[2])::uuid))
  )
);
create policy "replace own avatar or company logo" on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'company' and public.is_company_admin(((storage.foldername(name))[2])::uuid))
  )
);
