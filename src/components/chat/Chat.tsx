"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, displayName, activeStatus, inDnd, isAdmin, meetingLive, type Channel, type Message, type Profile } from "@/lib/supabase";
import { dayLabel, timeOf } from "@/lib/format";
import { Avatar, Logo, Mark, RowSkeleton, StatusBadge, btn } from "../ui";
import { useChat } from "./store";
import ChannelView from "./ChannelView";
import ThreadPanel from "./ThreadPanel";
import { BrowseChannels, ChannelDetails, CreateChannel, NewDM } from "./Modals";
import { QuickSwitcher, RemindersView, SavedView, SearchView, StatusModal, ThreadsView } from "./Views";
import AdminView from "./Admin";
import SuperAdminView from "./SuperAdmin";
import { CompanyLogo, CompanySwitcher, CompanyView, InviteFromUrl, MemberCard, MembersView, Onboarding, ProfileModal } from "./Company";
import Huddle, { HuddleElsewhere, IncomingHuddle } from "./Huddle";
import { MeetingsView, useNow } from "./Meetings";
import { MyTasksView, ProjectsView, SidebarProjects, TaskDialog } from "./Projects";
import { ChannelIcon, Icon, type IconName } from "../icons";
import { APP_NAME, CALL, DESKTOP_AUTO_UPDATE_SINCE, DESKTOP_MAC_URL, DESKTOP_RELEASE, DESKTOP_WIN_URL, RAIL } from "@/lib/brand";
import { enablePush, signOut } from "@/lib/push";

export default function Chat() {
  const { activeId, thread, view, huddle, setHuddle, company, superAdmin, memberCard, members, channels, channelDetails, showChannelDetails, taskId } = useChat();
  const [switcher, setSwitcher] = useState(false);
  const [tab, setTab] = useState<Tab>("home");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcher((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A super admin outside every company lands on the platform overview and opens companies from there
  if (!company && superAdmin)
    return (
      <div className="flex h-full flex-col bg-white pt-[env(safe-area-inset-top)]">
        <SuperAdminView />
        <InviteFromUrl />
      </div>
    );
  if (!company)
    return (
      <>
        <Onboarding />
        <InviteFromUrl />
      </>
    );

  // Phones show one pane at a time, like Slack mobile: the tab list, or the open conversation/view (or its thread) full screen
  // The right pane (thread, profile or channel details) docks beside main and narrows it; below lg it takes main's place
  const detailsChannel = channelDetails ? channels[channelDetails] : undefined;
  const pane = thread ? (
    <ThreadPanel key={thread.id} messageId={thread.id} channelId={thread.channelId} />
  ) : detailsChannel ? (
    <ChannelDetails key={detailsChannel.id} channel={detailsChannel} onClose={() => showChannelDetails(null)} />
  ) : memberCard && members[memberCard] ? (
    <MemberCard key={memberCard} />
  ) : null;
  const open = !!(activeId || view || pane);
  const mobileList = open ? "hidden md:flex" : "flex";

  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]" style={{ background: RAIL }}>
      <DesktopUpdateBar />
      <TopBar onSwitcher={() => setSwitcher(true)} className={mobileList} />
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <Rail tab={tab} onTab={setTab} className={mobileList} />
        <div className="flex min-h-0 min-w-0 flex-1 bg-tm-surface md:gap-2 md:rounded-tl-2xl md:p-2">
          <Sidebar tab={tab} className={mobileList} />
          <main
            className={`tm-raised min-w-0 flex-1 flex-col overflow-hidden bg-white max-md:pb-[env(safe-area-inset-bottom)] md:rounded-2xl ${
              pane ? "hidden lg:flex" : open ? "flex" : "hidden md:flex"
            }`}
          >
            {view === "threads" ? <ThreadsView /> : view === "saved" ? <SavedView /> : view === "search" ? <SearchView /> : view === "reminders" ? <RemindersView /> : view === "meetings" ? <MeetingsView /> : view === "projects" ? <ProjectsView /> : view === "tasks" ? <MyTasksView /> : view === "admin" ? <AdminView /> : view === "platform" ? <SuperAdminView /> : view === "members" ? <MembersView /> : view === "company" ? <CompanyView key={company.id} /> : activeId ? <ChannelView key={activeId} channelId={activeId} /> : <Empty />}
          </main>
          {pane}
        </div>
      </div>
      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}
      {taskId && <TaskDialog key={taskId} />}
      {huddle && <Huddle key={huddle} channelId={huddle} onLeave={() => setHuddle(null)} />}
      <HuddleElsewhere />
      <IncomingHuddle />
      <InviteFromUrl />
      <Toasts />
    </div>
  );
}

