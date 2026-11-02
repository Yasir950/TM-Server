"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, displayName, activeStatus, inDnd, isAdmin, meetingLive, type Channel, type Message, type Profile } from "@/lib/supabase";
import { dayLabel, timeOf } from "@/lib/format";
import { Avatar, Logo, Mark, StatusBadge } from "../ui";
import { useChat } from "./store";
import ChannelView from "./ChannelView";
import ThreadPanel from "./ThreadPanel";
import { BrowseChannels, CreateChannel, NewDM } from "./Modals";
import { QuickSwitcher, RemindersView, SavedView, SearchView, StatusModal, ThreadsView } from "./Views";
import AdminView from "./Admin";
import { CompanyLogo, CompanySwitcher, CompanyView, InviteFromUrl, MemberCard, MembersView, Onboarding, ProfileModal } from "./Company";
import Huddle, { IncomingHuddle } from "./Huddle";
import { MeetingsView, useNow } from "./Meetings";
import { Icon, type IconName } from "../icons";
import { APP_NAME, CALL, DESKTOP_APP_URL } from "@/lib/brand";

export default function Chat() {
  const { activeId, thread, view, huddle, setHuddle, company, memberCard } = useChat();
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

  if (!company)
    return (
      <>
        <Onboarding />
        <InviteFromUrl />
      </>
    );

  // Phones show one pane at a time, like Slack mobile: the tab list, or the open conversation/view (or its thread) full screen
  const open = !!(activeId || view);
  const mobileList = open ? "hidden md:flex" : "flex";

  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]" style={{ background: RAIL }}>
      <TopBar onSwitcher={() => setSwitcher(true)} className={mobileList} />
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <Rail tab={tab} onTab={setTab} className={mobileList} />
        <div className="flex min-h-0 min-w-0 flex-1 bg-tm-surface md:gap-2 md:rounded-tl-2xl md:p-2">
          <Sidebar tab={tab} className={mobileList} />
          <main
            className={`tm-raised min-w-0 flex-1 flex-col overflow-hidden bg-white max-md:pb-[env(safe-area-inset-bottom)] md:rounded-2xl ${
              thread ? "hidden lg:flex" : open ? "flex" : "hidden md:flex"
            }`}
          >
            {view === "threads" ? <ThreadsView /> : view === "saved" ? <SavedView /> : view === "search" ? <SearchView /> : view === "reminders" ? <RemindersView /> : view === "meetings" ? <MeetingsView /> : view === "admin" ? <AdminView /> : view === "members" ? <MembersView /> : view === "company" ? <CompanyView key={company.id} /> : activeId ? <ChannelView key={activeId} channelId={activeId} /> : <Empty />}
          </main>
          {thread && <ThreadPanel key={thread.id} messageId={thread.id} channelId={thread.channelId} />}
        </div>
      </div>
      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}
      {huddle && <Huddle key={huddle} channelId={huddle} onLeave={() => setHuddle(null)} />}
      <IncomingHuddle />
      <MemberCard key={memberCard} />
      <InviteFromUrl />
    </div>
  );
}

function Empty() {
  return (
    <div className="tm-fade flex flex-1 flex-col items-center justify-center gap-4 text-zinc-500">
      <Logo height={56} />
      <p className="text-sm">Pick a channel or start a direct message.</p>
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
      {/* Lines up over the 72px rail on desktop */}
      <span className="flex shrink-0 justify-center md:-ml-4 md:w-[72px]">
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
          {status && <span title={status.text}>{status.emoji || "💬"}</span>}
          {dnd && <span title="Notifications paused">🌙</span>}
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
            <MenuItem onClick={() => { setProfileModal(true); setMenu(false); }}>👤 Edit profile</MenuItem>
            <MenuItem onClick={() => { setStatusModal(true); setMenu(false); }}>😊 {status ? "Edit status" : "Set a status"}</MenuItem>
            <div className="my-1 h-px bg-tm-line" />
            {dnd ? (
              <MenuItem onClick={() => setDnd(null)}>🔔 Resume notifications</MenuItem>
            ) : (
              <>
                <div className="px-3 pt-1 pb-0.5 text-xs text-zinc-400">Pause notifications</div>
                {[[0.5, "30 minutes"], [1, "1 hour"], [8, "8 hours"], [24, "24 hours"]].map(([h, label]) => (
                  <MenuItem key={h} onClick={() => setDnd(h as number)}>🌙 {label}</MenuItem>
                ))}
              </>
            )}
            <div className="my-1 h-px bg-tm-line" />
            <MenuItem onClick={() => supabase.auth.signOut()}>Sign out</MenuItem>
          </div>
        )}
      </div>
      {statusModal && <StatusModal onClose={() => setStatusModal(false)} />}
      {profileModal && <ProfileModal onClose={() => setProfileModal(false)} />}
    </header>
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
        <Mark size={38} className="rounded-[25%]" />
      </button>
      {open && (
        <div className="tm-pop tm-float absolute top-11 left-0 z-40 w-64 rounded-2xl bg-white p-2 text-sm">
          <div className="px-2 py-2 font-semibold text-zinc-900">{APP_NAME}</div>
          <a
            href={DESKTOP_APP_URL}
            download
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-tm-blue-light hover:text-tm-blue-dark"
          >
            💻 Download desktop app
          </a>
        </div>
      )}
    </div>
  );
}

