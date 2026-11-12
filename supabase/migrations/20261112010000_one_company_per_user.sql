-- A person belongs to at most one company.
-- Before this, accepting an invite to a company you were already in "succeeded" by just switching to it,
-- so a wrong or own-company link closed the dialog with nothing happening. Every way in now fails with a reason.
-- (Super admins reach every company through company_role(), not membership rows, so this does not limit them.)

-- Covers invites, join request approval, verified-domain sign-up, create_company and reactivation
create or replace function public.enforce_single_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare other text;
begin
  if new.status <> 'active' then return new; end if;
  select c.name into other from company_members m join companies c on c.id = m.company_id
  where m.user_id = new.user_id and m.company_id <> new.company_id and m.status = 'active' limit 1;
  if other is not null then
    raise exception 'You already belong to %. Leave it (owners: transfer ownership first) before joining another company.', other;
  end if;
  return new;
end $$;

drop trigger if exists company_members_single_company on public.company_members;
create trigger company_members_single_company before insert or update of status, company_id on public.company_members
for each row execute function public.enforce_single_company();

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv company_invites; mine text;
begin
  select * into inv from company_invites where token = p_token for update;
  if inv.id is null or inv.revoked_at is not null or inv.expires_at < now() or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'This invitation is invalid or has expired';
  end if;
  if inv.email is not null and inv.email <> lower((select email from auth.users where id = auth.uid())) then
    raise exception 'This invitation was sent to a different email address';
  end if;
  if exists (select 1 from company_members where company_id = inv.company_id and user_id = auth.uid() and status = 'active') then
    raise exception 'You are already a member of %', (select name from companies where id = inv.company_id);
  end if;
  select c.name into mine from company_members m join companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.status = 'active' limit 1;
  if mine is not null then
    raise exception 'You already belong to %. Leave it (owners: transfer ownership first) before joining another company.', mine;
  end if;
  update company_invites set uses = uses + 1 where id = inv.id;
  perform set_config('app.company_rpc', 'on', true);
  perform add_company_member(inv.company_id, auth.uid(), inv.role, inv.invited_by);
  return inv.company_id;
end $$;

-- Don't queue a request an admin could never approve
create or replace function public.request_join(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mine text;
begin
  if not (select allow_join_requests from companies where id = p_company) then raise exception 'this company does not accept join requests'; end if;
  select c.name into mine from company_members m join companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.status = 'active' limit 1;
  if mine is not null then
    raise exception 'You already belong to %. Leave it (owners: transfer ownership first) before joining another company.', mine;
  end if;
  insert into join_requests (company_id, user_id) values (p_company, auth.uid())
  on conflict (company_id, user_id) do update set status = 'pending', created_at = now();
end $$;
