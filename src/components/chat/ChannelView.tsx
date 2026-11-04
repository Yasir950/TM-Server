"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase, displayName, type Message, type Reaction } from "@/lib/supabase";
import { dayLabel, plainText } from "@/lib/format";
import { useChat } from "./store";
import { useMessages, toggleReaction } from "./useMessages";
import MessageItem from "./MessageItem";
import Composer from "./Composer";
import Canvas from "./Canvas";
import { MobileBack } from "./Views";
import { MeetingBanner, ScheduleMeeting } from "./Meetings";
import { Avatar, MessageSkeleton, StatusBadge } from "../ui";
import { Icon } from "../icons";
import { CALL, call } from "@/lib/brand";

export default function ChannelView({ channelId }: { channelId: string }) {
  const { me, channels, memberships, profiles, channelTitle, markRead, dmMembers, focusId, updateMembership, showChannelDetails } = useChat();
  const channel = channels[channelId];
  const [channelMembers, setChannelMembers] = useState<string[] | null>(null);
  const { messages, reactions, setReactions, upsert, hasMore, loading, loadOlder } = useMessages(channelId, null);
  const [lastRead] = useState(memberships[channelId]?.last_read_at);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [canvas, setCanvas] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const typingChan = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);

  // Mark read while the conversation is visible
  useEffect(() => {
    if (document.visibilityState === "visible") markRead(channelId);
    const onVis = () => document.visibilityState === "visible" && markRead(channelId);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [channelId, messages.length, markRead]);

  // Channel members for the header's faces (DMs already have theirs in the store); refreshed on joins and leaves
  const isChannel = channel && channel.kind !== "dm";
  useEffect(() => {
    if (!isChannel) return;
    const load = () =>
      supabase
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channelId)
        .then(({ data }) => setChannelMembers((data ?? []).map((r) => r.user_id)));
    load();
    const ch = supabase
      .channel(`members:${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "channel_members", filter: `channel_id=eq.${channelId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId, isChannel]);

  // Typing indicator via broadcast
  useEffect(() => {
    const ch = supabase.channel(`typing:${channelId}`);
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.user !== me.id) setTyping((t) => ({ ...t, [payload.user]: Date.now() }));
    }).subscribe();
    typingChan.current = ch;
    const sweep = setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, at]) => Date.now() - at < 4000))), 1500);
    return () => {
      clearInterval(sweep);
      supabase.removeChannel(ch);
    };
  }, [channelId, me.id]);

  const sendTyping = () => {
    if (Date.now() - lastTypingSent.current < 2500) return;
    lastTypingSent.current = Date.now();
    typingChan.current?.send({ type: "broadcast", event: "typing", payload: { user: me.id } });
  };

  if (!channel) return null;
  const isDM = channel.kind === "dm";
  const title = channelTitle(channel);
  // A message sent after someone's last keystroke ends their typing state
  const lastMsg = messages[messages.length - 1];
  const typers = Object.entries(typing)
    .filter(([id, at]) => !(lastMsg?.user_id === id && new Date(lastMsg.created_at).getTime() > at - 1000))
    .map(([id]) => displayName(profiles[id]));
  const others = isDM ? (dmMembers[channelId] ?? []).filter((id) => id !== me.id) : [];
  const dmPartner = others.length === 1 ? profiles[others[0]] : undefined;
  // Members shown in the header, others first so the faces are the people you're talking to
  const people = (isDM ? (dmMembers[channelId] ?? []) : (channelMembers ?? []))
    .filter((id) => profiles[id])
    .sort((a, b) => Number(a === me.id) - Number(b === me.id));

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-tm-line px-2 md:gap-2 md:px-5">
        <MobileBack />
        <button onClick={() => showChannelDetails(channelId)} className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1 text-lg font-semibold transition hover:bg-tm-surface md:px-2">
          <span className="text-zinc-400">{isDM ? "" : channel.kind === "private" ? "🔒" : "#"}</span>
          <span className="truncate">{title}</span>
          <Icon name="chevronDown" size={16} className="text-zinc-500" />
        </button>
        <button
          onClick={() => updateMembership(channelId, { starred: !memberships[channelId]?.starred })}
          className={`hidden rounded-lg p-1 transition hover:bg-tm-surface sm:block ${memberships[channelId]?.starred ? "text-amber-400" : "text-zinc-300 hover:text-zinc-500"}`}
          title={memberships[channelId]?.starred ? "Unstar" : "Star"}
        >
          ★
        </button>
        {isDM && dmPartner && (
          <span className="hidden sm:contents">
            <StatusBadge profile={dmPartner} withText />
          </span>
        )}
        {channel.topic && <span className="hidden truncate text-sm text-zinc-400 lg:inline">{channel.topic}</span>}
        <MeetButton channelId={channelId} onSchedule={channel.archived ? undefined : () => setScheduling(true)} />
        {!isDM && (
          <button
            onClick={() => setCanvas(!canvas)}
            className={`shrink-0 rounded-xl border px-2 py-1.5 text-sm transition md:px-2.5 md:py-1 ${canvas ? "border-zinc-800 bg-zinc-800 text-white" : "border-tm-line text-zinc-500 hover:bg-tm-surface"}`}
            title="Channel canvas"
          >
            <span className="flex items-center gap-1.5">
              <Icon name="list" size={16} />
              <span className="hidden md:inline">Canvas</span>
            </span>
          </button>
        )}
        <button
          onClick={() => showChannelDetails(channelId)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-tm-line px-1.5 py-1 text-sm font-medium text-zinc-600 transition hover:bg-tm-surface md:px-2"
          title={`View all ${people.length} members`}
        >
          {people.length > 0 ? (
            <span className="flex -space-x-1.5">
              {people.slice(0, 5).map((id) => (
                <span key={id} className="rounded-[30%] ring-2 ring-white">
                  <Avatar profile={profiles[id]} size={20} />
                </span>
              ))}
            </span>
          ) : (
            <Icon name="users" size={16} />
          )}
          {people.length || "Details"}
        </button>
      </header>
      <MeetingBanner channelId={channelId} />
      <CallBanner channelId={channelId} />
      <PinnedBar channelId={channelId} />
      {scheduling && <ScheduleMeeting channelId={channelId} onClose={() => setScheduling(false)} />}

      <MessageList
        messages={messages}
        reactions={reactions}
        loading={loading}
        hasMore={hasMore}
        loadOlder={loadOlder}
        lastRead={lastRead}
        focusId={focusId}
        onReact={(m, e) => toggleReaction(m, e, me.id, reactions, setReactions)}
        intro={
          <div className="px-5 pt-10 pb-4">
            <h2 className="text-2xl font-bold">{isDM ? title : `${channel.kind === "private" ? "🔒" : "#"} ${title}`}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {isDM ? "This is the very beginning of your direct message history." : `This is the very beginning of the #${title} channel.`}
            </p>
          </div>
        }
      />

      <div className="h-6 px-6 text-xs text-zinc-400">
        {typers.length > 0 && (
          <span className="tm-fade inline-flex items-center gap-1.5">
            <span className="inline-flex gap-0.5 text-tm-blue">
              <span className="tm-dot">●</span>
              <span className="tm-dot" style={{ animationDelay: "0.15s" }}>●</span>
              <span className="tm-dot" style={{ animationDelay: "0.3s" }}>●</span>
            </span>
            {typers.join(", ")} {typers.length > 1 ? "are" : "is"} typing
          </span>
        )}
      </div>
      {channel.archived ? (
        <div className="m-5 mt-0 rounded-2xl bg-tm-surface p-4 text-center text-sm text-zinc-500">🗄️ This channel is archived. You can read its history, but no one can post.</div>
      ) : !memberships[channelId] ? (
        // Only super admins can open a conversation they are not in
        <div className="m-5 mt-0 rounded-2xl bg-tm-surface p-4 text-center text-sm text-zinc-500">
          🛡️ You&apos;re viewing this {isDM ? "conversation" : "channel"} as a super admin. You aren&apos;t a member, so you can read but not post.
        </div>
      ) : (
        <Composer channelId={channelId} placeholder={`Message ${isDM ? title : "#" + title}`} onSent={upsert} onTyping={sendTyping} />
      )}
      {canvas && <Canvas channelId={channelId} onClose={() => setCanvas(false)} />}
    </>
  );
}