const pauseNotifications = (uid: string, hours: number | null) =>
  supabase.from("profiles").update({ dnd_until: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null }).eq("id", uid);

const MenuItem = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="block w-full rounded-lg px-3 py-1.5 text-left transition hover:bg-tm-blue-light hover:text-tm-blue-dark">
    {children}
  </button>
);

type Tab = "home" | "dms" | "activity";

// Dark app chrome shared by the rail and the top bar
const RAIL = "#0f2d4d";
const railRing = { boxShadow: `0 0 0 2px ${RAIL}` };

// Slack-style app rail: switches what the sidebar lists
function Rail({ tab, onTab, className }: { tab: Tab; onTab: (t: Tab) => void; className: string }) {
  const { company, channels, memberships, unread, threadUnread } = useChat();
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

  return (
    // Bottom tab bar on phones, left rail from md up
    <nav
      className={`${className} shrink-0 justify-around border-t border-white/10 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:w-[72px] md:flex-col md:items-center md:justify-start md:gap-3 md:border-0 md:pt-3 md:pb-0`}
      style={{ background: RAIL }}
    >
      <button onClick={() => onTab("home")} title={company?.name} className="mb-2 hidden rounded-[30%] md:block ring-2 ring-white/20 transition hover:ring-white/50">
        <CompanyLogo company={company} size={38} />
      </button>
      <RailButton active={tab === "home"} onClick={() => onTab("home")} icon="home" label="Home" dot={homeUnread} />
      <RailButton active={tab === "dms"} onClick={() => onTab("dms")} icon="dms" label="DMs" count={dmUnread} />
      <RailButton active={tab === "activity"} onClick={() => onTab("activity")} icon="bell" label="Activity" count={mentions} />
    </nav>
  );
}

const RailButton = ({ active, onClick, icon, label, count, dot }: { active: boolean; onClick: () => void; icon: IconName; label: string; count?: number; dot?: boolean }) => (
  <button onClick={onClick} className="group flex flex-1 flex-col items-center gap-1 text-[11px] font-semibold md:flex-none">
    <span
      className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition ${
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
    <span className={active ? "text-white" : "text-white/70 group-hover:text-white"}>{label}</span>
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
                  {pv ? `${pv.user_id === me.id ? "You: " : ""}${pv.body || "📎 Attachment"}` : "No messages yet"}
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

// Mentions of me (direct, @channel, @here) across conversations I'm in
function ActivityList() {
  const { me, profiles, channels, memberships, channelTitle, unread, threadUnread, setActive, setThread } = useChat();
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

  return (
    <>
      <PanelHeader title="Activity" />
      {shown?.length === 0 && <p className="px-2.5 text-sm text-zinc-400">No mentions yet. When someone @mentions you, it shows up here.</p>}
      <div className="space-y-1">
        {shown?.map((m) => {
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
                <span className="line-clamp-2 text-[13px] text-zinc-600">{m.body || "📎 Attachment"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Sidebar({ tab, className }: { tab: Tab; className: string }) {
  const { me, channels, memberships, online, away, channelTitle, dmMembers, profiles, previews, view, setView, threadUnread, meetings } = useChat();
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
    if (c.kind !== "dm") return <Item key={c.id} id={c.id} label={c.name ?? ""} icon={c.kind === "private" ? "🔒" : "#"} />;
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
            <NavButton active={view === "saved"} onClick={() => setView("saved")} icon="bookmark" label="Saved" />
            <NavButton active={view === "reminders"} onClick={() => setView("reminders")} icon="clock" label="Reminders" />
            <NavButton
              active={view === "meetings"}
              onClick={() => setView("meetings")}
              icon="calendar"
              label="Meetings"
              badge={liveMeetings ? <span className="rounded-full bg-tm-green px-1.5 py-px text-[11px] font-bold text-white">Live</span> : undefined}
            />
            <NavButton active={view === "members"} onClick={() => setView("members")} icon="users" label="Members" />
            {isAdmin(me) && <NavButton active={view === "admin"} onClick={() => setView("admin")} icon="wrench" label="Admin" />}
          </div>
          {notifPerm === "default" && (
            <button
              onClick={() => Notification.requestPermission().then(setNotifPerm)}
              className="mt-3 flex w-full items-center gap-2 rounded-xl border border-tm-line bg-white px-3 py-2 text-left text-xs text-zinc-600 transition hover:bg-tm-surface"
            >
              <Icon name="bell" size={14} />
              Enable desktop notifications for DMs and mentions
            </button>
          )}
          {starred.length > 0 && <Section title="Starred">{starred.map(renderItem)}</Section>}
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
