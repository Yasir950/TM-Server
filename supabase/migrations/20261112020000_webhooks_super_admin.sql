-- Channel integrations (incoming webhooks) are managed by super admins only.
-- Existing webhooks keep posting: post_webhook() is security definer and looks tokens up itself.

drop policy if exists "members see webhooks" on public.channel_webhooks;
drop policy if exists "members add webhooks" on public.channel_webhooks;
drop policy if exists "members remove webhooks" on public.channel_webhooks;

create policy "super admins see webhooks" on public.channel_webhooks for select to authenticated
  using (is_super_admin() and is_member(channel_id));
create policy "super admins add webhooks" on public.channel_webhooks for insert to authenticated
  with check (created_by = auth.uid() and is_super_admin() and is_member(channel_id));
create policy "super admins remove webhooks" on public.channel_webhooks for delete to authenticated
  using (is_super_admin() and is_member(channel_id));
