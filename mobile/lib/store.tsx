import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { supabase, displayName, mentionsMe, type AppNotification, type Meeting, type Project, type Channel, type Company, type Member, type Membership, type Message, type Plan, type Profile } from "./supabase";

type Counts = Record<string, { unread: number; mentions: number }>;
// Keyed by thread parent id; only threads the user follows
type ThreadCounts = Record<string, { channelId: string; unread: number; mentions: number }>;
type Preview = { body: string; user_id: string; created_at: string };

type ChatState = {
  uid: string;
  me: Profile;
  profiles: Record<string, Profile>;
  company: Company | null;
  plan: Plan | null;
  companies: Company[];
  members: Record<string, Member>;
  superAdmin: boolean;
  channels: Record<string, Channel>;
  memberships: Record<string, Membership>;
  dmMembers: Record<string, string[]>;
  unread: Counts;
  threadUnread: ThreadCounts;
  previews: Record<string, Preview>;
  online: Set<string>;
  away: Set<string>;
  // Saved notifications (task assignments) in the current company, newest first
  notifications: AppNotification[];
  markNotificationsRead: (ids?: string[]) => void;
  // Meetings in the current company from the last week on
  meetings: Meeting[];
  reloadMeetings: () => Promise<void>;
  // Projects in the current company the user can see
  projects: Project[];
  reloadProjects: () => Promise<void>;
  // The conversation on screen: incoming messages there don't count as unread
  setOpen: (channelId: string | null) => void;
  markRead: (channelId: string) => void;
  markUnread: (m: Message) => Promise<void>;
  markThreadRead: (parentId: string) => void;
  updateMembership: (channelId: string, patch: Partial<Membership>) => Promise<void>;
  reload: () => Promise<void>;
  switchCompany: (id: string) => Promise<void>;
  channelTitle: (c?: Channel) => string;
};

const Ctx = createContext<ChatState | null>(null);
export const useChat = () => useContext(Ctx)!;

