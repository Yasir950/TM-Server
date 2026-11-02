import { createClient } from "@supabase/supabase-js";

// Read before the client consumes and clears the URL hash: true when the page was opened from a password reset email
export const openedFromRecoveryLink = typeof window !== "undefined" && /[#&]type=recovery\b/.test(window.location.hash);

// Keep an invite token from the URL through sign-up and email confirmation; components/chat/Company.tsx accepts it
if (typeof window !== "undefined") {
  const invite = new URLSearchParams(window.location.search).get("invite");
  try {
    if (invite) localStorage.setItem("tm-invite", invite);
  } catch {}
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export type Profile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  status_emoji: string;
  status_text: string;
  status_expires_at: string | null;
  dnd_until: string | null;
  // Role in the current company, merged in from company_members
  role: Role;
  current_company_id: string | null;
};

export type Role = "owner" | "admin" | "member" | "guest";

export const isAdmin = (p?: Profile) => p?.role === "owner" || p?.role === "admin";

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
  created_at: string;
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
  invited_by: string | null;
  last_sign_in_at: string | null;
};

// Uploads an image to the public avatars bucket and returns its URL
export async function uploadImage(folder: string, file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG or WebP image");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller");
  const path = `${folder}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file);
  if (error) throw error;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

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
  created_at: string;
  meeting_invitees: Invitee[];
  channels: Pick<Channel, "name" | "kind" | "company_id"> | null;
};

export const meetingEnd = (m: Meeting) => Date.parse(m.starts_at) + m.duration_minutes * 60_000;
export const meetingLive = (m: Meeting, now = Date.now()) => !m.cancelled_at && Date.parse(m.starts_at) <= now && now < meetingEnd(m);

export const activeStatus = (p?: Profile) =>
  p && (p.status_emoji || p.status_text) && (!p.status_expires_at || p.status_expires_at > new Date().toISOString())
    ? { emoji: p.status_emoji, text: p.status_text }
    : null;

export const inDnd = (p?: Profile) => !!p?.dnd_until && p.dnd_until > new Date().toISOString();

export type Webhook = { id: string; channel_id: string; name: string; token: string; created_by: string; created_at: string };

export type Channel = {
  id: string;
  name: string | null;
  topic: string;
  kind: "public" | "private" | "dm";
  created_by: string | null;
  archived: boolean;
  company_id: string;
  created_at: string;
};

export type Membership = {
  channel_id: string;
  user_id: string;
  last_read_at: string;
  muted: boolean;
  starred: boolean;
  notify: "default" | "all" | "mentions" | "nothing";
};

// Recorded clips also carry their length in seconds and a 0-1 waveform (voice only)
export type Attachment = { name: string; path: string; size: number; type: string; duration?: number; peaks?: number[] };

export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  attachments: Attachment[];
  mentions: string[];
  reply_count: number;
  last_reply_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  also_in_channel: boolean;
  bot_name: string | null;
  blocks: Block[] | null;
  created_at: string;
};

// Subset of Block Kit that messages render
type BkText = { type: "plain_text" | "mrkdwn"; text: string };
export type Block =
  | { type: "header"; text: BkText }
  | { type: "section"; text?: BkText; fields?: BkText[]; accessory?: { type: "image"; image_url: string; alt_text?: string } }
  | { type: "divider" }
  | { type: "context"; elements: (BkText | { type: "image"; image_url: string; alt_text?: string })[] }
  | { type: "image"; image_url: string; alt_text?: string; title?: BkText }
  | { type: "actions"; elements: { type: "button"; text: BkText; url?: string; style?: "primary" | "danger" }[] };

export type Workflow = {
  id: string;
  channel_id: string;
  name: string;
  trigger: "member_joined" | "keyword";
  keyword: string | null;
  reply: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

export const mentionsMe = (m: Message, uid: string) => m.mentions.includes(uid) || /(^|\s)@(channel|here)\b/.test(m.body);

export type Reaction = { message_id: string; user_id: string; emoji: string; channel_id: string };

export const displayName = (p?: Profile) => (p ? p.full_name || p.username : "Unknown");
