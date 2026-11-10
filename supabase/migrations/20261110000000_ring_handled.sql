-- A call answered or declined on one device: the user's other browsers stop ringing (public/sw.js 'handled').
-- Open apps hear it over realtime; this reaches browsers whose app is closed and only the service worker runs.
-- It only ever pushes to the caller's own devices.
create or replace function public.push_ring_handled(p_channel uuid, p_answered boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform push_to(array[auth.uid()], jsonb_build_object(
    'kind', 'handled',
    -- Same tag as push_ring's notification, so it replaces the ringing one
    'tag', 'huddle:' || p_channel,
    'channel', p_channel,
    'answered', p_answered
  ));
end $$;