// Same queries as the web store (src/components/chat/store.tsx)
export function ChatProvider({ uid, children, fallback }: { uid: string; children: React.ReactNode; fallback: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [company, setCompany] = useState<Company | null>(null);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [members, setMembers] = useState<Record<string, Member>>({});
  const [superAdmin, setSuperAdmin] = useState(false);
  const [channels, setChannels] = useState<Record<string, Channel>>({});
  const [memberships, setMemberships] = useState<Record<string, Membership>>({});
  const [dmMembers, setDmMembers] = useState<Record<string, string[]>>({});
  const [unread, setUnread] = useState<Counts>({});
  const [threadUnread, setThreadUnread] = useState<ThreadCounts>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [away, setAway] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const open = useRef<string | null>(null);
  const mems = useRef(memberships);
  mems.current = memberships;

  const loadThreadUnread = useCallback(async () => {
    const { data } = await supabase.rpc("thread_unreads");
    setThreadUnread(
      Object.fromEntries(
        (data ?? []).map((r: { message_id: string; channel_id: string; unread: number; mentions: number }) => [r.message_id, { channelId: r.channel_id, unread: Number(r.unread), mentions: Number(r.mentions) }]),
      ),
    );
  }, []);

  const reload = useCallback(async () => {
    const [{ data: profs }, { data: allMems }, { data: counts }, { data: prev }, { data: cos }, { data: dir }, { data: sa }, { data: planRows }] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("channel_members").select("*").eq("user_id", uid),
      supabase.rpc("unread_counts"),
      supabase.rpc("channel_previews"),
      supabase.from("companies").select("*").order("name"),
      supabase.rpc("company_directory"),
      supabase.rpc("is_super_admin"),
      supabase.from("plans").select("*"),
      loadThreadUnread(),
    ]);
    const co = (profs ?? []).find((p) => p.id === uid)?.current_company_id ?? null;
    // Super admins get every conversation in the company so they can open any; lists still show only their own
    const q = supabase.from("channels").select("*").eq("company_id", co ?? "00000000-0000-0000-0000-000000000000");
    const { data: chans } = await (sa ? q : q.in("id", (allMems ?? []).map((m) => m.channel_id)));
    const dmIds = (chans ?? []).filter((c) => c.kind === "dm").map((c) => c.id);
    const { data: dmRows } = dmIds.length ? await supabase.from("channel_members").select("channel_id,user_id").in("channel_id", dmIds) : { data: [] };
    const inCo = new Set((chans ?? []).map((c) => c.id));
    const dirMap: Record<string, Member> = Object.fromEntries(((dir ?? []) as Member[]).map((m) => [m.user_id, m]));
    setSuperAdmin(!!sa);
    setCompanies(cos ?? []);
    setCompany((cos ?? []).find((c) => c.id === co) ?? null);
    setPlans(Object.fromEntries(((planRows ?? []) as Plan[]).map((p) => [p.id, p])));
    setMembers(dirMap);
    setProfiles(
      Object.fromEntries(
        (profs ?? []).filter((p) => p.id === uid || dirMap[p.id]).map((p) => [p.id, { ...p, role: p.id === uid && sa ? "owner" : (dirMap[p.id]?.role ?? "member") }]),
      ),
    );
    setMemberships(Object.fromEntries((allMems ?? []).filter((m) => inCo.has(m.channel_id)).map((m) => [m.channel_id, m])));
    setChannels(Object.fromEntries((chans ?? []).map((c) => [c.id, c])));
    const dm: Record<string, string[]> = {};
    for (const r of dmRows ?? []) (dm[r.channel_id] ??= []).push(r.user_id);
    setDmMembers(dm);
    setPreviews(Object.fromEntries((prev ?? []).map((p: Preview & { channel_id: string }) => [p.channel_id, p])));
    setUnread(Object.fromEntries((counts ?? []).map((r: { channel_id: string; unread: number; mentions: number }) => [r.channel_id, { unread: Number(r.unread), mentions: Number(r.mentions) }])));
    setLoaded(true);
  }, [uid, loadThreadUnread]);

  const markRead = useCallback(
    (channelId: string) => {
      const now = new Date().toISOString();
      setUnread((u) => (u[channelId]?.unread ? { ...u, [channelId]: { unread: 0, mentions: 0 } } : u));
      setMemberships((m) => (m[channelId] ? { ...m, [channelId]: { ...m[channelId], last_read_at: now } } : m));
      supabase.from("channel_members").update({ last_read_at: now }).match({ channel_id: channelId, user_id: uid }).then();
    },
    [uid],
  );

  // Moves the read cursor to just before this message (as the web app does)
  const markUnread = useCallback(
    async (m: Message) => {
      const at = new Date(Date.parse(m.created_at) - 1).toISOString();
      await supabase.from("channel_members").update({ last_read_at: at }).match({ channel_id: m.channel_id, user_id: uid });
      await reload();
    },
    [uid, reload],
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

  const updateMembership = useCallback(
    async (channelId: string, patch: Partial<Membership>) => {
      setMemberships((m) => ({ ...m, [channelId]: { ...m[channelId], ...patch } }));
      await supabase.from("channel_members").update(patch).match({ channel_id: channelId, user_id: uid });
    },
    [uid],
  );

  const switchCompany = useCallback(
    async (id: string) => {
      const { error } = await supabase.rpc("switch_company", { p_company: id });
      if (error) return alert(error.message);
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    reload();
    // Back from the background: catch up on anything missed while the socket slept, and report presence
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") reload();
      presence.track({ away: s !== "active" });
    });

    const db = supabase
      .channel("global")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: row }) => {
        const msg = row as Message;
        if (!mems.current[msg.channel_id]) return;
        if (msg.parent_id && (msg.user_id !== uid || msg.bot_name)) loadThreadUnread();
        if (msg.parent_id && !msg.also_in_channel) return;
        setPreviews((p) => ({ ...p, [msg.channel_id]: { body: msg.body, user_id: msg.user_id, created_at: msg.created_at } }));
        if ((msg.user_id === uid && !msg.bot_name) || msg.channel_id === open.current) return;
        setUnread((u) => {
          const cur = u[msg.channel_id] ?? { unread: 0, mentions: 0 };
          return { ...u, [msg.channel_id]: { unread: cur.unread + 1, mentions: cur.mentions + (mentionsMe(msg, uid) ? 1 : 0) } };
        });
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

    const presence = supabase.channel("online", { config: { presence: { key: uid } } });
    presence
      .on("presence", { event: "sync" }, () => {
        const state = presence.presenceState<{ away: boolean }>();
        setOnline(new Set(Object.keys(state)));
        setAway(new Set(Object.entries(state).filter(([, metas]) => metas.every((x) => x.away)).map(([k]) => k)));
      })
      .subscribe((s) => s === "SUBSCRIBED" && presence.track({ away: AppState.currentState !== "active" }));

    // Due reminders and meeting announcements are delivered by whichever client is open (as on the web)
    const fire = () => {
      supabase.rpc("fire_reminders").then();
      supabase.rpc("fire_meetings").then();
    };
    fire();
    const t = setInterval(fire, 30_000);

    return () => {
      clearInterval(t);
      sub.remove();
      supabase.removeChannel(db);
      supabase.removeChannel(presence);
    };
  }, [uid, reload, loadThreadUnread]);

  const [allNotifications, setAllNotifications] = useState<AppNotification[]>([]);
  useEffect(() => {
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setAllNotifications((data as AppNotification[]) ?? []));
    const ch = supabase
      .channel("notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, ({ new: row }) =>
        setAllNotifications((ns) => (ns.some((x) => x.id === (row as AppNotification).id) ? ns : [row as AppNotification, ...ns])),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, ({ new: row }) =>
        setAllNotifications((ns) => ns.map((x) => (x.id === (row as AppNotification).id ? (row as AppNotification) : x))),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);
  const companyId = company?.id;
  const notifications = useMemo(() => allNotifications.filter((n) => !n.company_id || n.company_id === companyId), [allNotifications, companyId]);
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

  const [allMeetings, setAllMeetings] = useState<Meeting[]>([]);
  const reloadMeetings = useCallback(async () => {
    const { data } = await supabase
      .from("meetings")
      .select("*, meeting_invitees(user_id, response), channels(name, kind, company_id)")
      .gte("starts_at", new Date(Date.now() - 7 * 86400_000).toISOString())
      .order("starts_at");
    setAllMeetings((data as Meeting[]) ?? []);
  }, []);
  useEffect(() => {
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
  const meetings = useMemo(() => allMeetings.filter((m) => m.channels?.company_id === companyId), [allMeetings, companyId]);

  const [projects, setProjects] = useState<Project[]>([]);
  const reloadProjects = useCallback(async () => {
    if (!companyId) return setProjects([]);
    const { data } = await supabase.from("projects").select("*, project_members(*)").eq("company_id", companyId).order("name");
    setProjects((data as Project[]) ?? []);
  }, [companyId]);
  useEffect(() => {
    reloadProjects();
    const ch = supabase
      .channel("projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => reloadProjects())
      .on("postgres_changes", { event: "*", schema: "public", table: "project_members" }, () => reloadProjects())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [reloadProjects]);

  // App icon badge: unread DMs and mentions, like the web tab title
  useEffect(() => {
    const n =
      Object.entries(unread).reduce((sum, [id, u]) => sum + (memberships[id]?.muted ? 0 : channels[id]?.kind === "dm" ? u.unread : u.mentions), 0) +
      Object.values(threadUnread).reduce((sum, t) => sum + t.mentions, 0);
    Notifications.setBadgeCountAsync(n).catch(() => {});
  }, [unread, threadUnread, memberships, channels]);

  const channelTitle = useCallback(
    (c?: Channel) => {
      if (!c) return "";
      if (c.kind !== "dm") return c.name ?? "";
      const others = (dmMembers[c.id] ?? []).filter((id) => id !== uid);
      return others.length ? others.map((id) => displayName(profiles[id])).join(", ") : `${displayName(profiles[uid])} (you)`;
    },
    [dmMembers, profiles, uid],
  );

  const setOpen = useCallback((id: string | null) => {
    open.current = id;
  }, []);

  const plan = company ? (plans[company.plan] ?? null) : null;
  const value = useMemo<ChatState | null>(
    () =>
      profiles[uid]
        ? {
            uid,
            me: profiles[uid],
            profiles,
            company,
            plan,
            companies,
            members,
            superAdmin,
            channels,
            memberships,
            dmMembers,
            unread,
            threadUnread,
            previews,
            online,
            away,
            notifications,
            markNotificationsRead,
            meetings,
            reloadMeetings,
            projects,
            reloadProjects,
            setOpen,
            markRead,
            markUnread,
            markThreadRead,
            updateMembership,
            reload,
            switchCompany,
            channelTitle,
          }
        : null,
    [uid, profiles, company, plan, companies, members, superAdmin, channels, memberships, dmMembers, unread, threadUnread, previews, online, away, notifications, markNotificationsRead, meetings, reloadMeetings, projects, reloadProjects, setOpen, markRead, markUnread, markThreadRead, updateMembership, reload, switchCompany, channelTitle],
  );

  if (!loaded || !value) return fallback;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
