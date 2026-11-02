"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase, displayName, type Message, type Reaction } from "@/lib/supabase";
import { dayLabel } from "@/lib/format";
import { useChat } from "./store";
import { useMessages, toggleReaction } from "./useMessages";
import MessageItem from "./MessageItem";
import Composer from "./Composer";
import { ChannelDetails } from "./Modals";
import Canvas from "./Canvas";
import { MobileBack } from "./Views";
import { MeetingBanner, ScheduleMeeting } from "./Meetings";
import { Avatar, StatusBadge } from "../ui";
import { Icon } from "../icons";
import { CALL, call } from "@/lib/brand";

export default function ChannelView({ channelId }: { channelId: string }) {
  const { me, channels, memberships, profiles, channelTitle, markRead, dmMembers, focusId, updateMembership, huddle, huddles, setHuddle } = useChat();
  const channel = channels[channelId];
  const { messages, reactions, setReactions, upsert, hasMore, loading, loadOlder } = useMessages(channelId, null);
  const [lastRead] = useState(memberships[channelId]?.last_read_at);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [details, setDetails] = useState(false);
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
  const memberCount = isDM ? dmMembers[channelId]?.length : undefined;
  const others = isDM ? (dmMembers[channelId] ?? []).filter((id) => id !== me.id) : [];
  const dmPartner = others.length === 1 ? profiles[others[0]] : undefined;
  const inHuddle = huddle === channelId;
  const huddlers = huddles[channelId] ?? [];

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-tm-line px-2 md:gap-2 md:px-5">
        <MobileBack />
        <button onClick={() => setDetails(true)} className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1 text-lg font-semibold transition hover:bg-tm-surface md:px-2">
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
        <button
          onClick={() => setHuddle(inHuddle ? null : channelId)}
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-xl border px-2 py-1.5 text-sm transition md:px-2.5 md:py-1 ${
            inHuddle
              ? "border-zinc-800 bg-zinc-800 text-white"
              : huddlers.length
                ? "border-zinc-300 bg-tm-surface font-medium text-zinc-800 hover:bg-zinc-800 hover:text-white"
                : "border-tm-line text-zinc-500 hover:bg-tm-surface"
          }`}
          title={inHuddle ? `Leave ${call}` : huddlers.length ? `Join ${huddlers.map((id) => displayName(profiles[id])).join(", ")}` : `Start a ${call}`}
        >
          {!inHuddle && huddlers.length > 0 && (
            <span className="flex -space-x-1.5">
              {huddlers.slice(0, 3).map((id) => (
                <Avatar key={id} profile={profiles[id]} size={18} />
              ))}
            </span>
          )}
          <Icon name="headphones" size={16} />
          <span className="hidden md:inline">{inHuddle ? `In ${call}` : huddlers.length ? `Join ${call}` : CALL}</span>
        </button>
        {!channel.archived && (
          <button
            onClick={() => setScheduling(true)}
            className="shrink-0 rounded-xl border border-tm-line px-2 py-1.5 text-sm text-zinc-500 transition hover:bg-tm-surface md:px-2.5 md:py-1"
            title="Schedule a meeting here"
          >
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={16} />
              <span className="hidden lg:inline">Schedule</span>
            </span>
          </button>
        )}
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
        <button onClick={() => setDetails(true)} className="shrink-0 rounded-xl border border-tm-line px-2 py-1.5 text-sm text-zinc-500 transition hover:bg-tm-surface md:px-2.5 md:py-1">
          <span className="flex items-center gap-1.5">
            <Icon name="users" size={16} />
            {memberCount ?? "Details"}
          </span>
        </button>
      </header>
      <MeetingBanner channelId={channelId} />
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
      ) : (
        <Composer channelId={channelId} placeholder={`Message ${isDM ? title : "#" + title}`} onSent={upsert} onTyping={sendTyping} />
      )}
      {details && <ChannelDetails channel={channel} onClose={() => setDetails(false)} />}
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

export function MessageList({ messages, reactions, loading, hasMore, loadOlder, lastRead, inThread, intro, focusId, onReact }: ListProps) {
  const { me } = useChat();
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
      {loading && <p className="p-5 text-sm text-zinc-400">Loading messages…</p>}
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
