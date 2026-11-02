"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, displayName, activeStatus, type Message, type Reminder } from "@/lib/supabase";
import { dayLabel, timeOf } from "@/lib/format";
import { Avatar, EmojiPopover, Modal, btn, btnGhost, input } from "../ui";
import { useChat } from "./store";
import { useSavedIds } from "./useMessages";
import { Icon, type IconName } from "../icons";

// Phones show one pane at a time; this returns from a conversation or view to the sidebar list
export function MobileBack({ onClick }: { onClick?: () => void }) {
  const { setActive } = useChat();
  return (
    <button onClick={onClick ?? (() => setActive(null))} className="-ml-1 shrink-0 rounded-lg p-1 text-zinc-600 transition hover:bg-tm-surface md:hidden" aria-label="Back">
      <Icon name="chevronLeft" size={24} />
    </button>
  );
}

export function ViewShell({ icon, title, subtitle, action, children }: { icon: IconName; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tm-line px-3 md:px-6">
        <MobileBack />
        <Icon name={icon} size={20} className="text-zinc-500" />
        <span className="truncate text-lg font-semibold">{title}</span>
        {subtitle && <span className="hidden truncate text-sm text-zinc-400 sm:inline">{subtitle}</span>}
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </header>
      <div className="tm-fade flex-1 space-y-2 overflow-y-auto p-3 md:p-6">{children}</div>
    </>
  );
}

export const EmptyState = ({ icon, text }: { icon: IconName; text: string }) => (
  <div className="flex flex-col items-center gap-3 py-20 text-center text-sm text-zinc-400">
    <Icon name={icon} size={36} className="text-zinc-300" />
    {text}
  </div>
);

function ResultCard({ m, extra }: { m: Message; extra?: React.ReactNode }) {
  const { profiles, channels, channelTitle, setActive, setThread } = useChat();
  const ch = channels[m.channel_id];
  const open = () => {
    setActive(m.channel_id, m.parent_id && !m.also_in_channel ? null : m.id);
    if (m.parent_id) setThread({ id: m.parent_id, channelId: m.channel_id });
  };
  return (
    <button onClick={open} className="tm-fade-up flex w-full gap-3 rounded-2xl border border-tm-line bg-white p-4 text-left transition hover:-translate-y-px hover:border-tm-blue/30">
      <Avatar profile={profiles[m.user_id]} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold">{m.bot_name ?? displayName(profiles[m.user_id])}</span>
          <span className="text-xs text-zinc-400">
            {ch ? (ch.kind === "dm" ? channelTitle(ch) : `#${ch.name}`) : "channel"} · {dayLabel(m.created_at)} {timeOf(m.created_at)}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-3 text-[15px] text-zinc-700">{m.deleted_at ? <i className="text-zinc-400">Deleted</i> : m.body || "📎 Attachment"}</div>
        {extra}
      </div>
    </button>
  );
}

