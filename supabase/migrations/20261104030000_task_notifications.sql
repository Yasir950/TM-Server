-- Task assignment notifications: a saved in-app notification (listed under Activity, toasted live),
-- a Web Push (unless Do Not Disturb) and an email to the assignee.
-- Email goes the same way as push: the database posts to <push_config.url>/api/email/send over pg_net
-- with the push_config secret, and that route sends through Resend (RESEND_API_KEY).

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  company_id uuid references public.companies on delete cascade,
  kind text not null check (kind in ('task_assigned')),
  actor_id uuid references public.profiles on delete set null,
  task_id uuid references public.tasks on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own read" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "clear own" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Only read_at changes from the client
create or replace function public.notifications_guard() returns trigger
language plpgsql as $$
declare r timestamptz := new.read_at;
begin
  new := old;
  new.read_at := r;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications for each row execute function public.notifications_guard();

alter publication supabase_realtime add table public.notifications;

-- Sends one templated email. Needs pg_net and a push_config row; otherwise does nothing.
create or replace function public.email_to(p_user uuid, p_template text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cfg push_config; addr text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select * into cfg from push_config;
  if not found then return; end if;
  select email into addr from auth.users where id = p_user;
  if addr is null then return; end if;
  perform net.http_post(
    url := rtrim(cfg.url, '/') || '/api/email/send',
    body := jsonb_build_object('to', addr, 'template', p_template, 'data', p_data || jsonb_build_object('app_url', rtrim(cfg.url, '/'))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Push-Secret', cfg.secret)
  );
end $$;
revoke execute on function public.email_to(uuid, text, jsonb) from public, anon, authenticated;

-- tasks_after from *_projects_tasks.sql, now also saving a notification and emailing the assignee
create or replace function public.tasks_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare p projects; actor text; tkey text;
begin
  select * into p from projects where id = new.project_id;
  actor := coalesce(push_name(auth.uid()), 'Someone');
  tkey := p.key || '-' || new.number;
  if tg_op = 'INSERT' then
    insert into task_activity (task_id, user_id, field, new_value) values (new.id, auth.uid(), 'created', null);
  else
    insert into task_activity (task_id, user_id, field, old_value, new_value)
    select new.id, auth.uid(), f, o, n from (values
      ('status', old.status, new.status),
      ('priority', old.priority, new.priority),
      ('type', old.type, new.type),
      ('assignee', old.assignee_id::text, new.assignee_id::text),
      ('title', old.title, new.title),
      ('due_date', old.due_date::text, new.due_date::text)
    ) v(f, o, n) where o is distinct from n;
  end if;

  -- Newly assigned to someone other than the person making the change
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into notifications (user_id, company_id, kind, actor_id, task_id, title, body)
    values (new.assignee_id, p.company_id, 'task_assigned', auth.uid(), new.id, actor || ' assigned you ' || tkey, new.title);

    if not exists (select 1 from profiles where id = new.assignee_id and dnd_until > now()) then
      perform push_to(array[new.assignee_id], jsonb_build_object(
        'kind', 'message',
        'title', actor || ' assigned you ' || tkey,
        'body', new.title,
        'tag', 'task:' || new.id,
        'icon', (select avatar_url from profiles where id = auth.uid()),
        'url', '/?task=' || new.id
      ));
    end if;

    perform email_to(new.assignee_id, 'task_assigned', jsonb_build_object(
      'actor', actor,
      'assignee', coalesce(push_name(new.assignee_id), ''),
      'key', tkey,
      'title', new.title,
      'description', left(new.description, 2000),
      'project', p.name,
      'company', (select name from companies where id = p.company_id),
      'type', new.type,
      'priority', new.priority,
      'status', new.status,
      'due_date', new.due_date,
      'path', '/?task=' || new.id
    ));
  end if;
  return null;
end $$;