// In-app notification cards for new DMs, mentions (including @channel) and thread replies
function Toasts() {
  const { toasts, dismissToast, profiles } = useChat();
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 bottom-20 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 md:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="tm-pop tm-float flex items-start gap-3 rounded-2xl bg-white p-3">
          <button
            onClick={() => {
              t.onOpen();
              dismissToast(t.id);
            }}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
          >
            {t.from ? <Avatar profile={profiles[t.from]} size={36} /> : <Mark size={36} className="rounded-[30%]" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-900">{t.title}</span>
              <span className="line-clamp-2 text-sm text-zinc-600">{t.body}</span>
            </span>
          </button>
          <button onClick={() => dismissToast(t.id)} title="Dismiss" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-tm-surface hover:text-zinc-700">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  const { me } = useChat();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="tm-fade flex flex-1 flex-col items-center justify-center gap-4 text-zinc-500">
      <Logo height={56} />
      <h2 className="text-xl font-semibold text-zinc-900">
        {greeting}, {displayName(me).split(" ")[0]}
      </h2>
      <p className="text-sm">Welcome back. Pick a channel or start a direct message.</p>
      <p className="text-xs text-zinc-400">
        Tip: press <kbd className="rounded-md border border-tm-line bg-tm-surface px-1.5 py-0.5 font-mono">Ctrl K</kbd> to jump anywhere
      </p>
    </div>
  );
}

function TopBar({ onSwitcher, className }: { onSwitcher: () => void; className: string }) {
  const { me, setView, query } = useChat();
  const [q, setQ] = useState(query);
  const [menu, setMenu] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const status = activeStatus(me);
  const dnd = inDnd(me);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const setDnd = async (hours: number | null) => {
    await pauseNotifications(me.id, hours);
    setMenu(false);
  };

  return (
    <header className={`${className} h-12 shrink-0 items-center gap-3 px-3 md:gap-4 md:px-4`} style={{ background: RAIL }}>
      {/* Lines up over the 48px rail on desktop */}
      <span className="flex shrink-0 justify-center md:-ml-4 md:w-12">
        <AppMenu />
      </span>
      <form
        className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-white transition focus-within:bg-white focus-within:text-zinc-900"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) setView("search", q.trim());
        }}
      >
        <Icon name="search" size={16} className="opacity-60" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages  ·  from:@name  in:#channel  has:link"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-current placeholder:opacity-60"
        />
        <button type="button" onClick={onSwitcher} className="hidden rounded-md border md:block border-current/20 px-1.5 py-0.5 font-mono text-[11px] opacity-60 hover:opacity-100">
          Ctrl K
        </button>
      </form>
      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-xl px-2 py-1 transition hover:bg-white/10">
          {status && <span title={status.text}>{status.emoji || <Icon name="messages" size={16} className="text-white/80" />}</span>}
          {dnd && (
            <span title="Notifications paused">
              <Icon name="moon" size={16} className="text-white/80" />
            </span>
          )}
          <Avatar profile={me} size={30} online />
        </button>
        {menu && (
          <div className="tm-pop tm-float absolute top-11 right-0 z-40 w-64 rounded-2xl bg-white p-2 text-sm">
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar profile={me} size={40} online />
              <div className="min-w-0">
                <div className="truncate font-semibold">{displayName(me)}</div>
                <div className="truncate text-xs text-zinc-500">{status ? `${status.emoji} ${status.text}` : `@${me.username}`}</div>
              </div>
            </div>
            <MenuItem icon="user" onClick={() => { setProfileModal(true); setMenu(false); }}>Edit profile</MenuItem>
            <MenuItem icon="smile" onClick={() => { setStatusModal(true); setMenu(false); }}>{status ? "Edit status" : "Set a status"}</MenuItem>
            <div className="my-1 h-px bg-tm-line" />
            {dnd ? (
              <MenuItem icon="bell" onClick={() => setDnd(null)}>Resume notifications</MenuItem>
            ) : (
              <>
                <div className="px-3 pt-1 pb-0.5 text-xs text-zinc-400">Pause notifications</div>
                {[[0.5, "30 minutes"], [1, "1 hour"], [8, "8 hours"], [24, "24 hours"]].map(([h, label]) => (
                  <MenuItem key={h} icon="moon" onClick={() => setDnd(h as number)}>{label}</MenuItem>
                ))}
              </>
            )}
            <div className="my-1 h-px bg-tm-line" />
            <MenuItem onClick={signOut}>Sign out</MenuItem>
          </div>
        )}
      </div>
      {statusModal && <StatusModal onClose={() => setStatusModal(false)} />}
      {profileModal && <ProfileModal onClose={() => setProfileModal(false)} />}
    </header>
  );
}

