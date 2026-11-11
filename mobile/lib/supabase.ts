import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Tokens only refresh while the app is in the foreground
AppState.addEventListener("change", (s) => (s === "active" ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh()));

export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "https://workchime.vercel.app";

// Mirrors src/lib/supabase.ts (the fields the mobile app uses)
export type Profile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  status_emoji: string;
  status_text: string;
  status_expires_at: string | null;
  dnd_until: string | null;
  current_company_id: string | null;
  // Role in the current company, merged in from company_members
  role: Role;
};
export const isAdmin = (p?: Profile) => p?.role === "owner" || p?.role === "admin";
export const inDnd = (p?: Profile) => !!p?.dnd_until && p.dnd_until > new Date().toISOString();
export const activeStatus = (p?: Profile) =>
  p && (p.status_emoji || p.status_text) && (!p.status_expires_at || p.status_expires_at > new Date().toISOString()) ? { emoji: p.status_emoji, text: p.status_text } : null;
export type Role = "owner" | "admin" | "member" | "guest";
export type PlanId = "free" | "pro" | "enterprise";
export type Company = {
  id: string;
  name: string;
  handle: string;
  logo_url: string | null;
  email: string;
  phone: string;
  industry: string;
  size: string;
  website: string;
  address: string;
  description: string;
  owner_id: string | null;
  allow_join_requests: boolean;
  members_can_invite: boolean;
  plan: PlanId;
  created_at: string;
  upgrade_requested_at: string | null;
  retention_days: number | null;
};
// A row of public.plans: null limits are unlimited
export type Plan = {
  id: PlanId;
  name: string;
  price_cents: number | null;
  max_members: number | null;
  storage_bytes: number | null;
  max_file_bytes: number | null;
  history_days: number | null;
  purge_days: number | null;
  max_call_participants: number | null;
  max_webhooks: number | null;
  max_workflows: number | null;
  guests: boolean;
  ai_summaries: boolean;
  events_api: boolean;
  dlp: boolean;
  audit_log: boolean;
  custom_retention: boolean;
};
// A row of company_directory(): fields the viewer may not see come back null or empty
export type Member = {
  user_id: string;
  role: Role;
  status: "active" | "deactivated";
  designation: string;
  department: string;
  email: string | null;
  phone: string;
  phone_visible: boolean;
  joined_at: string;
  last_sign_in_at: string | null;
};
export const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
export type Channel = { id: string; name: string | null; topic: string; kind: "public" | "private" | "dm"; archived: boolean; company_id: string; created_at: string };
export type Membership = { channel_id: string; user_id: string; last_read_at: string; muted: boolean; starred: boolean; notify: "default" | "all" | "mentions" | "nothing" };
// Recorded clips also carry their length in seconds
export type Attachment = { name: string; path: string; size: number; type: string; duration?: number };
export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  attachments: Attachment[];
  mentions: string[];
  reply_count: number;
  edited_at: string | null;
  deleted_at: string | null;
  also_in_channel: boolean;
  pinned_at: string | null;
  bot_name: string | null;
  // Bot Block Kit and call summaries; the mobile app shows call summaries only
  blocks: { type: string; duration?: number; people?: string[] }[] | null;
  created_at: string;
};
export type Reaction = { message_id: string; user_id: string; emoji: string; channel_id: string };

export type Reminder = { id: string; user_id: string; text: string; remind_at: string; done_at: string | null; created_at: string };
export type Invitee = { user_id: string; response: "pending" | "accepted" | "declined" };
// A meetings row with its invitees and conversation embedded
export type Meeting = {
  id: string;
  channel_id: string;
  title: string;
  description: string;
  starts_at: string;
  duration_minutes: number;
  created_by: string;
  started_at: string | null;
  cancelled_at: string | null;
  meeting_invitees: Invitee[];
  channels: { name: string | null; kind: Channel["kind"]; company_id: string } | null;
};
export const meetingEnd = (m: Meeting) => Date.parse(m.starts_at) + m.duration_minutes * 60_000;
export const meetingLive = (m: Meeting, now = Date.now()) => !m.cancelled_at && Date.parse(m.starts_at) <= now && now < meetingEnd(m);

// Projects and tasks (supabase/migrations/*_projects_tasks.sql)
export type ProjectMember = { project_id: string; user_id: string; role: "admin" | "member"; added_at: string };
export type Project = { id: string; company_id: string; key: string; name: string; description: string; lead_id: string | null; created_by: string | null; archived: boolean; created_at: string; project_members: ProjectMember[] };
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type TaskPriority = "lowest" | "low" | "medium" | "high" | "highest";
export type TaskType = "task" | "bug" | "story" | "epic";
export type Task = {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  reporter_id: string | null;
  due_date: string | null;
  labels: string[];
  estimate: number | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
export type TaskComment = { id: string; task_id: string; user_id: string; body: string; edited_at: string | null; created_at: string };
export type TaskActivity = { id: number; task_id: string; user_id: string | null; field: string; old_value: string | null; new_value: string | null; created_at: string };

// A row of public.notifications (task assignments)
export type AppNotification = { id: string; user_id: string; company_id: string | null; kind: string; actor_id: string | null; task_id: string | null; title: string; body: string; read_at: string | null; created_at: string };

export const displayName = (p?: Profile) => (p ? p.full_name || p.username : "Unknown");
export const mentionsMe = (m: Message, uid: string) => m.mentions.includes(uid) || /(^|\s)@(channel|here)\b/.test(m.body);
