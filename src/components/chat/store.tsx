"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, displayName, inDnd, meetingEnd, meetingLive, mentionsMe, type Channel, type Company, type Meeting, type Member, type Membership, type Message, type Plan, type Profile, type Project, type AppNotification } from "@/lib/supabase";
import { APP_NAME, call } from "@/lib/brand";
import { plainText, timeOf } from "@/lib/format";
import { enablePush, focusApp } from "@/lib/push";
import { AppSkeleton } from "../ui";

type Unread = Record<string, { unread: number; mentions: number }>;
// Keyed by thread parent id; only threads the user follows (started, replied to, or mentioned in)
type ThreadUnread = Record<string, { channelId: string; unread: number; mentions: number }>;
type Preview = { body: string; user_id: string; created_at: string };
export type View = "threads" | "saved" | "search" | "reminders" | "meetings" | "projects" | "tasks" | "admin" | "members" | "company" | "platform" | null;
export type Thread = { id: string; channelId: string };
// meeting: set when the ring is a scheduled meeting starting, rather than someone calling
export type Ring = { channelId: string; from: string; title: string; meeting?: string };
// In-app notification card; from is the sender's user id (absent for bots)
export type Toast = { id: string; title: string; body: string; from?: string; onOpen: () => void };

type ChatState = {
  me: Profile;
  profiles: Record<string, Profile>;
  // Null until the user creates or joins a company
  company: Company | null;
  // The current company's plan and its limits (null until there is a company)
  plan: Plan | null;
  companies: Company[];
  members: Record<string, Member>;
  // Platform operator: sees every company and is owner of each (supabase/migrations/*_super_admin.sql)
  superAdmin: boolean;
  switchCompany: (id: string) => Promise<void>;
  // The docked right pane shows one of: a thread, a member's profile, or a channel's details
  // User whose profile is open
  memberCard: string | null;
  showMember: (id: string | null) => void;
  // Channel whose details are open
  channelDetails: string | null;
  showChannelDetails: (id: string | null) => void;
  channels: Record<string, Channel>;
  memberships: Record<string, Membership>;
  dmMembers: Record<string, string[]>;
  unread: Unread;
  threadUnread: ThreadUnread;
  previews: Record<string, Preview>;
  online: Set<string>;
  away: Set<string>;
  activeId: string | null;
  thread: Thread | null;
  focusId: string | null;
  view: View;
  query: string;
  huddle: string | null;
  // Channel id → ids of the people currently in its huddle, across the workspace
  huddles: Record<string, string[]>;
  ring: Ring | null;
  huddleNotice: string | null;
  // People rung for the current huddle in the last 30 seconds who haven't declined
  ringing: Set<string>;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  setHuddle: (channelId: string | null) => void;
  inviteToHuddle: (userIds: string[]) => void;
  dismissRing: (decline?: boolean) => void;
  huddleName: (channelId: string) => string;
  // Meetings in the current company from the last week on, that the user is invited to or can see
  meetings: Meeting[];
  reloadMeetings: () => Promise<void>;
  // Projects in the current company the user can see (they're in it, or they're a company admin)
  projects: Project[];
  reloadProjects: () => Promise<void>;
  // Project whose board the "projects" view shows; null shows the list of projects
  projectId: string | null;
  openProject: (id: string | null) => void;
  // Task open in the task dialog, over whatever view is showing
  taskId: string | null;
  openTask: (id: string | null) => void;
  // Saved notifications (task assignments) in the current company, newest first
  notifications: AppNotification[];
  markNotificationsRead: (ids?: string[]) => void;
  setActive: (id: string | null, focusId?: string | null) => void;
  setThread: (t: Thread | null) => void;
  setView: (v: View, query?: string) => void;
  markRead: (channelId: string) => void;
  markUnread: (m: Message) => void;
  markThreadRead: (parentId: string) => void;
  updateMembership: (channelId: string, patch: Partial<Membership>) => Promise<void>;
  reload: () => Promise<void>;
  channelTitle: (c?: Channel) => string;
};

const Ctx = createContext<ChatState | null>(null);
export const useChat = () => useContext(Ctx)!;

// Workspace-wide room for huddle presence and rings, opened by ChatProvider
const huddleChannel = () => supabase.getChannels().find((c) => c.topic === "realtime:huddles");

