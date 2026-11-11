-- Lock-screen calls for the mobile app: iOS registers a PushKit VoIP token (platform 'ios_voip') next to its Expo token.
-- Tokens carry the installation they belong to (device_id), so /api/push/send can ring an iPhone through CallKit
-- instead of also sending it an ordinary notification for the same call.

alter table public.device_tokens add column device_id text;
alter table public.device_tokens drop constraint device_tokens_platform_check;
alter table public.device_tokens add constraint device_tokens_platform_check check (platform in ('ios', 'android', 'ios_voip'));

drop function if exists public.save_device_token(text, text);
create or replace function public.save_device_token(p_token text, p_platform text, p_device text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into device_tokens (token, user_id, platform, device_id) values (p_token, auth.uid(), p_platform, p_device)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, device_id = excluded.device_id;
end $$;

create or replace function public.push_to(p_users uuid[], p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cfg push_config; subs jsonb; devices jsonb;
begin
  if to_regproc('net.http_post') is null or coalesce(cardinality(p_users), 0) = 0 then return; end if;
  select * into cfg from push_config;
  if not found then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into subs from push_subscriptions where user_id = any (p_users);
  select jsonb_agg(jsonb_build_object('token', token, 'platform', platform, 'device', device_id))
    into devices from device_tokens where user_id = any (p_users);
  if subs is null and devices is null then return; end if;
  perform net.http_post(
    url := rtrim(cfg.url, '/') || '/api/push/send',
    body := jsonb_build_object('subscriptions', coalesce(subs, '[]'::jsonb), 'devices', coalesce(devices, '[]'::jsonb), 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', cfg.secret)
  );
end $$;
revoke execute on function public.push_to(uuid[], jsonb) from public, anon, authenticated;
