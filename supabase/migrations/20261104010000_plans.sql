-- Plans: Free, Pro ($100/month per company) and Enterprise (custom, set by a super admin after a sales conversation).
--
-- Every company shares one Supabase project, so each plan's limits are that company's slice of the project's quotas.
-- Sized for one Supabase Pro project ($25/month: 8 GB database, 100 GB storage, 250 GB egress, 500 concurrent
-- realtime connections, 5M realtime messages, 100k MAU) hosting about 25 Free and 10 Pro companies:
--   Free  must fit inside the included quota, since it brings no revenue:
--         25 x 1 GB storage = 25 GB; 25 x 10 members = 250 people, ~125 connections at peak;
--         90 days of visible history and deletion after a year keep the database small.
--   Pro   may run into Supabase overage, which its $100 more than covers:
--         10 x 25 GB = 250 GB storage (150 GB over, about $3.20); 10 x 250 members = 2,500 people,
--         ~1,000 connections at peak (500 over, about $5); unlimited history at $0.125 per extra database GB.
-- Change a limit with an update on public.plans; src/lib/plans.ts holds the same numbers for the public pricing page.

create table public.plans (
  id text primary key,
  name text not null,
  price_cents int,                    -- per company per month; null = custom pricing
  max_members int,                    -- active members, guests included; null = unlimited
  storage_bytes bigint,               -- total file storage
  max_file_bytes bigint,              -- largest single upload
  history_days int,                   -- older messages are hidden
  purge_days int,                     -- and deleted after this many days
  max_call_participants int,          -- people in one Meet (calls are peer-to-peer, so keep this small)
  max_webhooks int,
  max_workflows int,
  guests boolean not null default false,
  ai_summaries boolean not null default false,
  events_api boolean not null default false,
  dlp boolean not null default false,
  audit_log boolean not null default false,
  custom_retention boolean not null default false,
  sort int not null default 0
);

insert into public.plans values
  ('free', 'Free', 0, 10, 1073741824, 10485760, 90, 365, 2, 2, 2, false, false, false, false, false, false, 1),
  ('pro', 'Pro', 10000, 250, 26843545600, 262144000, null, null, 10, null, null, true, true, true, true, true, true, 2),
  ('enterprise', 'Enterprise', null, null, null, 262144000, null, null, 10, null, null, true, true, true, true, true, true, 3);

alter table public.plans enable row level security;
create policy "plans readable" on public.plans for select to anon, authenticated using (true);

-- Companies ----------------------------------------------------------------

alter table public.companies
  add column plan text not null default 'free' references public.plans,
  add column plan_changed_at timestamptz,
  add column upgrade_requested_at timestamptz,
  add column retention_days int check (retention_days is null or retention_days >= 1);

-- Companies that existed before plans keep everything they had
update public.companies set plan = 'pro', plan_changed_at = now();

-- Retention was one setting for the whole deployment; it is per company now
update public.companies set retention_days = (select retention_days from public.workspace_settings limit 1);
drop table public.workspace_settings cascade;

create or replace function public.company_plan(cid uuid) returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from plans p join companies c on c.plan = p.id where c.id = cid;
$$;