// Desktop app too old to update itself (see DESKTOP_AUTO_UPDATE_SINCE): ask for a one-time install. Hidden for the session once dismissed.
function DesktopUpdateBar() {
  const [show, setShow] = useState(false);
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    const v = /WorkchimeDesktop\/(\d+)\.(\d+)\.(\d+)/.exec(navigator.userAgent)?.slice(1).map(Number);
    if (!v) return;
    const i = v.findIndex((n, k) => n !== DESKTOP_AUTO_UPDATE_SINCE[k]);
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem("desktop-update-dismissed") === "1";
    } catch {}
    setShow(i >= 0 && v[i] < DESKTOP_AUTO_UPDATE_SINCE[i] && !dismissed);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      sessionStorage.setItem("desktop-update-dismissed", "1");
    } catch {}
    setShow(false);
  };
  return (
    <div className="flex items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <Icon name="download" size={16} className="shrink-0" />
      <span className="flex-1">A new version of the desktop app is ready. Install it once, and future updates arrive on their own.</span>
      <a href={`${DESKTOP_RELEASE}/${mac ? "Workchime.dmg" : "Workchime-Setup.exe"}`} target="_blank" rel="noreferrer" className="rounded-lg bg-amber-900 px-3 py-1 font-medium text-white hover:bg-amber-800">
        Download update
      </a>
      <button onClick={dismiss} className="rounded-lg p-1 hover:bg-amber-100" aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// The app mark opens a small menu offering the desktop app
function AppMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} title={APP_NAME} className="block rounded-[25%] transition hover:opacity-90">
        <Mark size={32} className="rounded-[25%]" />
      </button>
      {open && (
        <div className="tm-pop tm-float absolute top-11 left-0 z-40 w-64 rounded-2xl bg-white p-2 text-sm">
          <div className="px-2 py-2 font-semibold text-zinc-900">{APP_NAME}</div>
          {navigator.userAgent.includes("WorkchimeDesktop") ? (
            <p className="px-2 pb-1 text-zinc-500">You&apos;re using the desktop app.</p>
          ) : (
            // Mac gets the .dmg, everyone else the Windows installer
            <a
              href={/Mac/i.test(navigator.platform || navigator.userAgent) ? DESKTOP_MAC_URL : DESKTOP_WIN_URL}
              download
              onClick={() => setOpen(false)}
              className={`${btn} flex w-full items-center justify-center gap-2`}
            >
              <Icon name="download" size={16} />
              Download desktop app
            </a>
          )}
        </div>
      )}
    </div>
  );
}

