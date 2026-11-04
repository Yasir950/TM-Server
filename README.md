# True Meridian — Team Messaging

Next.js 16 + Supabase (Auth, Postgres, Realtime, Storage).

## Phase 1 (core messaging)

- Email/password auth, auto profile + auto-join `#general`
- Public/private channels: create, browse, join, leave, topic, members, mute
- 1:1, self and group DMs (up to 9 people)
- Messages: Slack-style formatting, edit/delete, emoji reactions, @mentions with autocomplete
- Threads in a side panel with reply counts
- File attachments (button, drag-drop, paste) with image previews, stored in a private bucket behind signed URLs
- Realtime delivery, typing indicators, online presence
- Per-user read cursors: unread bold, mention badges, "New" divider
- Desktop notifications for DMs and mentions; per-conversation drafts

## Setup

1. Create a Supabase project and run `supabase/migrations/20261102000000_phase1_core_messaging.sql`
   (SQL editor, or `supabase db push`).
2. Copy `.env.example` to `.env.local` and fill in the project URL and anon key.
3. `npm install` then `npm run dev`, and open http://localhost:3000.

For quick local testing, turn off "Confirm email" under Auth → Providers → Email.

## Push notifications (app closed)

Messages and incoming calls reach people whose app isn't open: browsers through Web Push, the desktop app by
staying in the tray (closing its window hides it; it opens at login and pops up for incoming calls).

1. `npx web-push generate-vapid-keys`, then set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   and a random `PUSH_SECRET` in the deployment's environment.
2. Enable the `pg_net` extension (Database → Extensions) and run
   `supabase/migrations/20261103000000_push_notifications.sql`.
3. Tell the database where to deliver, in the SQL editor:
   `insert into push_config (url, secret) values ('https://your-app.example.com', '<PUSH_SECRET>');`

The URL must be reachable from Supabase, so push doesn't work against `localhost`; use the deployed app or a tunnel.
Each person enables it once with the "Enable notifications" button in the sidebar.

## Plans (Free, Pro, Enterprise)

Every company has a plan; the limits live in the `plans` table and are enforced by the database
(`supabase/migrations/20261104010000_plans.sql`, which also explains how they were sized from Supabase's quotas).

| | Free | Pro ($100 / company / month) | Enterprise |
|---|---|---|---|
| Members | 10 | 250 | unlimited |
| Message history | 90 days (deleted after 1 year) | unlimited | unlimited |
| File storage / largest file | 1 GB / 10 MB | 25 GB / 250 MB | unlimited / 250 MB |
| Meet | 1:1 | up to 10 people | up to 10 people |
| Webhooks / workflows | 2 / 2 | unlimited | unlimited |
| Guests, AI summaries, Events API, DLP, audit log, custom retention | – | yes | yes |

1. Run the migration. Companies that already exist are moved to Pro so nothing they use disappears; new companies start on Free.
2. Raise the project's upload limit to 250 MB (Dashboard → Storage → Settings) so Pro's file size works.
3. Payments aren't automated yet: an admin requests an upgrade from Admin → Plan, the request is emailed and listed under
   Super admin → Requests, and a super admin switches the plan in Super admin → Companies.
4. For the email, set `RESEND_API_KEY` (and optionally `CONTACT_EMAIL`, `CONTACT_FROM`); see `.env.example`.

The public pricing page reads its numbers from `src/lib/plans.ts`; keep them in step with the `plans` table.