create or replace function public.has_feature(cid uuid, f text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((to_jsonb(company_plan(cid)) ->> f)::boolean, false);
$$;

-- For server routes that start from a conversation (the AI summary route)
create or replace function public.channel_has_feature(p_channel uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select can_read(p_channel) and has_feature((select company_id from channels where id = p_channel), p_feature);
$$;

-- Plan fields only change through set_company_plan / request_upgrade; retention needs a plan that allows it
create or replace function public.guard_company_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.company_rpc', true), '') <> 'on'
     and (new.plan is distinct from old.plan or new.plan_changed_at is distinct from old.plan_changed_at
          or new.upgrade_requested_at is distinct from old.upgrade_requested_at) then
    raise exception 'the plan is changed by the platform team';
  end if;
  if new.retention_days is not null and new.retention_days is distinct from old.retention_days and not has_feature(new.id, 'custom_retention') then
    raise exception 'Custom message retention is available on the Pro plan';
  end if;
  return new;
end $$;
create trigger companies_plan_guard before update on public.companies
for each row execute function public.guard_company_plan();

create or replace function public.set_company_plan(p_company uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'super admins only'; end if;
  if not exists (select 1 from plans where id = p_plan) then raise exception 'unknown plan'; end if;
  perform set_config('app.company_rpc', 'on', true);
  update companies set plan = p_plan, plan_changed_at = now(), upgrade_requested_at = null where id = p_company;
end $$;

-- Members and guests ---------------------------------------------------------

-- Covers every way in: invites, join requests, verified domains, reactivation and role changes
create or replace function public.enforce_member_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plans := company_plan(new.company_id); n int;
begin
  if new.status <> 'active' then return new; end if;
  -- add_company_member upserts; the update half of the upsert is checked on its own
  if tg_op = 'INSERT' and exists (select 1 from company_members where company_id = new.company_id and user_id = new.user_id) then
    return new;
  end if;
  if new.role = 'guest' and not coalesce(p.guests, false)
     and (tg_op = 'INSERT' or old.role <> 'guest' or old.status <> 'active') then
    raise exception 'Guests are available on the Pro plan';
  end if;
  if p.max_members is not null and (tg_op = 'INSERT' or old.status <> 'active') then
    select count(*) into n from company_members where company_id = new.company_id and status = 'active';
    if n >= p.max_members then
      raise exception 'The % plan allows up to % members. Upgrade to add more people.', p.name, p.max_members;
    end if;
  end if;
  return new;
end $$;
create trigger company_members_plan before insert or update of status, role on public.company_members
for each row execute function public.enforce_member_limit();

create or replace function public.enforce_guest_invites() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'guest' and not has_feature(new.company_id, 'guests') then
    raise exception 'Guests are available on the Pro plan';
  end if;
  return new;
end $$;
create trigger company_invites_plan before insert on public.company_invites
for each row execute function public.enforce_guest_invites();

-- A full company must not stop someone signing up: they just aren't auto-joined by their email domain
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))), '[^a-z0-9_.-]', '', 'g');
  uname text := base;
  cid uuid;
begin
  if uname = '' then uname := 'user'; base := 'user'; end if;
  while exists (select 1 from profiles where username = uname) loop
    uname := base || floor(random() * 10000)::text;
  end loop;
  insert into profiles (id, username, full_name)
  values (new.id, uname, coalesce(new.raw_user_meta_data->>'full_name', ''));

  select company_id into cid from company_domains where domain = lower(split_part(new.email, '@', 2));
  if cid is not null then
    begin
      perform add_company_member(cid, new.id, 'member', null);
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

-- Storage --------------------------------------------------------------------

-- Bytes of attachments in a company's conversations (files live at <channel id>/<uuid>/<name>)
create or replace function public.storage_used(cid uuid) returns bigint
language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'attachments'
    and split_part(o.name, '/', 1) in (select id::text from public.channels where company_id = cid);
$$;

-- Uploads stop once a company is at its quota (the last upload may cross it)
create or replace function public.can_upload(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select storage_used(c.company_id) < (company_plan(c.company_id)).storage_bytes from channels c where c.id = p_channel),
    true);
$$;

drop policy "members upload" on storage.objects;
create policy "members upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'attachments'
  and public.is_member(((storage.foldername(name))[1])::uuid)
  and public.can_upload(((storage.foldername(name))[1])::uuid)
);

-- The bucket allows the largest plan's file size; the app checks each company's own limit before uploading.
-- The project-wide upload limit (Dashboard > Storage > Settings) must be at least this.
update storage.buckets set file_size_limit = 262144000 where id = 'attachments';

-- Message history ----------------------------------------------------------------

create or replace function public.in_history(p_channel uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_at > now() - make_interval(days => (
    select p.history_days from channels c join companies co on co.id = c.company_id join plans p on p.id = co.plan where c.id = p_channel
  )), true);
$$;