type ListProps = {
  messages: Message[];
  reactions: Reaction[];
  loading: boolean;
  hasMore?: boolean;
  loadOlder?: () => Promise<void>;
  lastRead?: string;
  inThread?: boolean;
  intro?: React.ReactNode;
  focusId?: string | null;
  onReact: (m: Message, emoji: string) => void;
};

export function MessageList({ messages: all, reactions, loading, hasMore, loadOlder, lastRead, inThread, intro, focusId, onReact }: ListProps) {
  const { me } = useChat();
  // Deleted messages disappear; one that still has replies stays as a placeholder so its thread remains reachable
  const messages = useMemo(() => all.filter((m) => !m.deleted_at || m.reply_count > 0), [all]);
  const box = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const focused = useRef(false);

  // Scroll a permalinked message into view once it has loaded
  useEffect(() => {
    if (!focusId || focused.current || loading) return;
    const el = document.getElementById(`msg-${focusId}`);
    if (!el) return;
    focused.current = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const show = setTimeout(() => setFlash(focusId), 0);
    const hide = setTimeout(() => setFlash(null), 2200);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [focusId, loading, messages]);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const loadingOlder = useRef(false);

  // Jump requests (e.g. from the pinned bar): page back until the message is loaded, then scroll to and flash it
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (inThread) return;
    const onJump = (e: Event) => setTarget((e as CustomEvent<string>).detail);
    window.addEventListener(JUMP_EVENT, onJump);
    return () => window.removeEventListener(JUMP_EVENT, onJump);
  }, [inThread]);
  useEffect(() => {
    if (!target || loading) return;
    const el = document.getElementById(`msg-${target}`);
    if (el && box.current?.contains(el)) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const show = setTimeout(() => {
        setFlash(target);
        setTarget(null);
      }, 0);
      return () => clearTimeout(show);
    }
    if (hasMore && loadOlder) {
      if (loadingOlder.current) return;
      loadingOlder.current = true;
      prevHeight.current = box.current?.scrollHeight ?? 0;
      loadOlder();
    } else {
      const t = setTimeout(() => setTarget(null), 0);
      return () => clearTimeout(t);
    }
  }, [target, loading, messages, hasMore, loadOlder]);
  useEffect(() => {
    if (!flash) return;
    const hide = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(hide);
  }, [flash]);

  // Keep pinned to bottom on new messages; preserve position when older ones are prepended
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (loadingOlder.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      loadingOlder.current = false;
    } else if ((stick.current && !(focusId && !focused.current)) || messages[messages.length - 1]?.user_id === me.id) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, me.id, focusId]);

  async function onScroll() {
    const el = box.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && loadOlder && !loadingOlder.current) {
      loadingOlder.current = true;
      prevHeight.current = el.scrollHeight;
      await loadOlder();
    }
  }

  const newIdx = lastRead ? messages.findIndex((m) => m.created_at > lastRead && m.user_id !== me.id) : -1;
  return (
    <div ref={box} onScroll={onScroll} className="flex-1 overflow-y-auto pb-2">
      {!hasMore && !loading && intro}
      {loading && <div className="pt-3"><MessageSkeleton count={inThread ? 3 : 8} /></div>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
        const showNew = i === newIdx;
        const grouped =
          !newDay && !showNew && prev && prev.user_id === m.user_id && !prev.deleted_at &&
          new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
        return (
          <Fragment key={m.id}>
            {newDay && !inThread && (
              <div className="sticky top-1 z-10 my-3 flex justify-center">
                <span className="tm-raised rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-zinc-500 backdrop-blur">{dayLabel(m.created_at)}</span>
              </div>
            )}
            {showNew && (
              <div className="relative my-1 flex justify-end px-5">
                <div className="absolute inset-x-5 top-1/2 border-t border-tm-green/60" />
                <span className="relative rounded-full bg-tm-green px-2 py-px text-[10px] font-bold tracking-wide text-white uppercase">New</span>
              </div>
            )}
            <MessageItem
              msg={m}
              grouped={!!grouped}
              inThread={inThread}
              highlight={flash === m.id}
              reactions={reactions.filter((r) => r.message_id === m.id)}
              onReact={(e) => onReact(m, e)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

const JUMP_EVENT = "tm:jump-to-message";

// Strip under the header listing every pinned message in the conversation, kept live via Realtime
function PinnedBar({ channelId }: { channelId: string }) {
  const { profiles } = useChat();
  const [pins, setPins] = useState<Message[]>([]);
  const [idx, setIdx] = useState(0);
  const pinsRef = useRef(new Set<string>());

  useEffect(() => {
    pinsRef.current = new Set(pins.map((p) => p.id));
  }, [pins]);

  useEffect(() => {
    const load = () =>
      supabase
        .from("messages")
        .select("*")
        .eq("channel_id", channelId)
        .not("pinned_at", "is", null)
        .is("deleted_at", null)
        .order("pinned_at", { ascending: false })
        .then(({ data }) => setPins((data as Message[]) ?? []));
    load();
    const ch = supabase
      .channel(`pins:${channelId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, ({ new: m }) => {
        // Refetch when a message is (still) pinned or was one of ours, i.e. it was just unpinned
        if ((m as Message).pinned_at || pinsRef.current.has((m as Message).id)) load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId]);

  if (!pins.length) return null;

  // Clicking jumps to the shown pin and moves on to the next, cycling through them all
  const i = idx % pins.length;
  const cur = pins[i];
  function jump() {
    window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: cur.id }));
    setIdx(i + 1);
  }

  async function unpin() {
    setPins((list) => list.filter((p) => p.id !== cur.id));
    await supabase.rpc("toggle_pin", { p_id: cur.id });
  }

  return (
    <div className="group flex shrink-0 items-center gap-2 border-b border-tm-line bg-tm-surface/70 px-3 text-sm md:px-5">
      <button onClick={jump} title="Go to pinned message" className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <Icon name="pin" size={15} className="text-zinc-500" />
        <span className="shrink-0 font-semibold text-zinc-700">{pins.length > 1 ? `Pinned ${i + 1} of ${pins.length}` : "Pinned"}</span>
        <span className="min-w-0 truncate text-zinc-600">
          <span className="font-medium">{cur.bot_name ?? displayName(profiles[cur.user_id])}:</span> {plainText(cur.body) || "Attachment"}
        </span>
      </button>
      <button onClick={unpin} title="Unpin this message" className="shrink-0 rounded-md p-1 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-zinc-700">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// Strip under the header while a call is running in this conversation: who's in it, and a way to join
function CallBanner({ channelId }: { channelId: string }) {
  const { me, profiles, huddle, huddles, setHuddle } = useChat();
  const huddlers = (huddles[channelId] ?? []).filter((id) => profiles[id]);
  if (!huddlers.length) return null;
  const inHuddle = huddle === channelId;
  // Your account can be in the call from another tab or device
  const names = huddlers.map((id) => (id === me.id ? "You" : displayName(profiles[id])));
  const who = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <div className="tm-fade flex shrink-0 items-center gap-2.5 border-b border-tm-line bg-tm-green-light px-3 py-2 text-sm md:px-5">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tm-green opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-tm-green" />
      </span>
      <span className="flex shrink-0 -space-x-1.5" title={names.join(", ")}>
        {huddlers.slice(0, 5).map((id) => (
          <span key={id} className="rounded-[30%] ring-2 ring-tm-green-light">
            <Avatar profile={profiles[id]} size={22} />
          </span>
        ))}
        {huddlers.length > 5 && (
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[30%] bg-white px-1 text-[11px] font-semibold text-zinc-600 ring-2 ring-tm-green-light">
            +{huddlers.length - 5}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{CALL} in progress</span>
        <span className="text-zinc-600"> · {inHuddle ? "you're in" : huddlers.length === 1 && huddlers[0] === me.id ? "you're in on another tab or device" : `${who} ${huddlers.length === 1 ? "is" : "are"} in`}</span>
      </span>
      {!inHuddle && (
        <button onClick={() => setHuddle(channelId)} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-tm-green px-3 py-1 text-xs font-semibold text-white transition hover:brightness-95">
          <Icon name="headphones" size={14} />
          Join
        </button>
      )}
    </div>
  );
}

// Split button: the main part starts, joins or leaves the call; the arrow opens a menu that also offers scheduling
function MeetButton({ channelId, onSchedule }: { channelId: string; onSchedule?: () => void }) {
  const { profiles, huddle, huddles, setHuddle } = useChat();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inHuddle = huddle === channelId;
  const huddlers = huddles[channelId] ?? [];

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  // Green while a call is running here and you're not in it yet, so it reads as "join"
  const tone = inHuddle
    ? "border-zinc-800 bg-zinc-800 text-white"
    : huddlers.length
      ? "border-tm-green bg-tm-green font-semibold text-white"
      : "border-tm-line text-zinc-500";
  const hover = inHuddle ? "hover:bg-zinc-700" : huddlers.length ? "hover:brightness-95" : "hover:bg-zinc-100";
  const pick = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <div className={`flex items-stretch overflow-hidden rounded-xl border text-sm transition ${tone}`}>
        <button
          onClick={() => setHuddle(inHuddle ? null : channelId)}
          className={`flex items-center gap-1.5 px-2 py-1.5 transition md:px-2.5 md:py-1 ${hover}`}
          title={inHuddle ? `Leave ${call}` : huddlers.length ? `Join ${huddlers.map((id) => displayName(profiles[id])).join(", ")}` : `Start a ${call}`}
        >
          {!inHuddle && huddlers.length > 0 && (
            <span className="flex -space-x-1.5">
              {huddlers.slice(0, 3).map((id) => (
                <span key={id} className="rounded-[30%] ring-2 ring-tm-green">
                  <Avatar profile={profiles[id]} size={18} />
                </span>
              ))}
            </span>
          )}
          <Icon name="headphones" size={16} />
          <span className="hidden md:inline">{inHuddle ? `In ${call}` : huddlers.length ? `Join ${call}` : CALL}</span>
        </button>
        {onSchedule && (
          <button
            onClick={() => setMenu(!menu)}
            className={`border-l px-1.5 transition ${inHuddle || huddlers.length ? "border-white/20" : "border-inherit"} ${hover}`}
            aria-label="More meeting options"
            title="More meeting options"
          >
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      </div>
      {menu && onSchedule && (
        <div className="tm-pop tm-float absolute top-10 right-0 z-40 w-56 rounded-2xl bg-white p-1.5 text-sm text-zinc-700">
          <button onClick={pick(() => setHuddle(inHuddle ? null : channelId))} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-tm-blue-light hover:text-tm-blue-dark">
            <Icon name="headphones" size={16} />
            {inHuddle ? `Leave ${call}` : huddlers.length ? `Join ${call}` : `Start ${call} now`}
          </button>
          <button onClick={pick(onSchedule)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-tm-blue-light hover:text-tm-blue-dark">
            <Icon name="calendar" size={16} />
            Schedule a meeting
          </button>
        </div>
      )}
    </div>
  );
}