export function ThreadsView() {
  const { setThread, threadUnread } = useChat();
  const [threads, setThreads] = useState<Message[] | null>(null);
  // Refetch when a followed thread gets a new reply so counts and order stay current
  const unreadKey = Object.entries(threadUnread).map(([id, t]) => `${id}:${t.unread}`).join();
  useEffect(() => {
    supabase.rpc("my_threads").then(({ data }) => setThreads((data as Message[]) ?? []));
  }, [unreadKey]);
  return (
    <ViewShell icon="messages" title="Threads" subtitle="Conversations you started, joined or were mentioned in">
      {threads?.length === 0 && <EmptyState icon="messages" text="No threads yet. Reply to a message to start one." />}
      {threads?.map((m) => (
        <div key={m.id} onClickCapture={(e) => { e.stopPropagation(); setThread({ id: m.id, channelId: m.channel_id }); }}>
          <ResultCard
            m={m}
            extra={
              <div className="mt-1.5 flex items-center gap-2 text-sm font-medium text-tm-blue">
                {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
                {!!threadUnread[m.id] && (
                  <span className="rounded-full bg-tm-green px-1.5 py-px text-[11px] font-bold text-white">{threadUnread[m.id].unread} new</span>
                )}
                {m.last_reply_at && <span className="ml-2 font-normal text-zinc-400">Last reply {dayLabel(m.last_reply_at)} {timeOf(m.last_reply_at)}</span>}
              </div>
            }
          />
        </div>
      ))}
    </ViewShell>
  );
}

export function SavedView() {
  const savedIds = useSavedIds();
  const [items, setItems] = useState<Message[] | null>(null);
  useEffect(() => {
    supabase
      .from("saved_items")
      .select("created_at, messages(*)")
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems(((data ?? []) as unknown as { messages: Message }[]).map((r) => r.messages).filter(Boolean)));
  }, []);
  const shown = items?.filter((m) => savedIds?.has(m.id) ?? true);
  return (
    <ViewShell icon="bookmark" title="Saved" subtitle="Messages you saved for later">
      {shown?.length === 0 && <EmptyState icon="bookmark" text="Nothing saved yet. Hover a message and click the bookmark to keep it here." />}
      {shown?.map((m) => <ResultCard key={m.id} m={m} />)}
    </ViewShell>
  );
}

export function SearchView() {
  const { query, profiles, channels, setView } = useChat();
  const [results, setResults] = useState<Message[] | null>(null);
  const toggle = (f: string) => {
    const has = query.split(/\s+/).includes(f);
    setView("search", has ? query.split(/\s+/).filter((w) => w !== f).join(" ") : `${query} ${f}`.trim());
  };

  useEffect(() => {
    let live = true;
    (async () => {
      let text = query;
      let q = supabase.from("messages").select("*").is("deleted_at", null);
      const take = (re: RegExp) => {
        const m = text.match(re);
        if (m) text = text.replace(m[0], " ");
        return m?.[1];
      };
      const from = take(/\bfrom:@?([\w.-]+)/i);
      if (from) {
        const p = Object.values(profiles).find((x) => x.username.toLowerCase() === from.toLowerCase());
        q = q.eq("user_id", p?.id ?? "00000000-0000-0000-0000-000000000000");
      }
      const inCh = take(/\bin:#?([\w-]+)/i);
      if (inCh) {
        const c = Object.values(channels).find((x) => x.name?.toLowerCase() === inCh.toLowerCase());
        q = q.eq("channel_id", c?.id ?? "00000000-0000-0000-0000-000000000000");
      }
      const nextDay = (d: string) => new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10);
      const before = take(/\bbefore:(\d{4}-\d{2}-\d{2})\b/i);
      if (before) q = q.lt("created_at", before);
      const after = take(/\bafter:(\d{4}-\d{2}-\d{2})\b/i);
      if (after) q = q.gte("created_at", nextDay(after));
      const on = take(/\bon:(\d{4}-\d{2}-\d{2})\b/i);
      if (on) q = q.gte("created_at", on).lt("created_at", nextDay(on));
      if (take(/\bhas:file\b()/i) !== undefined) q = q.neq("attachments", "[]");
      if (take(/\bhas:link\b()/i) !== undefined) q = q.ilike("body", "%http%");
      if (take(/\bhas:pin\b()/i) !== undefined) q = q.not("pinned_at", "is", null);
      if (take(/\bis:thread\b()/i) !== undefined) q = q.not("parent_id", "is", null);
      text = text.trim();
      if (text) q = q.textSearch("fts", text, { type: "websearch", config: "simple" });
      const { data } = await q.order("created_at", { ascending: false }).limit(50);
      if (live) setResults((data as Message[]) ?? []);
    })();
    return () => {
      live = false;
    };
  }, [query, profiles, channels]);

  return (
    <ViewShell icon="search" title={`Results for “${query}”`} subtitle={results ? `${results.length}${results.length === 50 ? "+" : ""} messages` : "Searching…"}>
      <div className="flex flex-wrap gap-1.5 pb-2">
        {["has:link", "has:file", "has:pin", "is:thread"].map((f) => (
          <button
            key={f}
            onClick={() => toggle(f)}
            className={`rounded-full border px-3 py-1 font-mono text-xs transition ${query.split(/\s+/).includes(f) ? "border-tm-blue bg-tm-blue-light text-tm-blue-dark" : "border-tm-line text-zinc-500 hover:bg-tm-surface"}`}
          >
            {f}
          </button>
        ))}
        <span className="self-center text-xs text-zinc-400">also: from:@name in:#channel before:/after:/on:YYYY-MM-DD</span>
      </div>
      {results?.length === 0 && <EmptyState icon="search" text="No messages matched. Try fewer words, or modifiers like from:@name, in:#channel, has:link." />}
      {results?.map((m) => <ResultCard key={m.id} m={m} />)}
    </ViewShell>
  );
}