create policy "plan history" on public.messages as restrictive for select to authenticated
  using (public.in_history(channel_id, created_at));

-- Retention: each company's own setting (Pro) and the plan's purge window (Free); cron runs it for everyone
create or replace function public.apply_retention() returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint := 0; k bigint; co record;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'admins only'; end if;
  for co in
    select c.id, least(case when p.custom_retention then c.retention_days end, p.purge_days) as days
    from companies c join plans p on p.id = c.plan
    where auth.uid() is null or c.id = current_company()
  loop
    continue when co.days is null;
    delete from messages m using channels ch
    where ch.id = m.channel_id and ch.company_id = co.id
      and m.created_at < now() - make_interval(days => co.days) and m.pinned_at is null;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

-- Webhooks and workflows ---------------------------------------------------------

create or replace function public.enforce_integration_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; p plans; lim int; n int; what text;
begin
  select company_id into cid from channels where id = new.channel_id;
  p := company_plan(cid);
  if TG_TABLE_NAME = 'workflows' then
    lim := p.max_workflows; what := 'workflows';
    select count(*) into n from workflows w join channels c on c.id = w.channel_id where c.company_id = cid;
  else
    lim := p.max_webhooks; what := 'webhooks';
    select count(*) into n from channel_webhooks w join channels c on c.id = w.channel_id where c.company_id = cid;
  end if;
  if lim is not null and n >= lim then
    raise exception 'The % plan allows up to % %. Upgrade to add more.', p.name, lim, what;
  end if;
  return new;
end $$;
create trigger workflows_plan before insert on public.workflows for each row execute function public.enforce_integration_limit();
create trigger webhooks_plan before insert on public.channel_webhooks for each row execute function public.enforce_integration_limit();

-- DLP, Events API and the audit log belong to a company -------------------------------

alter table public.dlp_rules add column company_id uuid references public.companies on delete cascade default public.current_company();
alter table public.event_subscriptions add column company_id uuid references public.companies on delete cascade default public.current_company();
alter table public.audit_log add column company_id uuid references public.companies on delete cascade;

-- Rows from before companies were separated go to the oldest company
update public.dlp_rules set company_id = (select id from public.companies order by created_at limit 1) where company_id is null;
update public.event_subscriptions set company_id = (select id from public.companies order by created_at limit 1) where company_id is null;
update public.audit_log set company_id = (select id from public.companies order by created_at limit 1) where company_id is null;
delete from public.dlp_rules where company_id is null;
delete from public.event_subscriptions where company_id is null;
alter table public.dlp_rules alter column company_id set not null;
alter table public.event_subscriptions alter column company_id set not null;
create index audit_log_company_idx on public.audit_log (company_id, created_at desc);

drop policy "admins manage dlp" on public.dlp_rules;
create policy "admins manage dlp" on public.dlp_rules for all to authenticated
  using (is_company_admin(company_id)) with check (is_company_admin(company_id) and has_feature(company_id, 'dlp'));

drop policy "admins manage events" on public.event_subscriptions;
create policy "admins manage events" on public.event_subscriptions for all to authenticated
  using (is_company_admin(company_id)) with check (is_company_admin(company_id) and has_feature(company_id, 'events_api'));

drop policy "admins read audit" on public.audit_log;
create policy "admins read audit" on public.audit_log for select to authenticated
  using (is_company_admin(company_id) and has_feature(company_id, 'audit_log'));

-- Only the message's own company's rules apply, and only on plans with DLP
create or replace function public.apply_dlp() returns trigger
language plpgsql security definer set search_path = public as $$
declare r dlp_rules; cid uuid;
begin
  if new.body = '' then return new; end if;
  select company_id into cid from channels where id = new.channel_id;
  if not has_feature(cid, 'dlp') then return new; end if;
  for r in select * from dlp_rules where enabled and company_id = cid loop
    if new.body ~* r.pattern then
      if r.action = 'block' then raise exception 'Blocked by data loss prevention policy “%”', r.name; end if;
      new.body := regexp_replace(new.body, r.pattern, '[redacted]', 'gi');
    end if;
  end loop;
  return new;
