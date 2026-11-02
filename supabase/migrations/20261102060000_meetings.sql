-- Scheduled meetings: a Meet booked in a conversation for a set time. At the start time every invitee's
-- client rings them into that conversation's Meet, and fire_meetings() posts a "starting now" message.

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  starts_at timestamptz not null,
  duration_minutes int not null default 30 check (duration_minutes between 5 and 480),
  created_by uuid not null default auth.uid() references public.profiles on delete cascade,
  -- Set once the start has been announced in the conversation
  started_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index meetings_due_idx on public.meetings (starts_at) where started_at is null and cancelled_at is null;
create index meetings_channel_idx on public.meetings (channel_id, starts_at);

-- The organizer is an invitee too, with response 'accepted'
create table public.meeting_invitees (
  meeting_id uuid references public.meetings on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  response text not null default 'pending' check (response in ('pending', 'accepted', 'declined')),
  primary key (meeting_id, user_id)
);
create index meeting_invitees_user_idx on public.meeting_invitees (user_id);

create or replace function public.is_invited(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from meeting_invitees where meeting_id = mid and user_id = auth.uid());
$$;

-- Readable by invitees and by anyone who can read the conversation; all writes go through the RPCs below
alter table public.meetings enable row level security;
create policy "meetings readable" on public.meetings for select to authenticated
  using (is_invited(id) or can_read(channel_id));

alter table public.meeting_invitees enable row level security;
create policy "invitees readable" on public.meeting_invitees for select to authenticated
  using (is_invited(meeting_id) or exists (select 1 from meetings m where m.id = meeting_id and can_read(m.channel_id)));

-- p_when_label is the start time as the organizer's client formats it (with time zone) for the announcement
create or replace function public.schedule_meeting(
  p_channel uuid, p_title text, p_starts_at timestamptz, p_duration int, p_invitees uuid[],
  p_description text default '', p_when_label text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  mid uuid;
  ids uuid[] := array(select distinct u from unnest(coalesce(p_invitees, '{}') || auth.uid()) u);
begin
  select * into ch from channels where id = p_channel;
  if ch.id is null or not is_member(p_channel) then raise exception 'you can only schedule meetings in conversations you are in'; end if;
  if ch.archived then raise exception 'this channel is archived'; end if;
  if p_starts_at < now() - interval '5 minutes' then raise exception 'pick a start time in the future'; end if;
  -- Invitees must be able to see the conversation: its members, or any non-guest for a public channel
  if exists (select 1 from unnest(ids) u where not exists (
    select 1 from company_members m
    where m.company_id = ch.company_id and m.user_id = u and m.status = 'active'
      and (exists (select 1 from channel_members where channel_id = p_channel and user_id = u)
           or (ch.kind = 'public' and m.role <> 'guest')))) then
    raise exception 'everyone invited must be able to see this conversation';
  end if;

  insert into meetings (channel_id, title, description, starts_at, duration_minutes, created_by)
  values (p_channel, trim(p_title), trim(coalesce(p_description, '')), p_starts_at, coalesce(p_duration, 30), auth.uid())
  returning id into mid;
  insert into meeting_invitees (meeting_id, user_id, response)
  select mid, u, case when u = auth.uid() then 'accepted' else 'pending' end from unnest(ids) u;

  insert into messages (channel_id, user_id, body, bot_name, mentions)
  values (p_channel, auth.uid(),
    '📅 Scheduled *' || trim(p_title) || '*' || case when coalesce(p_when_label, '') <> '' then ' for ' || p_when_label else '' end
      || '. Everyone invited will be called when it starts.',
    'Meetings', array_remove(ids, auth.uid()));
  return mid;
end $$;

create or replace function public.respond_meeting(p_id uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_response not in ('accepted', 'declined') then raise exception 'invalid response'; end if;
  update meeting_invitees set response = p_response where meeting_id = p_id and user_id = auth.uid();
  if not found then raise exception 'you are not invited to this meeting'; end if;
end $$;

create or replace function public.cancel_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m meetings;
begin
  update meetings set cancelled_at = now() where id = p_id and created_by = auth.uid() and cancelled_at is null returning * into m;
  if m.id is null then raise exception 'only the organizer can cancel this meeting'; end if;
  insert into messages (channel_id, user_id, body, bot_name, mentions)
  values (m.channel_id, m.created_by, '🚫 Cancelled *' || m.title || '*', 'Meetings',
    array(select user_id from meeting_invitees where meeting_id = m.id and user_id <> m.created_by));
end $$;

-- Announces meetings that have started. Called by clients for their own meetings, or by cron for everyone.
create or replace function public.fire_meetings() returns int
language plpgsql security definer set search_path = public as $$
declare m meetings; n int := 0;
begin
  for m in
    select * from meetings
    where started_at is null and cancelled_at is null and starts_at <= now()
      and (auth.uid() is null or is_invited(id))
    for update skip locked
  loop
    -- A meeting that already ended unannounced (no client or cron ran) is closed silently
    if m.starts_at + make_interval(mins => m.duration_minutes) > now() then
      insert into messages (channel_id, user_id, body, bot_name, mentions)
      values (m.channel_id, m.created_by, '📞 *' || m.title || '* is starting now. Join the call from the top of this conversation.', 'Meetings',
        array(select user_id from meeting_invitees where meeting_id = m.id and response <> 'declined'));
    end if;
    update meetings set started_at = now() where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

alter publication supabase_realtime add table public.meetings, public.meeting_invitees;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tm-meetings', '* * * * *', 'select public.fire_meetings()');
  end if;
end $$;
