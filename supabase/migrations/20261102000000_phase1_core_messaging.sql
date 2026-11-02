-- Phase 1: core messaging (channels, DMs, threads, reactions, files, read cursors)

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text,                                   -- null for DMs
  topic text not null default '',
  kind text not null check (kind in ('public', 'private', 'dm')),
  created_by uuid references public.profiles on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index channels_name_key on public.channels (lower(name)) where kind <> 'dm';

create table public.channel_members (
  channel_id uuid references public.channels on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  parent_id uuid references public.messages on delete cascade,
  body text not null default '',
  attachments jsonb not null default '[]',     -- [{name, path, size, type}]
  mentions uuid[] not null default '{}',
  reply_count int not null default 0,
  last_reply_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_channel_idx on public.messages (channel_id, created_at desc) where parent_id is null;
create index messages_parent_idx on public.messages (parent_id, created_at);

create table public.reactions (
  message_id uuid references public.messages on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  emoji text not null,
  channel_id uuid not null references public.channels on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.reactions replica identity full;

-- Helpers ---------------------------------------------------------------

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channel_members where channel_id = cid and user_id = auth.uid());
$$;

create or replace function public.can_read(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channels where id = cid and kind = 'public') or is_member(cid);
$$;

-- New auth user -> profile + join #general
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))), '[^a-z0-9_.-]', '', 'g');
  uname text := base;
  general uuid;
begin
  if uname = '' then uname := 'user'; base := 'user'; end if;
  while exists (select 1 from profiles where username = uname) loop
    uname := base || floor(random() * 10000)::text;
  end loop;
  insert into profiles (id, username, full_name)
  values (new.id, uname, coalesce(new.raw_user_meta_data->>'full_name', ''));

  select id into general from channels where kind = 'public' and lower(name) = 'general';
  if general is null then
    insert into channels (name, kind, topic, created_by) values ('general', 'public', 'Company-wide announcements and chat', new.id)
    returning id into general;
  end if;
  insert into channel_members (channel_id, user_id) values (general, new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Thread reply counters
create or replace function public.bump_reply_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    update messages set reply_count = reply_count + 1, last_reply_at = new.created_at where id = new.parent_id;
  end if;
  return new;
end $$;

create trigger messages_reply_count after insert on public.messages
for each row execute function public.bump_reply_count();

-- RPCs ------------------------------------------------------------------

create or replace function public.create_channel(p_name text, p_kind text, p_topic text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if p_kind not in ('public', 'private') then raise exception 'invalid kind'; end if;
  insert into channels (name, kind, topic, created_by)
  values (lower(regexp_replace(trim(p_name), '\s+', '-', 'g')), p_kind, coalesce(p_topic, ''), auth.uid())
  returning id into cid;
  insert into channel_members (channel_id, user_id) values (cid, auth.uid());
  return cid;
end $$;

-- Returns the existing DM for exactly this set of people, or creates it
create or replace function public.get_or_create_dm(p_user_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ids uuid[] := array(select distinct unnest(p_user_ids || auth.uid()) order by 1);
  cid uuid;
begin
  if array_length(ids, 1) > 9 then raise exception 'group DMs are limited to 9 people'; end if;
  select c.id into cid from channels c
  where c.kind = 'dm'
    and array(select user_id from channel_members m where m.channel_id = c.id order by 1) = ids
  limit 1;
  if cid is null then
    insert into channels (kind, created_by) values ('dm', auth.uid()) returning id into cid;
    insert into channel_members (channel_id, user_id) select cid, unnest(ids);
  end if;
  return cid;
end $$;

create or replace function public.unread_counts()
returns table (channel_id uuid, unread bigint, mentions bigint)
language sql stable security definer set search_path = public as $$
  select m.channel_id,
         count(msg.id),
         count(msg.id) filter (where auth.uid() = any (msg.mentions) or c.kind = 'dm')
  from channel_members m
  join channels c on c.id = m.channel_id
  left join messages msg on msg.channel_id = m.channel_id
    and msg.parent_id is null and msg.deleted_at is null
    and msg.created_at > m.last_read_at and msg.user_id <> auth.uid()
  where m.user_id = auth.uid()
  group by m.channel_id;
$$;

-- RLS -------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile" on public.profiles for update to authenticated using (id = auth.uid());

create policy "channels readable" on public.channels for select to authenticated using (can_read(id));
create policy "members update channel" on public.channels for update to authenticated
  using (is_member(id) and kind <> 'dm');

create policy "members readable" on public.channel_members for select to authenticated using (can_read(channel_id));
create policy "join or add" on public.channel_members for insert to authenticated with check (
  (user_id = auth.uid() and exists (select 1 from channels where id = channel_id and kind = 'public'))
  or (is_member(channel_id) and exists (select 1 from channels where id = channel_id and kind = 'private'))
);
create policy "own membership update" on public.channel_members for update to authenticated using (user_id = auth.uid());
create policy "leave" on public.channel_members for delete to authenticated
  using (user_id = auth.uid() and exists (select 1 from channels where id = channel_id and kind <> 'dm'));

create policy "messages readable" on public.messages for select to authenticated using (can_read(channel_id));
create policy "members post" on public.messages for insert to authenticated with check (
  user_id = auth.uid() and is_member(channel_id)
  and not exists (select 1 from channels where id = channel_id and archived)
);
create policy "edit own" on public.messages for update to authenticated using (user_id = auth.uid());

create policy "reactions readable" on public.reactions for select to authenticated using (can_read(channel_id));
create policy "react" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and is_member(channel_id));
create policy "unreact" on public.reactions for delete to authenticated using (user_id = auth.uid());

-- Realtime --------------------------------------------------------------

alter publication supabase_realtime add table public.messages, public.reactions, public.channel_members, public.channels;

-- Storage ---------------------------------------------------------------
-- Files are stored under <channel_id>/<uuid>/<filename>; reads go through signed URLs.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do nothing;

create policy "members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "readers download" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.can_read(((storage.foldername(name))[1])::uuid));
