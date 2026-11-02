-- Thread read cursors + unread counts for followed threads

create table public.thread_reads (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  message_id uuid not null references public.messages on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.thread_reads enable row level security;
create policy "own thread reads" on public.thread_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A thread is followed by its author, anyone who replied, and anyone mentioned in it
create or replace function public.follows_thread(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages
    where (id = p_id or parent_id = p_id) and (user_id = auth.uid() or auth.uid() = any (mentions))
  );
$$;

create or replace function public.my_threads() returns setof public.messages
language sql stable security invoker set search_path = public as $$
  select * from messages p
  where p.reply_count > 0 and p.parent_id is null and follows_thread(p.id)
  order by p.last_reply_at desc
  limit 50;
$$;

-- Unread replies per followed thread. Without a read cursor, replies after the user's own last post in it count.
create or replace function public.thread_unreads()
returns table (message_id uuid, channel_id uuid, unread bigint, mentions bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.channel_id,
         count(r.id),
         count(r.id) filter (where auth.uid() = any (r.mentions))
  from messages p
  join channel_members cm on cm.channel_id = p.channel_id and cm.user_id = auth.uid()
  left join thread_reads tr on tr.message_id = p.id and tr.user_id = auth.uid()
  join messages r on r.parent_id = p.id and r.deleted_at is null
    and (r.user_id <> auth.uid() or r.bot_name is not null)
    and r.created_at > coalesce(
      tr.last_read_at,
      (select max(created_at) from messages o where (o.id = p.id or o.parent_id = p.id) and o.user_id = auth.uid()),
      '-infinity'
    )
  where p.reply_count > 0 and p.parent_id is null and follows_thread(p.id)
  group by p.id, p.channel_id;
$$;
