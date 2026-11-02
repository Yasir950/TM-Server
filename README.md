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
