-- Native push for the iOS/Android app (mobile/): devices register an Expo push token, and push_to()
-- hands those tokens to /api/push/send alongside the Web Push subscriptions; the route delivers them via Expo.

create table public.device_tokens (
  token text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);
create index device_tokens_user_idx on public.device_tokens (user_id);
alter table public.device_tokens enable row level security;
create policy "own device tokens" on public.device_tokens for select to authenticated using (user_id = auth.uid());

-- A device's token follows whoever signed in on it last
create or replace function public.save_device_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into device_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform;
end $$;

create or replace function public.delete_device_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from device_tokens where token = p_token and user_id = auth.uid();
$$;

-- Called by /api/push/send for tokens Expo reports as DeviceNotRegistered
create or replace function public.drop_device_tokens(p_secret text, p_tokens text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_config where secret = p_secret) then raise exception 'invalid_secret'; end if;
  delete from device_tokens where token = any (p_tokens);
end $$;
grant execute on function public.drop_device_tokens(text, text[]) to anon;

create or replace function public.push_to(p_users uuid[], p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cfg push_config; subs jsonb; devices jsonb;
begin
  if to_regproc('net.http_post') is null or coalesce(cardinality(p_users), 0) = 0 then return; end if;
  select * into cfg from push_config;
  if not found then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into subs from push_subscriptions where user_id = any (p_users);
  select jsonb_agg(token) into devices from device_tokens where user_id = any (p_users);
  if subs is null and devices is null then return; end if;
  perform net.http_post(
    url := rtrim(cfg.url, '/') || '/api/push/send',
    body := jsonb_build_object('subscriptions', coalesce(subs, '[]'::jsonb), 'devices', coalesce(devices, '[]'::jsonb), 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', cfg.secret)
  );
end $$;
revoke execute on function public.push_to(uuid[], jsonb) from public, anon, authenticated;
