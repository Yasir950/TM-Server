-- Call cancelled: the caller hung up before anyone answered. The caller's app calls this so phones and
-- closed apps that are still ringing (public/sw.js) stop and show a missed call instead.
create or replace function public.push_cancel_ring(p_channel uuid, p_to uuid[]) returns void
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
  from company_members m
  where m.company_id = ch.company_id and m.status = 'active'
    and m.user_id = any (p_to) and m.user_id <> auth.uid();
  perform push_to(recips, jsonb_build_object(
    'kind', 'cancel',
    -- Same tag as push_ring's notification, so the missed call replaces the ringing one
    'tag', 'huddle:' || p_channel,
    'icon', (select avatar_url from profiles where id = auth.uid()),
    'caller', caller,
    'channel', p_channel,
    'where', title
  ));
end $$;