const pauseNotifications = (uid: string, hours: number | null) =>
  supabase.from("profiles").update({ dnd_until: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null }).eq("id", uid);

const MenuItem = ({ onClick, icon, children }: { onClick: () => void; icon?: IconName; children: React.ReactNode }) => (
  <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-tm-blue-light hover:text-tm-blue-dark">
    {icon && <Icon name={icon} size={15} className="opacity-70" />}
    {children}
  </button>
);

type Tab = "home" | "dms" | "activity";

const railRing = { boxShadow: `0 0 0 2px ${RAIL}` };

// Slack-style app rail: switches what the sidebar lists
function Rail({ tab, onTab, className }: { tab: Tab; onTab: (t: Tab) => void; className: string }) {
  const { me, company, channels, memberships, unread, threadUnread, view, setView, notifications } = useChat();
  // Views opened from the rail; while one shows, the tab buttons aren't highlighted
  const railView = view === "tasks" || view === "saved" || view === "reminders" || view === "admin";
  const tabTo = (t: Tab) => {
    onTab(t);
    if (railView) setView(null);
  };
  let dmUnread = 0;
  let homeUnread = false;
  let mentions = 0;
  for (const [id, u] of Object.entries(unread)) {
    if (!memberships[id] || memberships[id].muted || channels[id]?.archived) continue;
    if (channels[id]?.kind === "dm") dmUnread += u.unread;
    else {
      homeUnread ||= u.unread > 0;
      mentions += u.mentions;
    }
  }
  mentions += Object.values(threadUnread).reduce((n, t) => n + (memberships[t.channelId]?.muted ? 0 : t.mentions), 0);
  mentions += notifications.filter((n) => !n.read_at).length;

  // Desktop app taskbar/dock badge, like Slack: DMs and mentions as a number, a dot for other unread channels.
  // The rail stays mounted (hidden by CSS on phones), so this tracks every change; it clears on sign-out or company loss.
  const badgeCount = dmUnread + mentions;
  useEffect(() => window.workchime?.badge?.(badgeCount, homeUnread), [badgeCount, homeUnread]);
  useEffect(() => () => window.workchime?.badge?.(0, false), []);

  return (
    // Bottom tab bar on phones, left rail from md up
    <nav
      className={`${className} shrink-0 justify-around border-t border-white/10 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:w-12 md:flex-col md:items-center md:justify-start md:gap-2 md:border-0 md:pt-3 md:pb-0`}
      style={{ background: RAIL }}
    >
      <button onClick={() => tabTo("home")} title={company?.name} className="mb-2 hidden rounded-[30%] md:block ring-2 ring-white/20 transition hover:ring-white/50">
        <CompanyLogo company={company} size={30} />
      </button>
      <RailButton active={!railView && tab === "home"} onClick={() => tabTo("home")} icon="home" label="Home" dot={homeUnread} />
      <RailButton active={!railView && tab === "dms"} onClick={() => tabTo("dms")} icon="dms" label="DMs" count={dmUnread} />
      <RailButton active={!railView && tab === "activity"} onClick={() => tabTo("activity")} icon="bell" label="Activity" count={mentions} />
      <RailButton active={view === "tasks"} onClick={() => setView("tasks")} icon="checkSquare" label="Tasks" />
      <RailButton active={view === "saved"} onClick={() => setView("saved")} icon="bookmark" label="Saved" />
      <RailButton active={view === "reminders"} onClick={() => setView("reminders")} icon="clock" label="Reminders" />
      {isAdmin(me) && <RailButton active={view === "admin"} onClick={() => setView("admin")} icon="wrench" label="Admin" />}
    </nav>
  );
}