end $$;

-- Events go only to the subscriptions of the company they happened in
create or replace function public.emit_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev_kind text; ev jsonb; payload jsonb; s event_subscriptions; cid uuid;
begin
  if to_regproc('net.http_post') is null then return null; end if;
  if TG_TABLE_NAME = 'messages' then
    if exists (select 1 from channels c where c.id = new.channel_id and c.kind = 'dm') then return null; end if;
    select company_id into cid from channels where id = new.channel_id;
    ev_kind := 'message.posted';
    ev := jsonb_build_object('channel', new.channel_id, 'user', new.user_id, 'text', new.body, 'ts', new.created_at,
                             'thread_ts', new.parent_id, 'bot_name', new.bot_name, 'id', new.id);
  elsif TG_TABLE_NAME = 'channels' then
    if new.kind = 'dm' then return null; end if;
    cid := new.company_id;
    ev_kind := 'channel.created';
    ev := jsonb_build_object('channel', jsonb_build_object('id', new.id, 'name', new.name, 'kind', new.kind, 'creator', new.created_by));
  else
    if exists (select 1 from channels c where c.id = new.channel_id and c.kind = 'dm') then return null; end if;
    select company_id into cid from channels where id = new.channel_id;
    ev_kind := 'member.joined';
    ev := jsonb_build_object('channel', new.channel_id, 'user', new.user_id);
  end if;
  if not has_feature(cid, 'events_api') then return null; end if;
  payload := jsonb_build_object('type', 'event_callback', 'event_time', extract(epoch from now())::bigint,
                                'event', ev || jsonb_build_object('type', ev_kind));
  for s in select * from event_subscriptions e where e.enabled and e.company_id = cid and ev_kind = any(e.events) loop
    perform net.http_post(
      url := s.url,
      body := payload,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-TM-Signature', encode(extensions.hmac(payload::text, s.secret, 'sha256'), 'hex'))
    );
  end loop;
  return null;
end $$;

-- Audit entries record the company they belong to
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); action text; target text; details jsonb := '{}'; cid uuid;
begin
  case TG_TABLE_NAME
    when 'channels' then
      action := case when TG_OP = 'INSERT' then 'channel.created' when TG_OP = 'DELETE' then 'channel.deleted'
                     when new.archived and not old.archived then 'channel.archived'
                     when old.archived and not new.archived then 'channel.unarchived'
                     when new.name is distinct from old.name then 'channel.renamed' end;
      if new.kind = 'dm' or old.kind = 'dm' then return null; end if;
      target := coalesce(new.name, old.name);
      cid := (r->>'company_id')::uuid;
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
    when 'companies' then
      action := 'settings.changed';
      cid := new.id;
      details := jsonb_build_object('plan', new.plan, 'retention_days', new.retention_days);
    else
      action := TG_TABLE_NAME || '.' || lower(TG_OP);
      target := coalesce(r->>'name', r->>'url', r->>'id');
      cid := (r->>'company_id')::uuid;
  end case;
  if action is null then return null; end if;
  if cid is null and r ? 'channel_id' then
    select company_id into cid from channels where id = (r->>'channel_id')::uuid;
  end if;
  cid := coalesce(cid, current_company());
  -- Deleting a company cascades through its channels; there is no company left to log against
  if cid is not null and not exists (select 1 from companies where id = cid) then return null; end if;
  insert into audit_log (actor, action, target, details, company_id) values (auth.uid(), action, target, details, cid);
  return null;
end $$;

create trigger companies_audit after update on public.companies
  for each row when (old.plan is distinct from new.plan or old.retention_days is distinct from new.retention_days)
  execute function public.audit();

-- Usage for the admin's Plan card ---------------------------------------------------

create or replace function public.company_usage() returns json
language plpgsql stable security definer set search_path = public as $$
declare co uuid := current_company();
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return json_build_object(
    'members', (select count(*) from company_members where company_id = co and status = 'active'),
    'storage_bytes', storage_used(co),
    'webhooks', (select count(*) from channel_webhooks w join channels c on c.id = w.channel_id where c.company_id = co),
    'workflows', (select count(*) from workflows w join channels c on c.id = w.channel_id where c.company_id = co)
  );