export function RemindersView() {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const load = () =>
    supabase
      .from("reminders")
      .select("*")
      .order("remind_at")
      .then(({ data }) => setItems((data as Reminder[]) ?? []));
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const remove = async (id: string) => {
    setItems((r) => r?.filter((x) => x.id !== id) ?? null);
    await supabase.from("reminders").delete().eq("id", id);
  };
  const upcoming = items?.filter((r) => !r.done_at) ?? [];
  const done = items?.filter((r) => r.done_at).reverse() ?? [];
  const row = (r: Reminder) => (
    <div key={r.id} className="tm-fade-up flex items-center gap-3 rounded-2xl border border-tm-line bg-white p-4">
      <span className="text-xl">{r.done_at ? "✅" : "⏰"}</span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[15px] ${r.done_at ? "text-zinc-400 line-through" : ""}`}>{r.text}</div>
        <div className="text-xs text-zinc-400">
          {dayLabel(r.remind_at)} {timeOf(r.remind_at)}
        </div>
      </div>
      <button onClick={() => remove(r.id)} className={btnGhost}>
        Delete
      </button>
    </div>
  );
  return (
    <ViewShell icon="clock" title="Reminders" subtitle="Create one with /remind me in 20m <text>">
      {items?.length === 0 && <EmptyState icon="clock" text="No reminders. Type /remind me tomorrow Review the report in any conversation." />}
      {upcoming.map(row)}
      {done.length > 0 && <div className="pt-4 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Completed</div>}
      {done.map(row)}
    </ViewShell>
  );
}

export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { me, channels, memberships, profiles, channelTitle, setActive, reload, unread } = useChat();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  type Option = { key: string; label: string; icon: React.ReactNode; hint?: string; go: () => void };
  const options = useMemo<Option[]>(() => {
    const term = q.toLowerCase();
    const convs: Option[] = Object.values(channels)
      .filter((c) => memberships[c.id] && !c.archived && channelTitle(c).toLowerCase().includes(term))
      .sort((a, b) => (unread[b.id]?.unread ?? 0) - (unread[a.id]?.unread ?? 0))
      .map((c) => ({
        key: c.id,
        label: channelTitle(c),
        icon: c.kind === "dm" ? "💬" : c.kind === "private" ? "🔒" : "#",
        hint: unread[c.id]?.unread ? `${unread[c.id].unread} unread` : undefined,
        go: () => setActive(c.id),
      }));
    const people: Option[] = term
      ? Object.values(profiles)
          .filter((p) => p.id !== me.id && (displayName(p) + " " + p.username).toLowerCase().includes(term))
          .map((p) => ({
            key: p.id,
            label: displayName(p),
            icon: <Avatar profile={p} size={20} />,
            hint: `@${p.username}`,
            go: async () => {
              const { data } = await supabase.rpc("get_or_create_dm", { p_user_ids: [p.id] });
              await reload();
              setActive(data);
            },
          }))
      : [];
    return [...convs, ...people].slice(0, 12);
  }, [q, channels, memberships, profiles, channelTitle, unread, me.id, setActive, reload]);

  const choose = (o?: Option) => {
    if (!o) return;
    o.go();
    onClose();
  };

  return (
    <div className="tm-fade fixed inset-0 z-50 flex items-start justify-center bg-slate-900/25 p-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="tm-pop tm-float w-full max-w-xl overflow-hidden rounded-2xl bg-white" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => (s + (e.key === "ArrowDown" ? 1 : options.length - 1)) % Math.max(options.length, 1));
            }
            if (e.key === "Enter") choose(options[sel]);
          }}
          placeholder="Jump to a channel, conversation or person…"
          className="w-full border-b border-tm-line px-5 py-4 text-base outline-none"
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {options.map((o, i) => (
            <li key={o.key}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(o)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${i === sel ? "bg-tm-blue-light text-tm-blue-dark" : ""}`}
              >
                <span className="flex w-5 justify-center text-zinc-400">{o.icon}</span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-zinc-400">{o.hint}</span>}
              </button>
            </li>
          ))}
          {options.length === 0 && <li className="py-8 text-center text-sm text-zinc-400">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

const PRESETS: [string, string, number | null][] = [
  ["📅", "In a meeting", 1],
  ["🚌", "Commuting", 0.5],
  ["🤒", "Out sick", 24],
  ["🌴", "Vacationing", null],
  ["🏠", "Working remotely", 8],
];

const CLEAR_AFTER: [string, number | null][] = [
  ["Don't clear", null],
  ["30 minutes", 0.5],
  ["1 hour", 1],
  ["4 hours", 4],
  ["Today", -1],
];

export function StatusModal({ onClose }: { onClose: () => void }) {
  const { me } = useChat();
  const current = activeStatus(me);
  const [emoji, setEmoji] = useState(current?.emoji ?? "");
  const [text, setText] = useState(current?.text ?? "");
  const [clear, setClear] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);

  async function save(e?: React.FormEvent, reset = false) {
    e?.preventDefault();
    let expires: string | null = null;
    if (clear === -1) {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      expires = d.toISOString();
    } else if (clear) expires = new Date(Date.now() + clear * 3600_000).toISOString();
    await supabase
      .from("profiles")
      .update(reset ? { status_emoji: "", status_text: "", status_expires_at: null } : { status_emoji: emoji, status_text: text.trim(), status_expires_at: expires })
      .eq("id", me.id);
    onClose();
  }

  return (
    <Modal title="Set a status" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="relative flex gap-2">
          <button type="button" onClick={() => setPicker(!picker)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-tm-line bg-tm-surface text-xl transition hover:bg-white">
            {emoji || "😊"}
          </button>
          {picker && <EmojiPopover className="top-12 left-0" onClose={() => setPicker(false)} onPick={(e) => { setEmoji(e); setPicker(false); }} />}
          <input className={input} placeholder="What's your status?" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        {!text && (
          <div className="space-y-0.5">
            {PRESETS.map(([e, t, h]) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setEmoji(e);
                  setText(t);
                  setClear(h);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-tm-surface"
              >
                <span className="text-lg">{e}</span> {t}
                <span className="ml-auto text-xs text-zinc-400">{h === null ? "Don't clear" : h < 1 ? `${h * 60} min` : `${h} h`}</span>
              </button>
            ))}
          </div>
        )}
        <label className="block text-sm font-medium">
          Clear after
          <select className={`${input} mt-1.5`} value={clear ?? ""} onChange={(e) => setClear(e.target.value === "" ? null : Number(e.target.value))}>
            {CLEAR_AFTER.map(([label, v]) => (
              <option key={label} value={v ?? ""}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          {current && (
            <button type="button" className={btnGhost} onClick={() => save(undefined, true)}>
              Clear status
            </button>
          )}
          <button className={btn} disabled={!emoji && !text.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