const RailButton = ({ active, onClick, icon, label, count, dot }: { active: boolean; onClick: () => void; icon: IconName; label: string; count?: number; dot?: boolean }) => (
  <button onClick={onClick} title={label} className="group flex flex-1 flex-col items-center gap-1 text-[11px] font-semibold md:flex-none">
    <span
      className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition md:h-9 md:w-9 ${
        active ? "bg-white/20 text-white" : "text-white/70 group-hover:bg-white/10 group-hover:text-white"
      }`}
    >
      <Icon name={icon} size={20} />
      {!!count && (
        <span className="tm-pop absolute -top-1 -right-1.5 min-w-[18px] rounded-full bg-tm-green px-1 text-center text-[10px] leading-[18px] font-bold text-white" style={railRing}>
          {count > 99 ? "99+" : count}
        </span>
      )}
      {!count && dot && <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-white" style={railRing} />}
    </span>
    <span className={`md:sr-only ${active ? "text-white" : "text-white/70 group-hover:text-white"}`}>{label}</span>
  </button>
);

const PanelHeader = ({ title, action }: { title: string; action?: React.ReactNode }) => (
  <div className="flex items-center px-2.5 pt-1.5 pb-3">
    <h2 className="flex-1 text-lg font-bold text-zinc-900">{title}</h2>
    {action}
  </div>
);

function DmList({ onNew }: { onNew: () => void }) {
  const { me, channels, memberships, previews, dmMembers, profiles, online, away, channelTitle, activeId, view, setActive, unread } = useChat();
  const dms = Object.values(channels)
    .filter((c) => c.kind === "dm" && memberships[c.id] && !c.archived)
    .sort((a, b) => (previews[b.id]?.created_at ?? b.created_at).localeCompare(previews[a.id]?.created_at ?? a.created_at));

  return (
    <>
      <PanelHeader
        title="Direct messages"
        action={
          <button onClick={onNew} title="New message" className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white hover:text-tm-blue">
            <Icon name="plus" size={18} />
          </button>
        }
      />
      {dms.length === 0 && <p className="px-2.5 text-sm text-zinc-400">No conversations yet.</p>}
      <div className="space-y-0.5">
        {dms.map((c) => {
          const others = (dmMembers[c.id] ?? []).filter((id) => id !== me.id);
          const p = profiles[others[0] ?? me.id];
          const pv = previews[c.id];
          const active = c.id === activeId && !view;
          const bold = !!unread[c.id]?.unread && !active && !memberships[c.id].muted;
          return (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${active ? "tm-raised bg-white" : "hover:bg-white/70"}`}
            >
              {others.length > 1 ? (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-tm-blue-light text-sm font-bold text-tm-blue">{others.length}</span>
              ) : (
                <Avatar profile={p} size={36} online={online.has(p?.id)} away={away.has(p?.id)} />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`flex-1 truncate text-[15px] ${bold ? "font-bold text-zinc-900" : "font-semibold text-zinc-700"} ${active ? "text-tm-blue" : ""}`}>{channelTitle(c)}</span>
                  {pv && <span className="shrink-0 text-[11px] text-zinc-400">{dayLabel(pv.created_at) === "Today" ? timeOf(pv.created_at) : dayLabel(pv.created_at)}</span>}
                </span>
                <span className={`block truncate text-[13px] ${bold ? "text-zinc-800" : "text-zinc-500"}`}>
                  {pv ? `${pv.user_id === me.id ? "You: " : ""}${pv.body || "Attachment"}` : "No messages yet"}
                </span>
              </span>
              {bold && <Badge count={unread[c.id].unread} strong />}
            </button>
          );
        })}
      </div>
    </>
  );
}