end $$;

-- Contact and sales requests -------------------------------------------------------
-- Written by /api/contact (public form and in-app upgrade requests), which also emails them; super admins read them.

create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sales', 'upgrade', 'general')),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  company text not null default '' check (length(company) <= 200),
  team_size text not null default '' check (length(team_size) <= 40),
  message text not null default '' check (length(message) <= 5000),
  company_id uuid references public.companies on delete set null,
  user_id uuid default auth.uid() references public.profiles on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index contact_requests_created_idx on public.contact_requests (created_at desc);
alter table public.contact_requests enable row level security;

create policy "anyone submits" on public.contact_requests for insert to anon, authenticated with check (
  user_id is not distinct from auth.uid() and handled_at is null
  and (company_id is null or is_company_admin(company_id))
);
create policy "super admins read" on public.contact_requests for select to authenticated using (is_super_admin());
create policy "super admins handle" on public.contact_requests for update to authenticated using (is_super_admin());

-- Light spam brake: five requests per email address per hour
create or replace function public.throttle_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from contact_requests where lower(email) = lower(new.email) and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests. Please try again later.';
  end if;
  return new;
end $$;
create trigger contact_requests_throttle before insert on public.contact_requests
for each row execute function public.throttle_contact();

-- An admin asks for a plan change; the company is flagged for super admins and the request is logged
create or replace function public.request_upgrade(p_plan text, p_message text default '') returns json
language plpgsql security definer set search_path = public as $$
declare co companies; who record;
begin
  if not is_admin() then raise exception 'only admins can change the plan'; end if;
  if p_plan not in ('pro', 'enterprise') then raise exception 'unknown plan'; end if;
  select * into co from companies where id = current_company();
  select coalesce(nullif(p.full_name, ''), p.username) as name, u.email into who
  from profiles p join auth.users u on u.id = p.id where p.id = auth.uid();
  perform set_config('app.company_rpc', 'on', true);
  update companies set upgrade_requested_at = now() where id = co.id;
  insert into contact_requests (kind, name, email, company, message, company_id)
  values (case when p_plan = 'enterprise' then 'sales' else 'upgrade' end, who.name, who.email, co.name,
          format('Requested plan: %s (currently %s). %s', p_plan, co.plan, coalesce(p_message, '')), co.id);
  return json_build_object('name', who.name, 'email', who.email, 'company', co.name, 'handle', co.handle, 'plan', co.plan,
                           'members', (select count(*) from company_members where company_id = co.id and status = 'active'));
end $$;

-- Super admin list of companies, now with plan details
drop function public.platform_companies();
create function public.platform_companies()
returns table (id uuid, name text, handle text, logo_url text, created_at timestamptz, owner_id uuid, owner_name text, owner_email text,
               members bigint, channels bigint, messages bigint, messages_7d bigint, last_activity timestamptz,
               plan text, upgrade_requested_at timestamptz, storage_bytes bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.handle, c.logo_url, c.created_at, c.owner_id, coalesce(nullif(p.full_name, ''), p.username), u.email::text,
         (select count(*) from company_members m where m.company_id = c.id and m.status = 'active'),
         (select count(*) from channels ch where ch.company_id = c.id and ch.kind <> 'dm'),
         s.messages, s.messages_7d, s.last_activity,
         c.plan, c.upgrade_requested_at, storage_used(c.id)
  from companies c
  left join profiles p on p.id = c.owner_id
  left join auth.users u on u.id = c.owner_id
  left join lateral (
    select count(*) messages, count(*) filter (where m.created_at > now() - interval '7 days') messages_7d, max(m.created_at) last_activity
    from messages m join channels ch on ch.id = m.channel_id where ch.company_id = c.id
  ) s on true
  where is_super_admin()
  order by c.upgrade_requested_at desc nulls last, c.created_at desc;
$$;
