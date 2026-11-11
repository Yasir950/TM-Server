# Workchime mobile (iOS + Android)

A native React Native (Expo) client for the app only; the marketing site stays on the web.
It talks straight to the same Supabase project as the web app, and its calls interoperate with web and desktop.

## What's in it

- **Sign-in**: sign in, sign up, password reset; workspace create / join with invite / find by handle
- **Home**: search, Threads, Saved, Reminders, Meetings, Projects, My tasks, then Starred / Channels / DMs with unread and mention badges
- **Conversations**: realtime messages with Slack-style formatting, day dividers, "New" divider, typing indicators,
  jump-to-message, threads ("also send to channel"), reactions + emoji picker, edit/delete/pin/save/copy/mark unread,
  images inline, voice clips (record + play), photo/video/camera/file uploads (plan size and storage limits),
  @mention and /command autocomplete, drafts, link previews, bot Block Kit, call summaries
- **Channels**: browse/join, create (public/private), details (rename, topic, notifications, star, mute, archive, leave,
  convert group DM), members + add people, pinned, files, incoming webhooks, Canvas with checklists
- **DMs tab**, **Activity tab** (mentions, thread mentions, task assignments), **You tab** (status, pause notifications,
  profile with photo/email/password, workspaces, company, admin, super admin)
- **Meet calls**: mesh WebRTC with the web app's signaling, mute, video, flip camera, speaker, raise hand, reactions,
  invite people, ringing in and out (realtime + push), meeting auto-ring, plan call caps, call log
- **Meetings**: list, schedule, respond, cancel, join; live banner in the conversation
- **Projects and tasks**: projects list, create, board by status with search and filters, task detail (all fields,
  labels, due date, estimate, comments, history), project settings (people, roles, lead, archive, delete), My tasks
- **Company**: people directory, invite by email, invite links, join requests, join settings, email domains,
  company profile and logo, leave/delete; member admin tools (role, title, deactivate, transfer ownership, remove)
- **Admin**: plan and usage, upgrade request, analytics, member roles, retention, workflows, DLP, Events API, audit log
- **Super admin**: platform stats, companies (plan, open, conversations, delete), users, requests
- **Push notifications** for messages, mentions, thread replies, task assignments and incoming calls; app icon badge

## Run it

Node 20+ is needed.

```
cd mobile
copy .env.example .env        # same Supabase URL and anon key as the web app
npm install
npx expo install --fix        # aligns every native package with the installed Expo SDK
```

Calls (react-native-webrtc) and push need a **development build**; Expo Go can't load them:

```
npm i -g eas-cli; eas login; eas init         # writes the EAS projectId into app.json
eas build --profile development --platform android   # or ios; install it on the device
npx expo start --dev-client
```

## Backend setup (once)

1. Run `supabase/migrations/20261111000000_mobile_push.sql` then `20261112000000_voip_push.sql` (phone tokens, VoIP tokens).
2. Deploy the web app so `/api/push/send` has the Expo sender. Optionally set `EXPO_ACCESS_TOKEN`.
3. `eas credentials`: upload the APNs key (iOS) and the FCM v1 service account (Android).
4. TURN for calls is the web app's `/api/turn`, so set the Cloudflare or Metered TURN keys there (see `.env.example`).

## Lock-screen calls

- **iOS**: the web app sends a PushKit VoIP push straight to Apple (`src/lib/apns.ts`); `plugins/withVoip.js` reports it to
  CallKit in native code, so the phone shows the system call screen even when locked or the app is closed. Answering,
  declining and hanging up there go through `lib/callkit.ts`. Needs `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`
  (and `APNS_TOPIC` if the bundle id changes) in the web app's environment, and `supabase/migrations/20261112000000_voip_push.sql`.
  Without the APNs keys iPhones fall back to an ordinary call notification.
- **Android**: calls arrive as data-only pushes; a background task shows a full-screen incoming-call notification
  (over the lock screen) with Answer and Decline. On Android 14+ the person may need to allow "full-screen notifications"
  for the app in Settings the first time.

## Screen sharing from the phone

- **Android**: MediaProjection inside a foreground service; Android asks for permission each time.
- **iOS**: a Broadcast Upload extension (`targets/broadcast`, added by `@bacons/apple-targets`) shares through the app group
  `group.app.workchime.mobile`. Register that app group and the `app.workchime.mobile.broadcast` bundle id in the Apple
  Developer account (EAS does this when it manages credentials). Tapping Share opens the system picker; choose Workchime.

## Known limits

- Invite links are web URLs; to open them straight in the app, set up universal links / app links for the domain.

## Release

`eas build --profile production` then `eas submit -p ios` / `-p android`. Bundle id `app.workchime.mobile`.
