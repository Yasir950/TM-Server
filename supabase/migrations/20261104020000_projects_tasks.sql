-- Projects and tasks (Jira-style): a company's members create projects, add people to them,
-- and track tasks on a board. Each task gets a key from its project (WEB-12), a status column,
-- a priority, an assignee who must be in the project, comments and a change history.

-- Tables ----------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  key text not null check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 2000),
  lead_id uuid references public.profiles on delete set null,
  created_by uuid references public.profiles on delete set null default auth.uid(),
  archived boolean not null default false,
  -- The number the next task in this project gets
  next_number int not null default 1,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

-- 'admin' manages the project's settings and people; 'member' works on tasks
create table public.project_members (
  project_id uuid references public.projects on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  added_by uuid references public.profiles on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  -- Assigned from projects.next_number on insert
  number int not null default 0,
  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '' check (length(description) <= 20000),
  type text not null default 'task' check (type in ('task', 'bug', 'story', 'epic')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'in_review', 'done')),
  priority text not null default 'medium' check (priority in ('lowest', 'low', 'medium', 'high', 'highest')),
  assignee_id uuid references public.profiles on delete set null,
  reporter_id uuid references public.profiles on delete set null default auth.uid(),
  due_date date,
  labels text[] not null default '{}',
  estimate numeric check (estimate is null or estimate >= 0),
  -- Order within a status column; lower comes first
  position double precision not null default extract(epoch from now()),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create index tasks_project_idx on public.tasks (project_id, status, position);
create index tasks_assignee_idx on public.tasks (assignee_id) where status <> 'done';

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks on delete cascade,
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  body text not null check (length(trim(body)) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- Written by the tasks trigger: one row per field change
create table public.task_activity (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks on delete cascade,
  user_id uuid references public.profiles on delete set null,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index task_activity_task_idx on public.task_activity (task_id, created_at);

-- Access helpers ----------------------------------------------------------

-- Project members (while active in its company) and the company's admins can see and work in a project
create or replace function public.can_access_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid and (
      is_company_admin(p.company_id)
      or (company_role(p.company_id) is not null
          and exists (select 1 from project_members m where m.project_id = pid and m.user_id = auth.uid()))
    )
  );
$$;

create or replace function public.can_manage_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid and (
      is_company_admin(p.company_id)
      or (company_role(p.company_id) is not null
          and exists (select 1 from project_members m where m.project_id = pid and m.user_id = auth.uid() and m.role = 'admin'))
    )
  );
$$;