// True the first time it is called for a key in this browser, so reloads and other tabs don't repeat a ring
function once(key: string) {
  try {
    if (localStorage.getItem(`tm:meeting:${key}`)) return false;
    localStorage.setItem(`tm:meeting:${key}`, "1");
  } catch {}
  return true;
}

// How long after a meeting starts invitees still get rung when they come online
const RING_WINDOW = 10 * 60_000;
const HEADS_UP = 5 * 60_000;

// Soft two-note chime, generated so no audio asset is needed
function chime() {
  try {
    const ac = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      o.type = "sine";
      const t = ac.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {}
}

export function ChatProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const uid = session.user.id;
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [channels, setChannels] = useState<Record<string, Channel>>({});
  const [memberships, setMemberships] = useState<Record<string, Membership>>({});
  const [dmMembers, setDmMembers] = useState<Record<string, string[]>>({});
  const [unread, setUnread] = useState<Unread>({});
  const [threadUnread, setThreadUnread] = useState<ThreadUnread>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [away, setAway] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(null);
  const [query, setQuery] = useState("");
  const [huddle, setHuddleState] = useState<string | null>(null);
  const [huddles, setHuddles] = useState<Record<string, string[]>>({});
  const [ring, setRing] = useState<Ring | null>(null);
  // The browser notification shown for the current ring, closed when the ring ends
  const ringNote = useRef<Notification | null>(null);
  const [huddleNotice, setHuddleNotice] = useState<string | null>(null);
  // User id → when they were last rung for the current huddle
  const [rung, setRung] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Names of huddles this user was invited to in conversations they can't see
  const [huddleTitles, setHuddleTitles] = useState<Record<string, string>>({});
  const [company, setCompany] = useState<Company | null>(null);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const plan = company ? (plans[company.plan] ?? null) : null;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [superAdmin, setSuperAdmin] = useState(false);
  const [memberCard, setMemberCard] = useState<string | null>(null);
  const [channelDetails, setChannelDetails] = useState<string | null>(null);
  const [allMeetings, setAllMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [allNotifications, setAllNotifications] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A conversation marked unread keeps its read cursor until the user navigates away
  const [heldRead, setHeldRead] = useState<string | null>(null);

  // Realtime callbacks read the latest state through this ref
  const live = useRef({ activeId, memberships, channels, profiles, thread, threadUnread, dmMembers, huddle, huddles, huddleTitles, ring });
  useEffect(() => {
    live.current = { activeId, memberships, channels, profiles, thread, threadUnread, dmMembers, huddle, huddles, huddleTitles, ring };
  }, [activeId, memberships, channels, profiles, thread, threadUnread, dmMembers, huddle, huddles, huddleTitles, ring]);

  const loadThreadUnread = useCallback(async () => {
    const { data } = await supabase.rpc("thread_unreads");
    const next: ThreadUnread = Object.fromEntries(
      (data ?? []).map((r: { message_id: string; channel_id: string; unread: number; mentions: number }) => [
        r.message_id,
        { channelId: r.channel_id, unread: Number(r.unread), mentions: Number(r.mentions) },
      ]),
    );
    setThreadUnread(next);
    return next;
  }, []);

  const reload = useCallback(async () => {
    const [{ data: profs }, { data: allMems }, { data: counts }, { data: prev }, { data: cos }, { data: dir }, { data: sa }, , { data: planRows }] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("channel_members").select("*").eq("user_id", uid),
      supabase.rpc("unread_counts"),
      supabase.rpc("channel_previews"),
      supabase.from("companies").select("*").order("name"),
      supabase.rpc("company_directory"),
      supabase.rpc("is_super_admin"),
      loadThreadUnread(),
      supabase.from("plans").select("*"),
    ]);
    const co = (profs ?? []).find((p) => p.id === uid)?.current_company_id ?? null;
    // Super admins get every conversation in the company so they can open any of them; the sidebar still lists only their own
    const chanQuery = supabase.from("channels").select("*").eq("company_id", co ?? crypto.randomUUID());
    const { data: chans } = await (sa ? chanQuery : chanQuery.in("id", (allMems ?? []).map((m) => m.channel_id)));
    const { data: dmRows } = await supabase
      .from("channel_members")
      .select("channel_id,user_id")
      .in("channel_id", (chans ?? []).filter((c) => c.kind === "dm").map((c) => c.id));
    // Only the current company's people and conversations are shown
    const inCo = new Set((chans ?? []).map((c) => c.id));
    const mems = (allMems ?? []).filter((m) => inCo.has(m.channel_id));
    const dirMap: Record<string, Member> = Object.fromEntries(((dir ?? []) as Member[]).map((m) => [m.user_id, m]));
    setSuperAdmin(!!sa);
    setCompanies(cos ?? []);
    setCompany((cos ?? []).find((c) => c.id === co) ?? null);
    setPlans(Object.fromEntries(((planRows ?? []) as Plan[]).map((p) => [p.id, p])));
    setMembers(dirMap);
    // The database treats super admins as owner of every company
    setProfiles(
      Object.fromEntries(
        (profs ?? []).filter((p) => p.id === uid || dirMap[p.id]).map((p) => [p.id, { ...p, role: p.id === uid && sa ? "owner" : (dirMap[p.id]?.role ?? "member") }]),
      ),
    );
    setMemberships(Object.fromEntries(mems.map((m) => [m.channel_id, m])));
    setChannels(Object.fromEntries((chans ?? []).map((c) => [c.id, c])));
    const dm: Record<string, string[]> = {};
    const dmIds = new Set((chans ?? []).filter((c) => c.kind === "dm").map((c) => c.id));
    for (const r of dmRows ?? []) if (dmIds.has(r.channel_id)) (dm[r.channel_id] ??= []).push(r.user_id);
    setDmMembers(dm);
    setPreviews(Object.fromEntries((prev ?? []).map((p: Preview & { channel_id: string }) => [p.channel_id, p])));
    setUnread(
      Object.fromEntries(
        (counts ?? []).map((r: { channel_id: string; unread: number; mentions: number }) => [
          r.channel_id,
          { unread: Number(r.unread), mentions: Number(r.mentions) },
        ]),
      ),
    );
    setLoaded(true);
  }, [uid, loadThreadUnread]);

  const switchCompany = useCallback(
    async (id: string) => {
      const { error } = await supabase.rpc("switch_company", { p_company: id });
      if (error) return alert(error.message);
      setActiveId(null);
      setThread(null);
      setMemberCard(null);
      setChannelDetails(null);
      setViewState(null);
      setProjectId(null);
      setTaskId(null);
      await reload();
    },
    [reload],
  );

  const markThreadRead = useCallback(
    (parentId: string) => {
      setThreadUnread((t) => {
        if (!t[parentId]) return t;
        const next = { ...t };
        delete next[parentId];
        return next;
      });
      supabase.from("thread_reads").upsert({ user_id: uid, message_id: parentId, last_read_at: new Date().toISOString() }).then();
    },
    [uid],
  );

  const markRead = useCallback(
    (channelId: string) => {
      if (heldRead === channelId) return;
      const now = new Date().toISOString();
      setUnread((u) => (u[channelId]?.unread ? { ...u, [channelId]: { unread: 0, mentions: 0 } } : u));
      setMemberships((m) => (m[channelId] ? { ...m, [channelId]: { ...m[channelId], last_read_at: now } } : m));
      supabase.from("channel_members").update({ last_read_at: now }).match({ channel_id: channelId, user_id: uid }).then();
    },
    [uid, heldRead],
  );

  // Moves the read cursor to just before this message and holds it until the user leaves the conversation
  const markUnread = useCallback(
    async (m: Message) => {
      setHeldRead(m.channel_id);
      const at = new Date(new Date(m.created_at).getTime() - 1).toISOString();
      await supabase.from("channel_members").update({ last_read_at: at }).match({ channel_id: m.channel_id, user_id: uid });
      await reload();
    },
    [uid, reload],
  );

  const updateMembership = useCallback(
    async (channelId: string, patch: Partial<Membership>) => {
      setMemberships((m) => ({ ...m, [channelId]: { ...m[channelId], ...patch } }));
      await supabase.from("channel_members").update(patch).match({ channel_id: channelId, user_id: uid });
    },
    [uid],
  );

  const setActive = useCallback((id: string | null, focus: string | null = null) => {
    setHeldRead((h) => (h === id ? h : null));
    setActiveId(id);
    setThread(null);
    setChannelDetails(null);
    setFocusId(focus);
    setViewState(null);
    if (id) localStorage.setItem("tm:active", id);
  }, []);

  const setView = useCallback((v: View, q = "") => {
    setHeldRead(null);
    setViewState(v);
    setQuery(q);
    setThread(null);
    setChannelDetails(null);
    setProjectId(null);
  }, []);

  const openProject = useCallback((id: string | null) => {
    setHeldRead(null);
    setViewState("projects");
    setProjectId(id);
    setThread(null);
    setChannelDetails(null);
  }, []);

  // Opening something in the right pane replaces whatever it showed
  const openThread = useCallback((t: Thread | null) => {
    setThread(t);
    if (!t) return;
    setMemberCard(null);
    setChannelDetails(null);
  }, []);
  const showMember = useCallback((id: string | null) => {
    setMemberCard(id);
    if (!id) return;
    setThread(null);
    setChannelDetails(null);
  }, []);
  const showChannelDetails = useCallback((id: string | null) => {
    setChannelDetails(id);
    if (!id) return;
    setThread(null);
    setMemberCard(null);
  }, []);

  // Permalinks and notification clicks: ?c=channel&m=message[&t=thread] opens a conversation,
  // ?ring=channel&from=caller&where=title shows the incoming-call dialog. True when a conversation was opened.
  const openLink = useCallback(
    (params: URLSearchParams) => {
      const ringId = params.get("ring");
      const from = params.get("from");
      if (ringId && from && live.current.huddle !== ringId) {
        const where = params.get("where") ?? `a ${call}`;
        setHuddleTitles((t) => ({ ...t, [ringId]: where }));
        setRing({ channelId: ringId, from, title: where });
      }
      const task = params.get("task");
      if (task) setTaskId(task);
      const c = params.get("c");
      if (!c) return false;
      setActive(c, params.get("m"));
      const t = params.get("t");
      if (t) setThread({ id: t, channelId: c });
      return true;
    },
    [setActive],
  );

  useEffect(() => {
    // State is set after the async fetch resolves, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload().then(() => {
      // A link wins over the last opened conversation
      const params = new URLSearchParams(location.search);
      if (params.has("c") || params.has("ring") || params.has("task")) history.replaceState(null, "", "/app");
      if (!openLink(params)) setActiveId((cur) => cur ?? localStorage.getItem("tm:active"));
    });
  }, [reload, openLink]);

  // Push notifications: keep this browser subscribed, and handle clicks on them (public/sw.js) while the app is open
  useEffect(() => {
    enablePush();
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "open") openLink(new URL(e.data.url, location.origin).searchParams);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [uid, openLink]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Global realtime: unread counts, previews, notifications, membership and profile changes
  useEffect(() => {
    // A system notification when the app is in the background and allowed to; otherwise an in-app card
    const alert = (msg: Message, title: string, onOpen: () => void) => {
      chime();
      const body = plainText(msg.body).slice(0, 140) || "Sent an attachment";
      if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification(title, { body, tag: msg.id, icon: profilesAvatar(msg) });
        n.onclick = () => {
          focusApp();
          onOpen();
        };
        return;
      }
      setToasts((t) => [...t.slice(-2), { id: msg.id, title, body, from: msg.bot_name ? undefined : msg.user_id, onOpen }]);
      setTimeout(() => dismissToast(msg.id), 7000);
    };
    const profilesAvatar = (msg: Message) => (msg.bot_name ? undefined : live.current.profiles[msg.user_id]?.avatar_url) || "/asset/AppIcon.svg";

    // Replies in followed threads: refresh badges, and notify when the reply is new to this user
    const onThreadReply = async (msg: Message) => {
      const { thread, threadUnread: before, memberships, channels, profiles } = live.current;
      if (thread?.id === msg.parent_id && document.visibilityState === "visible") return;
      const after = await loadThreadUnread();
      const parentId = msg.parent_id!;
      const mem = memberships[msg.channel_id];
      if ((after[parentId]?.unread ?? 0) <= (before[parentId]?.unread ?? 0) || msg.also_in_channel) return;
      if (mem.muted || mem.notify === "nothing" || inDnd(profiles[uid])) return;
      const ch = channels[msg.channel_id];
      const from = msg.bot_name ?? displayName(profiles[msg.user_id]);
      alert(msg, ch?.kind === "dm" ? `${from} replied in a thread` : `${from} replied in a thread in #${ch?.name}`, () => {
        setActive(msg.channel_id, parentId);
        setThread({ id: parentId, channelId: msg.channel_id });
      });
    };

    const db = supabase
      .channel("global")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: m }) => {
        const msg = m as Message;
        const { activeId, memberships, channels, profiles } = live.current;
        const mem = memberships[msg.channel_id];
        if (!mem) return;
        if (msg.parent_id && (msg.user_id !== uid || msg.bot_name)) onThreadReply(msg);
        if (msg.parent_id && !msg.also_in_channel) return;
        setPreviews((p) => ({ ...p, [msg.channel_id]: { body: msg.body, user_id: msg.user_id, created_at: msg.created_at } }));
        if (msg.user_id === uid && !msg.bot_name) return;
        if (msg.channel_id === activeId && document.visibilityState === "visible") return;

        const ch = channels[msg.channel_id];
        const important = ch?.kind === "dm" || mentionsMe(msg, uid);
        setUnread((u) => {
          const cur = u[msg.channel_id] ?? { unread: 0, mentions: 0 };
          return { ...u, [msg.channel_id]: { unread: cur.unread + 1, mentions: cur.mentions + (important ? 1 : 0) } };
        });

        const level = mem.notify === "default" ? (ch?.kind === "dm" ? "all" : "mentions") : mem.notify;
        const notify = !mem.muted && !inDnd(profiles[uid]) && (level === "all" || (level === "mentions" && important));
        if (!notify) return;
        const from = msg.bot_name ?? displayName(profiles[msg.user_id]);
        alert(msg, ch?.kind === "dm" ? from : `${from} in #${ch?.name}`, () => setActive(msg.channel_id, msg.id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "channel_members", filter: `user_id=eq.${uid}` }, () => reload())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "channels" }, ({ new: c }) =>
        setChannels((cs) => (cs[(c as Channel).id] ? { ...cs, [(c as Channel).id]: c as Channel } : cs)),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, ({ new: p }) =>
        setProfiles((ps) => {
          const id = (p as Profile).id;
          return ps[id] ? { ...ps, [id]: { ...(p as Profile), role: ps[id].role } } : ps;
        }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "company_members" }, () => reload())
      .subscribe();

    // Presence: hidden tabs report as away
    const presence = supabase.channel("online", { config: { presence: { key: uid } } });
    const track = () => presence.track({ away: document.visibilityState === "hidden" });
    presence
      .on("presence", { event: "sync" }, () => {
        const state = presence.presenceState<{ away: boolean }>();
        setOnline(new Set(Object.keys(state)));
        setAway(new Set(Object.entries(state).filter(([, metas]) => metas.every((x) => x.away)).map(([k]) => k)));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") track();
      });
    document.addEventListener("visibilitychange", track);

    return () => {
      document.removeEventListener("visibilitychange", track);
      supabase.removeChannel(db);
      supabase.removeChannel(presence);
    };
  }, [uid, reload, setActive, loadThreadUnread, dismissToast]);

  // Huddles: presence says who is in which huddle; broadcasts ring people and carry their replies
  useEffect(() => {
    const ch = supabase.channel("huddles", { config: { presence: { key: uid }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, () => {
      const next: Record<string, string[]> = {};
      for (const [id, metas] of Object.entries(ch.presenceState<{ channel: string | null }>()))
        for (const c of new Set(metas.map((m) => m.channel))) if (c) (next[c] ??= []).push(id);
      setHuddles(next);
    })
      .on("broadcast", { event: "ring" }, ({ payload }) => {
        const r = payload as Ring & { to: string[] };
        const { huddle, profiles } = live.current;
        if (!r.to.includes(uid) || huddle === r.channelId) return;
        setHuddleTitles((t) => ({ ...t, [r.channelId]: r.title }));
        setRing({ channelId: r.channelId, from: r.from, title: r.title });
        if (inDnd(profiles[uid])) return;
        // The desktop app pops its window up out of the tray so the call dialog is seen
        window.workchime?.ring();
        if (document.hasFocus() || !("Notification" in window) || Notification.permission !== "granted") return;
        const n = new Notification(`${displayName(profiles[r.from])} is calling you`, {
          icon: "/asset/AppIcon.svg",
          body: `in ${r.title} · click to answer`,
          tag: `huddle:${r.channelId}`,
          requireInteraction: true,
        });
        n.onclick = () => {
          focusApp();
          n.close();
        };
        ringNote.current?.close();
        ringNote.current = n;
        setTimeout(() => n.close(), 30_000);
      })
      .on("broadcast", { event: "decline" }, ({ payload }) => {
        const { huddle, profiles } = live.current;
        if (payload.to !== uid || payload.channelId !== huddle) return;
        setHuddleNotice(`${displayName(profiles[payload.from])} declined`);
        setRung((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== payload.from)));
      })
      // The caller hung up before anyone answered
      .on("broadcast", { event: "cancel" }, ({ payload }) => {
        if (!Array.isArray(payload?.to) || !payload.to.includes(uid)) return;
        setRing((r) => (r && !r.meeting && r.channelId === payload.channelId && r.from === payload.from ? null : r));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && live.current.huddle) ch.track({ channel: live.current.huddle });
      });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);

  useEffect(() => {
    const ch = huddleChannel();
    if (huddle) ch?.track({ channel: huddle });
    else ch?.untrack();
  }, [huddle]);

  // The system notification for a call goes away with the call, however it stopped ringing
  useEffect(() => {
    if (ring) return;
    ringNote.current?.close();
    ringNote.current = null;
  }, [ring]);

  useEffect(() => {
    if (!huddleNotice) return;
    const t = setTimeout(() => setHuddleNotice(null), 6000);
    return () => clearTimeout(t);
  }, [huddleNotice]);

  const reloadMeetings = useCallback(async () => {
    const { data } = await supabase
      .from("meetings")
      .select("*, meeting_invitees(user_id, response), channels(name, kind, company_id)")
      .gte("starts_at", new Date(Date.now() - 7 * 86400_000).toISOString())
      .order("starts_at");
    setAllMeetings((data as Meeting[]) ?? []);
  }, []);

  useEffect(() => {
    // State is set after the async fetch resolves, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadMeetings();
    const ch = supabase
      .channel("meetings")
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () => reloadMeetings())
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_invitees" }, () => reloadMeetings())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [reloadMeetings]);

  const meetings = useMemo(() => allMeetings.filter((m) => m.channels?.company_id === company?.id), [allMeetings, company]);

  const companyId = company?.id;
  const reloadProjects = useCallback(async () => {
    if (!companyId) return setProjects([]);
    const { data } = await supabase.from("projects").select("*, project_members(*)").eq("company_id", companyId).order("name");
    setProjects((data as Project[]) ?? []);
  }, [companyId]);

  // Projects and their people
  useEffect(() => {
    // State is set after the async fetch resolves, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadProjects();
    const ch = supabase
      .channel("projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => reloadProjects())
      .on("postgres_changes", { event: "*", schema: "public", table: "project_members" }, () => reloadProjects())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid, reloadProjects]);

  // Saved notifications (task assignments): listed under Activity, and a toast or system notification as they arrive
  useEffect(() => {
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setAllNotifications((data as AppNotification[]) ?? []));
    const announce = (n: AppNotification) => {
      if (inDnd(live.current.profiles[uid])) return;
      const open = () => n.task_id && setTaskId(n.task_id);
      chime();
      // Same tag as the Web Push, so a closed-app push and this don't show twice
      if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
        const sys = new Notification(n.title, { body: n.body, tag: `task:${n.task_id}`, icon: (n.actor_id && live.current.profiles[n.actor_id]?.avatar_url) || "/asset/AppIcon.svg" });
        sys.onclick = () => {
          focusApp();
          open();
        };
        return;
      }
      setToasts((t) => [...t.slice(-2), { id: n.id, title: n.title, body: n.body, from: n.actor_id ?? undefined, onOpen: open }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
    };
    const ch = supabase
      .channel("notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, ({ new: row }) => {
        const n = row as AppNotification;
        setAllNotifications((ns) => (ns.some((x) => x.id === n.id) ? ns : [n, ...ns]));
        announce(n);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, ({ new: row }) =>
        setAllNotifications((ns) => ns.map((x) => (x.id === (row as AppNotification).id ? (row as AppNotification) : x))),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);

  const notifications = useMemo(() => allNotifications.filter((n) => !n.company_id || n.company_id === companyId), [allNotifications, companyId]);

  // Marks these (or all unread in the company) as read
  const markNotificationsRead = useCallback(
    (ids?: string[]) => {
      const target = new Set(ids ?? notifications.filter((n) => !n.read_at).map((n) => n.id));
      if (!target.size) return;
      const now = new Date().toISOString();
      setAllNotifications((ns) => ns.map((n) => (target.has(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
      supabase.from("notifications").update({ read_at: now }).in("id", [...target]).is("read_at", null).then();
    },
    [notifications],
  );

  // Scheduled meetings dial in by themselves: each invitee's client gives a heads-up shortly before,
  // then rings them at the start time with the same incoming-call dialog as a direct call
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const { huddle, profiles } = live.current;
      const quiet = inDnd(profiles[uid]);
      const canNotify = "Notification" in window && Notification.permission === "granted" && !quiet;
      for (const m of meetings) {
        const mine = m.meeting_invitees.find((i) => i.user_id === uid);
        if (!mine || mine.response === "declined" || m.cancelled_at) continue;
        const start = Date.parse(m.starts_at);
        if (now >= start - HEADS_UP && now < start && once(`soon:${m.id}`)) {
          if (!quiet) chime();
          if (canNotify) new Notification(`${m.title} starts at ${timeOf(m.starts_at)}`, { icon: "/asset/AppIcon.svg", body: `You'll be called in when it starts`, tag: `meeting-soon:${m.id}` });
        }
        if (now >= start && now < Math.min(meetingEnd(m), start + RING_WINDOW) && once(`ring:${m.id}`)) {
          if (huddle === m.channel_id) continue;
          const where = m.channels?.kind === "dm" ? m.title : `#${m.channels?.name}`;
          setHuddleTitles((t) => ({ ...t, [m.channel_id]: where }));
          setRing({ channelId: m.channel_id, from: m.created_by, title: m.title, meeting: m.id });
          if (!quiet) window.workchime?.ring();
          if (!canNotify || document.hasFocus()) continue;
          const n = new Notification(`📅 ${m.title} is starting`, { icon: "/asset/AppIcon.svg", body: "Click to join the call", tag: `meeting:${m.id}`, requireInteraction: true });
          n.onclick = () => {
            focusApp();
            n.close();
          };
          setTimeout(() => n.close(), 30_000);
        }
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [meetings, uid]);

  const ringHuddle = useCallback(
    (channelId: string, to: string[]) => {
      if (!to.length) return;
      const c = channels[channelId];
      const title = !c ? (huddleTitles[channelId] ?? `a ${call}`) : c.kind === "dm" ? (dmMembers[channelId] ?? []).map((id) => displayName(profiles[id])).join(", ") : `#${c.name}`;
      huddleChannel()?.send({ type: "broadcast", event: "ring", payload: { to, channelId, from: uid, title } });
      // Rings people whose app is closed, through Web Push
      supabase.rpc("push_ring", { p_channel: channelId, p_to: to }).then();
      // Their phone rings for 30 seconds; a newer ring of the same person outlives this one
      const at = Date.now();
      setRung((r) => ({ ...r, ...Object.fromEntries(to.map((id) => [id, at])) }));
      setTimeout(() => setRung((r) => Object.fromEntries(Object.entries(r).filter(([, t]) => t !== at))), 30_000);
    },
    [uid, channels, dmMembers, profiles, huddleTitles],
  );

  const setHuddle = useCallback(
    (channelId: string | null) => {
      // Hanging up before anyone answered stops the ringing on their end
      // Calls are capped by the plan (Free: 1:1); joining a full call is refused here
      const cap = plan?.max_call_participants;
      if (channelId && channelId !== huddle && cap && (huddles[channelId]?.length ?? 0) >= cap) {
        window.alert(`This call is full. The ${plan?.name} plan allows up to ${cap} people in a call${plan?.id === "free" ? "; upgrade to Pro for group calls" : ""}.`);
        return;
      }
      const ringingNow = Object.keys(rung);
      if (huddle && huddle !== channelId && ringingNow.length && !(huddles[huddle] ?? []).some((id) => id !== uid)) {
        huddleChannel()?.send({ type: "broadcast", event: "cancel", payload: { to: ringingNow, channelId: huddle, from: uid } });
        supabase.rpc("push_cancel_ring", { p_channel: huddle, p_to: ringingNow }).then();
      }
      setHuddleState(channelId);
      setHuddleNotice(null);
      setRung({});
      setRing((r) => (r?.channelId === channelId ? null : r));
      // Starting a huddle calls the other people in the conversation, unless it's already running or a meeting there is already calling everyone
      const c = channelId ? channels[channelId] : undefined;
      if (!channelId || !c || huddles[channelId]?.length || meetings.some((m) => m.channel_id === channelId && meetingLive(m))) return;
      if (c.kind === "dm") ringHuddle(channelId, (dmMembers[channelId] ?? []).filter((id) => id !== uid));
      else
        supabase
          .from("channel_members")
          .select("user_id")
          .eq("channel_id", channelId)
          .then(({ data }) => ringHuddle(channelId, (data ?? []).map((r) => r.user_id).filter((id) => id !== uid)));
    },
    [uid, huddle, rung, channels, dmMembers, huddles, meetings, ringHuddle, plan],
  );

  const inviteToHuddle = useCallback((userIds: string[]) => {
    if (huddle) ringHuddle(huddle, userIds);
  }, [huddle, ringHuddle]);

  const dismissRing = useCallback(
    (decline = false) => {
      if (decline && ring && ring.from !== uid) huddleChannel()?.send({ type: "broadcast", event: "decline", payload: { to: ring.from, from: uid, channelId: ring.channelId } });
      setRing(null);
    },
    [uid, ring],
  );

  // Deliver due reminders and meeting announcements even where pg_cron isn't scheduled
  useEffect(() => {
    const fire = () => {
      supabase.rpc("fire_reminders").then();
      supabase.rpc("fire_meetings").then();
    };
    fire();
    const t = setInterval(fire, 30_000);
    return () => clearInterval(t);
  }, []);

  // Unread badge in the browser tab title
  useEffect(() => {
    const threads = Object.values(threadUnread).filter((t) => !memberships[t.channelId]?.muted);
    const mentions =
      Object.entries(unread).reduce((n, [id, u]) => n + (memberships[id]?.muted ? 0 : u.mentions), 0) + threads.reduce((n, t) => n + t.mentions, 0);
    const any = Object.entries(unread).some(([id, u]) => u.unread && !memberships[id]?.muted) || threads.length > 0;
    document.title = `${mentions ? `(${mentions}) ` : any ? "• " : ""}${APP_NAME}`;
  }, [unread, threadUnread, memberships]);

  const channelTitle = useCallback(
    (c?: Channel) => {
      if (!c) return "";
      if (c.kind !== "dm") return c.name ?? "";
      const others = (dmMembers[c.id] ?? []).filter((id) => id !== uid);
      if (others.length === 0) return `${displayName(profiles[uid])} (you)`;
      return others.map((id) => displayName(profiles[id])).join(", ");
    },
    [dmMembers, profiles, uid],
  );

  const huddleName = useCallback(
    (id: string) => {
      const c = channels[id];
      if (!c) return huddleTitles[id] ?? `a ${call}`;
      return c.kind === "dm" ? channelTitle(c) : `#${c.name}`;
    },
    [channels, channelTitle, huddleTitles],
  );

  const ringing = useMemo(() => new Set(Object.keys(rung)), [rung]);

  const value = useMemo<ChatState | null>(
    () =>
      profiles[uid]
        ? {
            me: profiles[uid],
            profiles,
            company,
            plan,
            companies,
            members,
            superAdmin,
            switchCompany,
            memberCard,
            showMember,
            channelDetails,
            showChannelDetails,
            channels,
            memberships,
            dmMembers,
            unread,
            threadUnread,
            previews,
            online,
            away,
            activeId: activeId && channels[activeId] ? activeId : null,
            thread,
            focusId,
            view,
            query,
            huddle,
            huddles,
            ring,
            huddleNotice,
            ringing,
            toasts,
            dismissToast,
            setHuddle,
            inviteToHuddle,
            dismissRing,
            huddleName,
            meetings,
            reloadMeetings,
            projects,
            reloadProjects,
            projectId: projectId && projects.some((p) => p.id === projectId) ? projectId : null,
            openProject,
            taskId,
            openTask: setTaskId,
            notifications,
            markNotificationsRead,
            setActive,
            setThread: openThread,
            setView,
            markRead,
            markUnread,
            markThreadRead,
            updateMembership,
            reload,
            channelTitle,
          }
        : null,
    [profiles, company, plan, companies, members, superAdmin, switchCompany, memberCard, showMember, channelDetails, showChannelDetails, openThread, uid, channels, memberships, dmMembers, unread, threadUnread, previews, online, away, activeId, thread, focusId, view, query, huddle, huddles, ring, huddleNotice, ringing, toasts, dismissToast, setHuddle, inviteToHuddle, dismissRing, huddleName, meetings, reloadMeetings, projects, reloadProjects, projectId, openProject, taskId, notifications, markNotificationsRead, setActive, setView, markRead, markUnread, markThreadRead, updateMembership, reload, channelTitle],
  );

  if (!loaded || !value) return <AppSkeleton />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
