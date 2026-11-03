-- Web Push: notifications and incoming calls reach people whose app isn't open.
-- The database decides who to notify (the same rules the open app uses) and hands the
-- subscriptions to /api/push/send over pg_net; that route signs and delivers them with VAPID.

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- Where to deliver pushes. One row, set from the SQL editor; no policies, so clients can't read the secret:
--   insert into push_config (url, secret) values ('https://workchime.vercel.app', '<PUSH_SECRET>');
create table public.push_config (
  id boolean primary key default true check (id),
  url text not null check (url ~ '^https?://'),
  secret text not null
);
alter table public.push_config enable row level security;

-- A browser's endpoint follows whoever signed in on it last
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Called by /api/push/send for endpoints the push service reports as gone
create or replace function public.drop_push_subscriptions(p_secret text, p_endpoints text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_config where secret = p_secret) then raise exception 'invalid_secret'; end if;
  delete from push_subscriptions where endpoint = any (p_endpoints);
end $$;
grant execute on function public.drop_push_subscriptions(text, text[]) to anon;

-- Sends one payload to every device of these users. Needs pg_net and a push_config row; otherwise does nothing.
create or replace function public.push_to(p_users uuid[], p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cfg push_config; subs jsonb;
begin
  if to_regproc('net.http_post') is null or coalesce(cardinality(p_users), 0) = 0 then return; end if;
  select * into cfg from push_config;
  if not found then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into subs from push_subscriptions where user_id = any (p_users);
  if subs is null then return; end if;
  perform net.http_post(
    url := rtrim(cfg.url, '/') || '/api/push/send',
    body := jsonb_build_object('subscriptions', subs, 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', cfg.secret)
  );
end $$;
revoke execute on function public.push_to(uuid[], jsonb) from public, anon, authenticated;

create or replace function public.push_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), username) from profiles where id = p_id;
$$;

-- New messages: mirrors the open app's rules in components/chat/store.tsx — per-conversation notify level
-- (DMs default to all, channels to mentions), mute and Do Not Disturb; thread replies go to the thread's followers
create or replace function public.push_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare ch channels; sender text; title text; recips uuid[]; url text;
begin
  if new.deleted_at is not null then return null; end if;
  select * into ch from channels where id = new.channel_id;
  sender := coalesce(new.bot_name, push_name(new.user_id), 'Someone');

  if new.parent_id is null or new.also_in_channel then
    select array_agg(cm.user_id) into recips
    from channel_members cm join profiles p on p.id = cm.user_id
    where cm.channel_id = new.channel_id
      and (cm.user_id <> new.user_id or new.bot_name is not null)
      and not cm.muted
      and (p.dnd_until is null or p.dnd_until <= now())
      and case coalesce(nullif(cm.notify, 'default'), case when ch.kind = 'dm' then 'all' else 'mentions' end)
            when 'all' then true
            when 'mentions' then ch.kind = 'dm' or cm.user_id = any (new.mentions) or new.body ~ '(^|\s)@(channel|here)\M'
            else false
          end;
    title := case when ch.kind = 'dm' then sender else sender || ' in #' || ch.name end;
    url := '/?c=' || new.channel_id || '&m=' || new.id;
  else
    -- Followers: the thread's author, anyone who replied, and anyone mentioned in it
    select array_agg(cm.user_id) into recips
    from channel_members cm join profiles p on p.id = cm.user_id
    where cm.channel_id = new.channel_id
      and (cm.user_id <> new.user_id or new.bot_name is not null)
      and not cm.muted and cm.notify <> 'nothing'
      and (p.dnd_until is null or p.dnd_until <= now())
      and exists (select 1 from messages o
                  where (o.id = new.parent_id or o.parent_id = new.parent_id)
                    and (o.user_id = cm.user_id or cm.user_id = any (o.mentions)));
    title := sender || ' replied in a thread' || case when ch.kind = 'dm' then '' else ' in #' || ch.name end;
    url := '/?c=' || new.channel_id || '&m=' || new.parent_id || '&t=' || new.parent_id;
  end if;

  perform push_to(recips, jsonb_build_object(
    'kind', 'message',
    'title', title,
    'body', left(new.body, 400),
    'attachments', jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)),
    'tag', new.id,
    'icon', case when new.bot_name is null then (select avatar_url from profiles where id = new.user_id) end,
    'url', url
  ));
  return null;
end $$;
create trigger messages_push after insert on public.messages for each row execute function public.push_message();

-- Incoming call: the caller's app rings people over realtime and calls this so closed apps ring too.
-- Callees must be in the call's company; people in Do Not Disturb aren't rung.
create or replace function public.push_ring(p_channel uuid, p_to uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare ch channels; caller text; title text; recips uuid[];
begin
  select * into ch from channels where id = p_channel;
  if ch.id is null or not is_member(p_channel) then raise exception 'not a member'; end if;
  caller := coalesce(push_name(auth.uid()), 'Someone');
  title := case when ch.kind = 'dm'
    then (select string_agg(push_name(user_id), ', ') from channel_members where channel_id = p_channel)
    else '#' || ch.name end;
  select array_agg(m.user_id) into recips
  from company_members m join profiles p on p.id = m.user_id
  where m.company_id = ch.company_id and m.status = 'active'
    and m.user_id = any (p_to) and m.user_id <> auth.uid()
    and (p.dnd_until is null or p.dnd_until <= now());
  perform push_to(recips, jsonb_build_object(
    'kind', 'call',
    'title', caller || ' is calling you',
    'body', case when ch.kind = 'dm' then 'Click to answer' else 'in ' || title || ' · click to answer' end,
    'tag', 'huddle:' || p_channel,
    'icon', (select avatar_url from profiles where id = auth.uid()),
    'caller', caller,
    -- public/sw.js opens /?ring=<channel>&from=<caller>&where=<title> to show the incoming-call dialog
    'channel', p_channel,
    'from', auth.uid(),
    'where', title,
    -- Rings last 30 seconds; a push delivered later shows as a missed call
    'expires', (extract(epoch from now()) * 1000)::bigint + 30000
  ));
end $$;
