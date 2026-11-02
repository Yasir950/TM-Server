-- Phase 3: Block Kit messages, workflows, canvases, outgoing Events API, DLP rules, audit log

-- Block Kit ---------------------------------------------------------------

alter table public.messages add column blocks jsonb check (blocks is null or jsonb_typeof(blocks) = 'array');

-- Webhooks may post blocks; text then serves as the notification/search fallback
drop function public.post_webhook(text, text, text);
create or replace function public.post_webhook(p_token text, p_text text, p_username text default null, p_blocks jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare w channel_webhooks; mid uuid;
begin
  select * into w from channel_webhooks where token = p_token;
  if not found then raise exception 'invalid_token'; end if;
  if coalesce(trim(p_text), '') = '' and p_blocks is null then raise exception 'text_required'; end if;
  if length(p_text) > 40000 then raise exception 'text_too_long'; end if;
  if p_blocks is not null and (jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 50) then raise exception 'invalid_blocks'; end if;
  if exists (select 1 from channels where id = w.channel_id and archived) then raise exception 'channel_archived'; end if;
  insert into messages (channel_id, user_id, body, blocks, bot_name)
  values (w.channel_id, w.created_by, coalesce(p_text, ''), p_blocks, coalesce(nullif(trim(p_username), ''), w.name))
  returning id into mid;
  return mid;
end $$;
grant execute on function public.post_webhook(text, text, text, jsonb) to anon, authenticated;

-- Workflows ---------------------------------------------------------------

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels on delete cascade,
  name text not null check (length(name) between 1 and 80),
  trigger text not null check (trigger in ('member_joined', 'keyword')),
  keyword text check (trigger <> 'keyword' or length(trim(keyword)) > 0),
  reply text not null check (length(reply) between 1 and 4000),
  enabled boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.workflows enable row level security;
create policy "members see workflows" on public.workflows for select to authenticated using (is_member(channel_id));
create policy "members add workflows" on public.workflows for insert to authenticated
  with check (created_by = auth.uid() and is_member(channel_id));
create policy "members edit workflows" on public.workflows for update to authenticated using (is_member(channel_id));
create policy "members remove workflows" on public.workflows for delete to authenticated using (is_member(channel_id));

-- {user} in a reply becomes an @mention of whoever triggered it
create or replace function public.run_workflows() returns trigger
language plpgsql security definer set search_path = public as $$
declare w workflows; who text; body text; parent uuid;
begin
  select username into who from profiles where id = new.user_id;
  if TG_TABLE_NAME = 'messages' then
    body := to_jsonb(new)->>'body';
    parent := (to_jsonb(new)->>'parent_id')::uuid;
  end if;
  for w in
    select * from workflows f
    where f.channel_id = new.channel_id and f.enabled
      and (case when body is null then f.trigger = 'member_joined'
                else f.trigger = 'keyword' and body ~* ('\m' || regexp_replace(f.keyword, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M') end)
  loop
    insert into messages (channel_id, user_id, parent_id, body, bot_name)
    values (w.channel_id, w.created_by, parent, replace(w.reply, '{user}', '@' || coalesce(who, 'someone')), w.name);
  end loop;
  return null;
end $$;
create trigger channel_members_workflows after insert on public.channel_members
for each row execute function public.run_workflows();
-- Bot messages never trigger workflows, so a workflow can't loop on itself
create trigger messages_workflows after insert on public.messages
for each row when (new.bot_name is null) execute function public.run_workflows();

-- Canvases (one per channel; markdown, "- [ ]" lines are checklists) ----

create table public.canvases (
  channel_id uuid primary key references public.channels on delete cascade,
  body text not null default '' check (length(body) <= 100000),
  updated_by uuid default auth.uid() references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.canvases enable row level security;
create policy "canvas readable" on public.canvases for select to authenticated using (can_read(channel_id));
create policy "members create canvas" on public.canvases for insert to authenticated with check (is_member(channel_id));
create policy "members edit canvas" on public.canvases for update to authenticated using (is_member(channel_id));
alter publication supabase_realtime add table public.canvases;

-- Data loss prevention ----------------------------------------------------

create table public.dlp_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  pattern text not null,
  action text not null default 'block' check (action in ('block', 'redact')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.dlp_rules enable row level security;
create policy "admins manage dlp" on public.dlp_rules for all to authenticated using (is_admin()) with check (is_admin());

create or replace function public.validate_dlp_pattern() returns trigger
language plpgsql as $$
begin
  perform '' ~ new.pattern;   -- raises on an invalid regex
  return new;
end $$;
create trigger dlp_rules_validate before insert or update on public.dlp_rules
for each row execute function public.validate_dlp_pattern();

create or replace function public.apply_dlp() returns trigger
language plpgsql security definer set search_path = public as $$
declare r dlp_rules;
begin
  if new.body = '' then return new; end if;
  for r in select * from dlp_rules where enabled loop
    if new.body ~* r.pattern then
      if r.action = 'block' then raise exception 'Blocked by data loss prevention policy “%”', r.name; end if;
      new.body := regexp_replace(new.body, r.pattern, '[redacted]', 'gi');
    end if;
  end loop;
  return new;
end $$;
create trigger messages_dlp before insert or update of body on public.messages
for each row execute function public.apply_dlp();

-- Outgoing Events API -------------------------------------------------------

create table public.event_subscriptions (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https://'),
  events text[] not null check (events <@ array['message.posted', 'channel.created', 'member.joined']),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.event_subscriptions enable row level security;
create policy "admins manage events" on public.event_subscriptions for all to authenticated using (is_admin()) with check (is_admin());

-- POSTs {"type":"event_callback","event":{...}} with X-TM-Signature = hex HMAC-SHA256(body, secret).
-- Needs pg_net; without it events are silently skipped.
create or replace function public.emit_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev_kind text; ev jsonb; payload jsonb; s event_subscriptions;
begin
  if to_regproc('net.http_post') is null then return null; end if;
  if TG_TABLE_NAME = 'messages' then
    if exists (select 1 from channels c where c.id = new.channel_id and c.kind = 'dm') then return null; end if;
    ev_kind := 'message.posted';
    ev := jsonb_build_object('channel', new.channel_id, 'user', new.user_id, 'text', new.body, 'ts', new.created_at,
                             'thread_ts', new.parent_id, 'bot_name', new.bot_name, 'id', new.id);
  elsif TG_TABLE_NAME = 'channels' then
    if new.kind = 'dm' then return null; end if;
    ev_kind := 'channel.created';
    ev := jsonb_build_object('channel', jsonb_build_object('id', new.id, 'name', new.name, 'kind', new.kind, 'creator', new.created_by));
  else
    if exists (select 1 from channels c where c.id = new.channel_id and c.kind = 'dm') then return null; end if;
    ev_kind := 'member.joined';
    ev := jsonb_build_object('channel', new.channel_id, 'user', new.user_id);
  end if;
  payload := jsonb_build_object('type', 'event_callback', 'event_time', extract(epoch from now())::bigint,
                                'event', ev || jsonb_build_object('type', ev_kind));
  for s in select * from event_subscriptions e where e.enabled and ev_kind = any(e.events) loop
    perform net.http_post(
      url := s.url,
      body := payload,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-TM-Signature', encode(extensions.hmac(payload::text, s.secret, 'sha256'), 'hex'))
    );
  end loop;
  return null;
end $$;
create trigger messages_events after insert on public.messages for each row execute function public.emit_event();
create trigger channels_events after insert on public.channels for each row execute function public.emit_event();
create trigger channel_members_events after insert on public.channel_members for each row execute function public.emit_event();

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- Audit log -----------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
alter table public.audit_log enable row level security;
create policy "admins read audit" on public.audit_log for select to authenticated using (is_admin());

create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); action text; target text; details jsonb := '{}';
begin
  case TG_TABLE_NAME
    when 'channels' then
      action := case when TG_OP = 'INSERT' then 'channel.created' when TG_OP = 'DELETE' then 'channel.deleted'
                     when new.archived and not old.archived then 'channel.archived'
                     when old.archived and not new.archived then 'channel.unarchived'
                     when new.name is distinct from old.name then 'channel.renamed' end;
      if new.kind = 'dm' or old.kind = 'dm' then return null; end if;
      target := coalesce(new.name, old.name);
    when 'channel_members' then
      action := case TG_OP when 'INSERT' then 'member.added' else 'member.removed' end;
      target := r->>'channel_id';
      details := jsonb_build_object('user', r->>'user_id');
    when 'profiles' then
      action := 'role.changed';
      target := new.username;
      details := jsonb_build_object('from', old.role, 'to', new.role);
    when 'messages' then
      action := 'message.deleted';
      target := new.channel_id::text;
      details := jsonb_build_object('message', new.id, 'author', new.user_id);
    when 'workspace_settings' then
      action := 'settings.changed';
      details := jsonb_build_object('retention_days', new.retention_days);
    else
      action := TG_TABLE_NAME || '.' || lower(TG_OP);
      target := coalesce(r->>'name', r->>'url', r->>'id');
  end case;
  if action is null then return null; end if;
  insert into audit_log (actor, action, target, details) values (auth.uid(), action, target, details);
  return null;
end $$;

create trigger channels_audit after insert or update or delete on public.channels for each row execute function public.audit();
create trigger channel_members_audit after insert or delete on public.channel_members for each row execute function public.audit();
create trigger profiles_audit after update on public.profiles
  for each row when (old.role is distinct from new.role) execute function public.audit();
create trigger messages_audit after update on public.messages
  for each row when (new.deleted_at is not null and old.deleted_at is null) execute function public.audit();
create trigger settings_audit after update on public.workspace_settings for each row execute function public.audit();
create trigger webhooks_audit after insert or delete on public.channel_webhooks for each row execute function public.audit();
create trigger workflows_audit after insert or update or delete on public.workflows for each row execute function public.audit();
create trigger dlp_audit after insert or update or delete on public.dlp_rules for each row execute function public.audit();
create trigger events_audit after insert or update or delete on public.event_subscriptions for each row execute function public.audit();