// Mentions of me (direct, @channel, @here) across conversations I'm in, plus task assignments
function ActivityList() {
  const { me, profiles, channels, memberships, channelTitle, unread, threadUnread, setActive, setThread, notifications, markNotificationsRead, openTask } = useChat();
  const [items, setItems] = useState<Message[] | null>(null);
  // Refetch when a new mention arrives
  const mentionKey = Object.values(unread).reduce((n, u) => n + u.mentions, 0) + Object.values(threadUnread).reduce((n, t) => n + t.mentions, 0);

  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .is("deleted_at", null)
      .neq("user_id", me.id)
      .or(`mentions.cs.{${me.id}},body.ilike.%@channel%,body.ilike.%@here%`)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setItems((data as Message[]) ?? []));
  }, [me.id, mentionKey]);

  const shown = items?.filter((m) => memberships[m.channel_id]);
  const open = (m: Message) => {
    setActive(m.channel_id, m.parent_id && !m.also_in_channel ? null : m.id);
    if (m.parent_id) setThread({ id: m.parent_id, channelId: m.channel_id });
  };
  // Mentions and notifications in one timeline, newest first
  const feed = shown
    ? [...shown.map((m) => ({ at: m.created_at, m, n: null })), ...notifications.map((n) => ({ at: n.created_at, m: null, n }))].sort((a, b) => b.at.localeCompare(a.at))
    : null;
  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const ago = (iso: string) => (dayLabel(iso) === "Today" ? timeOf(iso) : dayLabel(iso));

  return (
    <>
      <PanelHeader
        title="Activity"
        action={
          unreadCount > 0 && (
            <button onClick={() => markNotificationsRead()} className="rounded-lg px-2 py-1 text-xs font-medium text-tm-blue transition hover:bg-white">
              Mark all read
            </button>
          )
        }
      />
      {!feed && <RowSkeleton />}
      {feed?.length === 0 && <p className="px-2.5 text-sm text-zinc-400">Nothing yet. Mentions and tasks assigned to you show up here.</p>}
      <div className="space-y-1">
        {feed?.map(({ m, n }) => {
          if (n) {
            const isNew = !n.read_at;
            return (
              <button
                key={n.id}
                onClick={() => {
                  markNotificationsRead([n.id]);
                  if (n.task_id) openTask(n.task_id);
                }}
                className={`tm-fade-up flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-white ${isNew ? "bg-tm-blue-light/60" : ""}`}
              >
                <span className="relative">
                  <Avatar profile={n.actor_id ? profiles[n.actor_id] : undefined} size={32} />
                  <span className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-md bg-tm-blue text-white ring-2 ring-white">
                    <Icon name="checkSquare" size={10} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 text-xs text-zinc-400">
                    <span className="flex-1 truncate">Task assigned to you</span>
                    <span className="shrink-0">{ago(n.created_at)}</span>
                  </span>
                  <span className={`block truncate text-sm text-zinc-800 ${isNew ? "font-bold" : "font-semibold"}`}>{n.title}</span>
                  <span className="line-clamp-2 text-[13px] text-zinc-600">{n.body}</span>
                </span>
                {isNew && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-tm-blue" aria-label="Unread" />}
              </button>
            );
          }
          if (!m) return null;
          const ch = channels[m.channel_id];
          return (
            <button key={m.id} onClick={() => open(m)} className="tm-fade-up flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-white">
              <Avatar profile={profiles[m.user_id]} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-xs text-zinc-400">
                  <span className="flex-1 truncate">
                    {m.parent_id ? "Thread in " : "Mention in "}
                    {ch ? (ch.kind === "dm" ? channelTitle(ch) : `#${ch.name}`) : "channel"}
                  </span>
                  <span className="shrink-0">{dayLabel(m.created_at) === "Today" ? timeOf(m.created_at) : dayLabel(m.created_at)}</span>
                </span>
                <span className="block truncate text-sm font-semibold text-zinc-800">{m.bot_name ?? displayName(profiles[m.user_id])}</span>
                <span className="line-clamp-2 text-[13px] text-zinc-600">{m.body || "Attachment"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Sidebar({ tab, className }: { tab: Tab; className: string }) {
  const { me, superAdmin, channels, memberships, online, away, channelTitle, dmMembers, profiles, previews, view, setView, threadUnread, meetings } = useChat();
  const now = useNow(30_000);
  const liveMeetings = meetings.some((m) => meetingLive(m, now) && m.meeting_invitees.some((i) => i.user_id === me.id && i.response !== "declined"));
  const newThreads = Object.values(threadUnread).filter((t) => !memberships[t.channelId]?.muted);
  const threadMentions = newThreads.reduce((n, t) => n + t.mentions, 0);
  const [modal, setModal] = useState<"create" | "browse" | "dm" | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>(() => ("Notification" in window ? Notification.permission : "denied"));

  const list = Object.values(channels).filter((c) => memberships[c.id] && !c.archived);
  const starred = list.filter((c) => memberships[c.id].starred);
  const rooms = list.filter((c) => c.kind !== "dm" && !memberships[c.id].starred).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const dms = list
    .filter((c) => c.kind === "dm" && !memberships[c.id].starred)
    .sort((a, b) => (previews[b.id]?.created_at ?? b.created_at).localeCompare(previews[a.id]?.created_at ?? a.created_at));

  const renderItem = (c: Channel) => {
    if (c.kind !== "dm") return <Item key={c.id} id={c.id} label={c.name ?? ""} icon={<ChannelIcon kind={c.kind} size={15} />} />;
    const others = (dmMembers[c.id] ?? []).filter((id) => id !== me.id);
    const p = profiles[others[0] ?? me.id];
    return (
      <Item
        key={c.id}
        id={c.id}
        label={channelTitle(c)}
        status={others.length === 1 ? p : undefined}
        icon={
          others.length > 1 ? (
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-tm-blue-light text-[10px] font-bold text-tm-blue">{others.length}</span>
          ) : (
            <Avatar profile={p} size={18} online={online.has(p?.id)} away={away.has(p?.id)} />
          )
        }
      />
    );
  };

  return (
    <aside className={`${className} w-full shrink-0 flex-col px-2 pt-3 md:w-64 md:p-0`}>
      {tab === "dms" ? (
        <nav className="flex-1 overflow-y-auto pr-1 pb-4">
          <DmList onNew={() => setModal("dm")} />
        </nav>
      ) : tab === "activity" ? (
        <nav className="flex-1 overflow-y-auto pr-1 pb-4">
          <ActivityList />
        </nav>
      ) : (
        <nav className="flex-1 overflow-y-auto pr-1 pb-4">
          <CompanySwitcher />
          <div className="space-y-0.5">
            <NavButton
              active={view === "threads"}
              onClick={() => setView("threads")}
              icon="messages"
              label="Threads"
              badge={newThreads.length ? <Badge count={threadMentions || newThreads.length} strong={threadMentions > 0} /> : undefined}
            />
            <NavButton
              active={view === "meetings"}
              onClick={() => setView("meetings")}
              icon="calendar"
              label="Meetings"
              badge={liveMeetings ? <span className="rounded-full bg-tm-green px-1.5 py-px text-[11px] font-bold text-white">Live</span> : undefined}
            />
            <NavButton active={view === "members"} onClick={() => setView("members")} icon="users" label="Members" />
            {superAdmin && <NavButton active={view === "platform"} onClick={() => setView("platform")} icon="shield" label="Super admin" />}
          </div>
          {notifPerm === "default" && (
            <button
              onClick={() =>
                Notification.requestPermission().then((p) => {
                  setNotifPerm(p);
                  enablePush();
                })
              }
              className="mt-3 flex w-full items-center gap-2 rounded-xl border border-tm-line bg-white px-3 py-2 text-left text-xs text-zinc-600 transition hover:bg-tm-surface"
            >
              <Icon name="bell" size={14} />
              Enable notifications for DMs, mentions and calls, even when {APP_NAME} is closed
            </button>
          )}
          {starred.length > 0 && <Section title="Starred">{starred.map(renderItem)}</Section>}
          <SidebarProjects renderSection={(children, onAdd) => <Section title="Projects" onAdd={onAdd}>{children}</Section>} />
          <Section title="Channels" onAdd={() => setModal("create")}>
            {rooms.map(renderItem)}
            <button onClick={() => setModal("browse")} className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-500 transition hover:bg-white">
              + Browse channels
            </button>
          </Section>
          <Section title="Direct messages" onAdd={() => setModal("dm")}>
            {dms.map(renderItem)}
          </Section>
        </nav>
      )}
      {modal === "create" && <CreateChannel onClose={() => setModal(null)} />}
      {modal === "browse" && <BrowseChannels onClose={() => setModal(null)} />}
      {modal === "dm" && <NewDM onClose={() => setModal(null)} />}
    </aside>
  );
}

const NavButton = ({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: IconName; label: string; badge?: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[15px] transition md:py-1.5 ${
      active ? "tm-raised bg-white font-semibold text-tm-blue" : badge ? "font-bold text-zinc-900 hover:bg-white/70" : "text-zinc-600 hover:bg-white/70"
    }`}
  >
    <span className="flex w-5 justify-center">
      <Icon name={icon} size={17} />
    </span>
    <span className="flex-1">{label}</span>
    {!active && badge}
  </button>
);

// Green for mentions/DMs, neutral for plain unread
const Badge = ({ count, strong }: { count: number; strong?: boolean }) => (
  <span className={`tm-pop min-w-5 rounded-full px-1.5 py-px text-center text-[11px] font-bold ${strong ? "bg-tm-green text-white" : "bg-zinc-200 text-zinc-700"}`}>
    {count > 99 ? "99+" : count}
  </span>
);

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mt-5">
      <div className="flex items-center px-2.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
        <button onClick={() => setCollapsed(!collapsed)} className="flex flex-1 items-center gap-1.5 transition hover:text-zinc-700">
          <span className={`text-[8px] transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}>▼</span>
          {title}
        </button>
        {onAdd && (
          <button onClick={onAdd} className="rounded-md px-1.5 text-base leading-none transition hover:bg-white hover:text-tm-blue" title={`Add to ${title.toLowerCase()}`}>
            +
          </button>
        )}
      </div>
      {!collapsed && <div className="tm-fade mt-1.5 space-y-0.5">{children}</div>}
    </div>
  );
}

function Item({ id, icon, label, status }: { id: string; icon: React.ReactNode; label: string; status?: Profile }) {
  const { unread, threadUnread, activeId, view, memberships, setActive, huddles } = useChat();
  const u = unread[id];
  const huddlers = huddles[id]?.length ?? 0;
  const active = id === activeId && !view;
  const muted = memberships[id]?.muted;
  const threadReplies = Object.values(threadUnread).some((t) => t.channelId === id);
  const bold = (!!u?.unread || threadReplies) && !active && !muted;
  return (
    <button
      onClick={() => setActive(id)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition md:py-1.5 ${
        active ? "tm-raised bg-white text-tm-blue" : "text-zinc-600 hover:bg-white/70"
      } ${muted && !active ? "opacity-50" : ""}`}
    >
      <span className="flex w-5 shrink-0 justify-center text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1 text-[15px] ${bold ? "font-bold text-zinc-900" : active ? "font-semibold" : ""}`}>
          <span className="truncate">{label}</span>
          <StatusBadge profile={status} />
        </span>
      </span>
      {huddlers > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-zinc-500" title={`${CALL} in progress · ${huddlers} ${huddlers === 1 ? "person" : "people"}`}>
          <Icon name="headphones" size={13} />
          {huddlers}
        </span>
      )}
      {!active && !muted && threadReplies && !u?.unread && (
        <span className="h-2 w-2 shrink-0 rounded-full bg-tm-blue" title="New replies in threads you follow" />
      )}
      {!active && (u?.mentions ? <Badge count={u.mentions} strong /> : u?.unread && !muted ? <Badge count={u.unread} /> : null)}
    </button>
  );
}
