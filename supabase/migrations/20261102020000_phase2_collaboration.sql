-- Phase 2: roles + admin dashboard, message retention, reminders, slash-command support

-- Roles -----------------------------------------------------------------

alter table public.profiles
  add column role text not null default 'member' check (role in ('owner', 'admin', 'member'));
update public.profiles set role = 'owner' where id = (select id from public.profiles order by created_at limit 1);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin'));
$$;

-- The first person to sign up owns the workspace
create or replace function public.first_profile_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles) then new.role := 'owner'; end if;
  return new;
end $$;
create trigger profiles_first_owner before insert on public.profiles
for each row execute function public.first_profile_owner();

-- "own profile" lets users update their row, so block self-promotion (SQL editor / service role has no auth.uid())
create or replace function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not is_admin() then
    raise exception 'only admins can change roles';
  end if;
  return new;
end $$;
create trigger profiles_guard_role before update on public.profiles
for each row execute function public.guard_role();

create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_role not in ('admin', 'member') then raise exception 'invalid role'; end if;
  if (select role from profiles where id = p_user) = 'owner' then raise exception 'the owner role cannot be changed'; end if;
  update profiles set role = p_role where id = p_user;
end $$;

-- Members can add people to any non-DM channel they belong to (/invite)
drop policy "join or add" on public.channel_members;
create policy "join or add" on public.channel_members for insert to authenticated with check (
  (user_id = auth.uid() and exists (select 1 from channels where id = channel_id and kind = 'public'))
  or (is_member(channel_id) and exists (select 1 from channels where id = channel_id and kind <> 'dm'))
);

-- Admin dashboard -------------------------------------------------------

create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return json_build_object(
    'members', (select count(*) from profiles),
    'channels', (select count(*) from channels where kind <> 'dm' and not archived),
    'messages_7d', (select count(*) from messages where created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct user_id) from messages where created_at > now() - interval '7 days' and bot_name is null),
    'daily', (
      select coalesce(json_agg(json_build_object('day', d, 'count', n) order by d), '[]')
      from (select created_at::date d, count(*) n from messages where created_at > now() - interval '14 days' group by 1) t
    ),
    'top_channels', (
      select coalesce(json_agg(json_build_object('name', name, 'count', n)), '[]')
      from (
        select c.name, count(*) n from messages m join channels c on c.id = m.channel_id
        where c.kind <> 'dm' and m.created_at > now() - interval '30 days'
        group by c.name order by n desc limit 5
      ) t
    )
  );
end $$;

-- Retention -------------------------------------------------------------

create table public.workspace_settings (
  id boolean primary key default true check (id),   -- single row
  retention_days int check (retention_days is null or retention_days >= 1),
  updated_at timestamptz not null default now()
);
insert into public.workspace_settings default values;
alter table public.workspace_settings enable row level security;
create policy "settings readable" on public.workspace_settings for select to authenticated using (true);
create policy "admins update settings" on public.workspace_settings for update to authenticated using (is_admin());

-- Deletes messages older than the retention window; pinned messages are kept
create or replace function public.apply_retention() returns bigint
language plpgsql security definer set search_path = public as $$
declare d int; n bigint;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'admins only'; end if;
  select retention_days into d from workspace_settings;
  if d is null then return 0; end if;
  delete from messages where created_at < now() - make_interval(days => d) and pinned_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Reminders -------------------------------------------------------------

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  text text not null check (length(text) between 1 and 1000),
  remind_at timestamptz not null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_due_idx on public.reminders (remind_at) where done_at is null;
alter table public.reminders enable row level security;
create policy "own reminders" on public.reminders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Posts due reminders into each user's self-DM. Called by clients for their own reminders, or by cron for everyone.
create or replace function public.fire_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r reminders; dm uuid; n int := 0;
begin
  for r in
    select * from reminders
    where done_at is null and remind_at <= now() and (auth.uid() is null or user_id = auth.uid())
    for update skip locked
  loop
    select c.id into dm from channels c
    where c.kind = 'dm' and array(select user_id from channel_members m where m.channel_id = c.id) = array[r.user_id]
    limit 1;
    if dm is null then
      insert into channels (kind, created_by) values ('dm', r.user_id) returning id into dm;
      insert into channel_members (channel_id, user_id) values (dm, r.user_id);
    end if;
    insert into messages (channel_id, user_id, body, bot_name) values (dm, r.user_id, '⏰ Reminder: ' || r.text, 'Reminders');
    update reminders set done_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Schedule background jobs where pg_cron is available; clients also poll fire_reminders
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('tm-reminders', '* * * * *', 'select public.fire_reminders()');
    perform cron.schedule('tm-retention', '17 3 * * *', 'select public.apply_retention()');
  end if;
end $$;
