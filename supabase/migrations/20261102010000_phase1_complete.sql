-- Phase 1 completion: pins, saved items, threads view, search, status/DND, notification levels,
-- starred channels, DM -> channel, previews, incoming webhooks

alter table public.profiles
  add column status_emoji text not null default '',
  add column status_text text not null default '',
  add column status_expires_at timestamptz,
  add column dnd_until timestamptz;

alter table public.channel_members
  add column starred boolean not null default false,
  add column notify text not null default 'default' check (notify in ('default', 'all', 'mentions', 'nothing'));

alter table public.messages
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles on delete set null,
  add column also_in_channel boolean not null default false,
  add column bot_name text,
  add column fts tsvector generated always as (to_tsvector('simple', body)) stored;
create index messages_fts_idx on public.messages using gin (fts);

-- Users can't post as a bot; only post_webhook sets bot_name
drop policy "members post" on public.messages;
create policy "members post" on public.messages for insert to authenticated with check (
  user_id = auth.uid() and bot_name is null and is_member(channel_id)
  and not exists (select 1 from channels where id = channel_id and archived)
);

create table public.saved_items (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  message_id uuid not null references public.messages on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.saved_items enable row level security;
create policy "own saved" on public.saved_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.channel_webhooks (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels on delete cascade,
  name text not null,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_by uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.channel_webhooks enable row level security;
create policy "members see webhooks" on public.channel_webhooks for select to authenticated using (is_member(channel_id));
create policy "members add webhooks" on public.channel_webhooks for insert to authenticated
  with check (created_by = auth.uid() and is_member(channel_id));
create policy "members remove webhooks" on public.channel_webhooks for delete to authenticated using (is_member(channel_id));

-- Incoming webhook: the token is the credential, so this is callable without a session
create or replace function public.post_webhook(p_token text, p_text text, p_username text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare w channel_webhooks; mid uuid;
begin
  select * into w from channel_webhooks where token = p_token;
  if not found then raise exception 'invalid_token'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'text_required'; end if;
  if length(p_text) > 40000 then raise exception 'text_too_long'; end if;
  if exists (select 1 from channels where id = w.channel_id and archived) then raise exception 'channel_archived'; end if;
  insert into messages (channel_id, user_id, body, bot_name)
  values (w.channel_id, w.created_by, p_text, coalesce(nullif(trim(p_username), ''), w.name))
  returning id into mid;
  return mid;
end $$;
grant execute on function public.post_webhook(text, text, text) to anon, authenticated;

create or replace function public.toggle_pin(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update messages
  set pinned_by = case when pinned_at is null then auth.uid() end,
      pinned_at = case when pinned_at is null then now() end
  where id = p_id and is_member(channel_id);
$$;

create or replace function public.convert_dm_to_channel(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_id) then raise exception 'not a member'; end if;
  if (select count(*) from channel_members where channel_id = p_id) < 3 then raise exception 'only group DMs can be converted'; end if;
  update channels set kind = 'private', name = lower(regexp_replace(trim(p_name), '\s+', '-', 'g'))
  where id = p_id and kind = 'dm';
end $$;

create or replace function public.channel_previews()
returns table (channel_id uuid, body text, user_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.channel_id, l.body, l.user_id, l.created_at
  from channel_members m
  cross join lateral (
    select body, user_id, created_at from messages
    where channel_id = m.channel_id and (parent_id is null or also_in_channel) and deleted_at is null
    order by created_at desc limit 1
  ) l
  where m.user_id = auth.uid();
$$;

-- Threads the user started, replied to, or was mentioned in (RLS applies)
create or replace function public.my_threads() returns setof public.messages
language sql stable security invoker set search_path = public as $$
  select * from messages p
  where p.reply_count > 0 and (
    p.user_id = auth.uid() or auth.uid() = any (p.mentions)
    or exists (select 1 from messages r where r.parent_id = p.id and r.user_id = auth.uid())
  )
  order by p.last_reply_at desc
  limit 50;
$$;

create or replace function public.unread_counts()
returns table (channel_id uuid, unread bigint, mentions bigint)
language sql stable security definer set search_path = public as $$
  select m.channel_id,
         count(msg.id),
         count(msg.id) filter (where auth.uid() = any (msg.mentions) or c.kind = 'dm' or msg.body ~ '(^|\s)@(channel|here)\M')
  from channel_members m
  join channels c on c.id = m.channel_id
  left join messages msg on msg.channel_id = m.channel_id
    and (msg.parent_id is null or msg.also_in_channel) and msg.deleted_at is null
    and msg.created_at > m.last_read_at and (msg.user_id <> auth.uid() or msg.bot_name is not null)
  where m.user_id = auth.uid()
  group by m.channel_id;
$$;

alter publication supabase_realtime add table public.profiles;