create or replace function public.task_project(tid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from tasks where id = tid;
$$;

-- RPCs ------------------------------------------------------------------

-- Creates a project in the current company; the creator becomes its admin and lead
create or replace function public.create_project(p_name text, p_key text, p_description text default '', p_members uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare co uuid := current_company(); pid uuid; k text := upper(trim(p_key));
begin
  if coalesce(company_role(co), 'guest') = 'guest' then raise exception 'guests cannot create projects'; end if;
  if k !~ '^[A-Z][A-Z0-9]{1,9}$' then raise exception 'the key must be 2-10 letters or digits, starting with a letter'; end if;
  if exists (select 1 from projects where company_id = co and key = k) then raise exception 'a project with key % already exists', k; end if;
  insert into projects (company_id, key, name, description, lead_id, created_by)
  values (co, k, trim(p_name), trim(coalesce(p_description, '')), auth.uid(), auth.uid())
  returning id into pid;
  insert into project_members (project_id, user_id, role) values (pid, auth.uid(), 'admin');
  insert into project_members (project_id, user_id, role)
  select pid, m.user_id, 'member' from company_members m
  where m.company_id = co and m.status = 'active' and m.user_id = any (coalesce(p_members, '{}')) and m.user_id <> auth.uid()
  on conflict do nothing;
  return pid;
end $$;

-- Removes someone from a project and unassigns their open tasks there
create or replace function public.remove_project_member(p_project uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_manage_project(p_project) or p_user = auth.uid()) then raise exception 'only project admins can remove people'; end if;
  if (select role from project_members where project_id = p_project and user_id = p_user) = 'admin'
     and (select count(*) from project_members where project_id = p_project and role = 'admin') = 1
     and not is_company_admin((select company_id from projects where id = p_project)) then
    raise exception 'a project needs at least one admin; make someone else admin first';
  end if;
  delete from project_members where project_id = p_project and user_id = p_user;
  update tasks set assignee_id = null where project_id = p_project and assignee_id = p_user and status <> 'done';
end $$;

-- Triggers --------------------------------------------------------------

-- New tasks take the project's next number; the assignee must be in the project
create or replace function public.tasks_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update projects set next_number = next_number + 1 where id = new.project_id returning next_number - 1 into new.number;
    new.reporter_id := coalesce(auth.uid(), new.reporter_id);
  else
    new.number := old.number;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (select 1 from project_members where project_id = new.project_id and user_id = new.assignee_id) then
    raise exception 'tasks can only be assigned to people in the project';
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now();
  elsif new.status <> 'done' then new.completed_at := null;
  end if;
  new.labels := array(select distinct lower(trim(l)) from unnest(new.labels) l where trim(l) <> '');
  return new;
end $$;
create trigger tasks_before before insert or update on public.tasks for each row execute function public.tasks_before();

-- History, and a push to whoever a task is newly assigned to
create or replace function public.tasks_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare pkey text; actor text;
begin
  select key into pkey from projects where id = new.project_id;
  actor := coalesce(push_name(auth.uid()), 'Someone');
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
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (select 1 from profiles where id = new.assignee_id and dnd_until > now()) then
    perform push_to(array[new.assignee_id], jsonb_build_object(
      'kind', 'message',
      'title', actor || ' assigned you ' || pkey || '-' || new.number,
      'body', new.title,
      'tag', 'task:' || new.id,
      'icon', (select avatar_url from profiles where id = auth.uid()),
      'url', '/?task=' || new.id
    ));
  end if;
  return null;
end $$;
create trigger tasks_after after insert or update on public.tasks for each row execute function public.tasks_after();

-- Comments push to the task's assignee and reporter
create or replace function public.task_comments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare t tasks; pkey text; recips uuid[];
begin
  select * into t from tasks where id = new.task_id;
  select key into pkey from projects where id = t.project_id;
  select array_agg(distinct u) into recips from unnest(array[t.assignee_id, t.reporter_id]) u
  where u is not null and u <> new.user_id
    and not exists (select 1 from profiles where id = u and dnd_until > now());
  perform push_to(recips, jsonb_build_object(
    'kind', 'message',
    'title', coalesce(push_name(new.user_id), 'Someone') || ' commented on ' || pkey || '-' || t.number,
    'body', left(new.body, 400),
    'tag', 'task-comment:' || new.id,
    'icon', (select avatar_url from profiles where id = new.user_id),
    'url', '/?task=' || t.id
  ));
  return null;
end $$;
create trigger task_comments_after after insert on public.task_comments for each row execute function public.task_comments_after();

-- Only the author edits a comment's body, and edits are stamped
create or replace function public.task_comments_before_update() returns trigger
language plpgsql as $$
begin
  new.task_id := old.task_id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.edited_at := now();
  return new;
end $$;
create trigger task_comments_before_update before update on public.task_comments for each row execute function public.task_comments_before_update();

-- Project fields that only change through the RPCs
create or replace function public.projects_guard() returns trigger
language plpgsql as $$
begin
  new.company_id := old.company_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.key is distinct from old.key then raise exception 'a project key cannot be changed'; end if;
  if pg_trigger_depth() = 1 then new.next_number := old.next_number; end if;
  if new.lead_id is not null and new.lead_id is distinct from old.lead_id
     and not exists (select 1 from project_members where project_id = new.id and user_id = new.lead_id) then
    raise exception 'the project lead must be in the project';
  end if;
  return new;
end $$;
create trigger projects_guard before update on public.projects for each row execute function public.projects_guard();

-- RLS -------------------------------------------------------------------

alter table public.projects enable row level security;
create policy "projects readable" on public.projects for select to authenticated using (can_access_project(id));
create policy "admins edit projects" on public.projects for update to authenticated using (can_manage_project(id));
create policy "admins delete projects" on public.projects for delete to authenticated using (can_manage_project(id));

alter table public.project_members enable row level security;
create policy "project members readable" on public.project_members for select to authenticated using (can_access_project(project_id));
-- Admins add active members of the project's company
create policy "admins add people" on public.project_members for insert to authenticated with check (
  can_manage_project(project_id) and exists (
    select 1 from projects p join company_members m on m.company_id = p.company_id
    where p.id = project_id and m.user_id = project_members.user_id and m.status = 'active')
);
create policy "admins change roles" on public.project_members for update to authenticated using (can_manage_project(project_id));

alter table public.tasks enable row level security;
create policy "tasks readable" on public.tasks for select to authenticated using (can_access_project(project_id));
create policy "members create tasks" on public.tasks for insert to authenticated with check (can_access_project(project_id));
create policy "members edit tasks" on public.tasks for update to authenticated using (can_access_project(project_id));
create policy "reporter or admin deletes" on public.tasks for delete to authenticated
  using (can_manage_project(project_id) or (reporter_id = auth.uid() and can_access_project(project_id)));

alter table public.task_comments enable row level security;
create policy "comments readable" on public.task_comments for select to authenticated using (can_access_project(task_project(task_id)));
create policy "members comment" on public.task_comments for insert to authenticated
  with check (user_id = auth.uid() and can_access_project(task_project(task_id)));
create policy "edit own comment" on public.task_comments for update to authenticated using (user_id = auth.uid());
create policy "delete own comment" on public.task_comments for delete to authenticated
  using (user_id = auth.uid() or can_manage_project(task_project(task_id)));

alter table public.task_activity enable row level security;
create policy "activity readable" on public.task_activity for select to authenticated using (can_access_project(task_project(task_id)));

-- task_activity is published so assignees hear about reassignments in the open app
alter publication supabase_realtime add table public.projects, public.project_members, public.tasks, public.task_comments, public.task_activity;
