"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, displayName, mentionsMe, type Attachment, type Message, type Reaction } from "@/lib/supabase";
import { renderBody, timeOf, fileSize, toMrkdwn, callLength } from "@/lib/format";
import BlockKit from "./BlockKit";
import { Avatar, EmojiPopover, Mark, StatusBadge, mentionUsers, useSignedUrl } from "../ui";
import { Icon, type IconName } from "../icons";
import { useChat } from "./store";
import { toggleSaved, useSavedIds } from "./useMessages";
import { EditorContent } from "@tiptap/react";
import { FormatBar, useRichEditor } from "./RichEditor";
import { AudioPlayer, fixDuration } from "./Clips";

export const QUICK_EMOJI = ["👍", "✅", "😂", "❤️"];

// Bots the app itself posts as (see the meetings and reminders migrations); they wear the app mark
const BUILT_IN_BOTS = new Set(["Meetings", "Reminders"]);

type Props = {
  msg: Message;
  reactions: Reaction[];
  grouped?: boolean;
  inThread?: boolean;
  highlight?: boolean;
  onReact: (emoji: string) => void;
};

export default function MessageItem({ msg, reactions, grouped, inThread, highlight, onReact }: Props) {
  const { me, profiles, channels, setThread, markUnread, showMember } = useChat();
  const savedIds = useSavedIds();
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const author = profiles[msg.user_id];
  const mine = msg.user_id === me.id && !msg.bot_name;
  const callLog = msg.bot_name ? undefined : msg.blocks?.find((b) => b.type === "call");
  const saved = savedIds?.has(msg.id);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const html = useMemo(() => {
    const chans = new Set(Object.values(channels).map((c) => (c.name ?? "").toLowerCase()));
    return renderBody(msg.body, mentionUsers(profiles), chans);
  }, [msg.body, profiles, channels]);

  const byEmoji = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of reactions) m.set(r.emoji, [...(m.get(r.emoji) ?? []), r.user_id]);
    return [...m.entries()];
  }, [reactions]);

  const firstLink = useMemo(() => msg.body.match(/https?:\/\/[^\s<>]+/)?.[0], [msg.body]);

  async function remove() {
    setMenu(false);
    if (confirm("Delete this message? This can't be undone."))
      await supabase.from("messages").update({ deleted_at: new Date().toISOString(), body: "", attachments: [] }).eq("id", msg.id);
  }

  // The query builder is lazy: it only sends the request once awaited
  async function togglePin() {
    setMenu(false);
    const { error } = await supabase.rpc("toggle_pin", { p_id: msg.id });
    if (error) alert(`Couldn't ${msg.pinned_at ? "unpin" : "pin"} this message: ${error.message}`);
  }

  function copyLink() {
    const target = msg.parent_id && !msg.also_in_channel ? msg.parent_id : msg.id;
    navigator.clipboard.writeText(`${location.origin}/app?c=${msg.channel_id}&m=${target}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setMenu(false);
  }

  const openThread = () => setThread({ id: msg.parent_id ?? msg.id, channelId: msg.channel_id });

  if (msg.deleted_at)
    return (
      <div id={`msg-${msg.id}`} className="flex gap-3 px-6 py-1 text-sm text-zinc-400 italic">
        <span className="w-9 shrink-0" />
        This message was deleted.
        {msg.reply_count > 0 && !inThread && <ReplyLink msg={msg} onOpen={openThread} />}
      </div>
    );

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group relative flex gap-3 px-6 transition-colors duration-300 hover:bg-tm-surface/80 ${grouped ? "py-0.5" : "pt-2.5 pb-1"} ${
        mentionsMe(msg, me.id) && !mine ? "bg-tm-green-light/50 shadow-[inset_3px_0_0_var(--color-tm-green)]" : ""
      } ${highlight ? "bg-tm-blue-light" : msg.pinned_at ? "bg-amber-50/60" : ""}`}
      onMouseLeave={() => setPicker(false)}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <span className="invisible block pt-1 text-right text-[10px] text-zinc-400 group-hover:visible">{timeOf(msg.created_at)}</span>
        ) : msg.bot_name && BUILT_IN_BOTS.has(msg.bot_name) ? (
          <Mark size={36} className="rounded-[30%] shadow-sm" />
        ) : msg.bot_name ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-[30%] bg-gradient-to-br from-tm-blue to-tm-green text-white">
            <Icon name="zap" size={18} />
          </div>
        ) : (
          <Avatar profile={author} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {msg.pinned_at && (
          <div className="mb-0.5 flex items-center gap-1 text-xs text-zinc-500">
            <Icon name="pin" size={12} /> Pinned by {displayName(profiles[msg.pinned_by ?? ""])}
          </div>
        )}
        {msg.also_in_channel && !inThread && (
          <button onClick={openThread} className="mb-0.5 text-xs text-zinc-400 hover:text-tm-blue">
            ↳ replied to a thread
          </button>
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            {msg.bot_name ? (
              <span className="font-semibold">{msg.bot_name}</span>
            ) : (
              <button className="font-semibold hover:underline" onClick={() => showMember(msg.user_id)}>{displayName(author)}</button>
            )}
            {msg.bot_name && <span className="rounded bg-tm-blue-light px-1 text-[10px] font-bold text-tm-blue">APP</span>}
            <StatusBadge profile={msg.bot_name ? undefined : author} />
            <span className="text-xs text-zinc-400">{timeOf(msg.created_at)}</span>
          </div>
        )}
        {editing ? (
          <EditBox msg={msg} onClose={() => setEditing(false)} />
        ) : (
          <div className="tm-rich text-[15px] leading-relaxed break-words text-zinc-800">
            {/* With blocks, text is only the notification/search fallback (as in Slack) */}
            {!msg.blocks?.length && <span dangerouslySetInnerHTML={{ __html: html }} />}
            {msg.edited_at && <span className="ml-1 text-xs text-zinc-400">(edited)</span>}
          </div>
        )}
        {callLog ? (
          <CallCard duration={callLog.duration} people={callLog.people} />
        ) : (
          msg.blocks && msg.blocks.length > 0 && !editing && <BlockKit blocks={msg.blocks} />
        )}
        {firstLink && !editing && <Unfurl url={firstLink} />}
        {msg.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {msg.attachments.map((a) => (
              <AttachmentView key={a.path} a={a} />
            ))}
          </div>
        )}
        {byEmoji.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {byEmoji.map(([emoji, users]) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                title={users.map((u) => displayName(profiles[u])).join(", ")}
                className={`tm-pop flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition active:scale-95 ${
                  users.includes(me.id) ? "border-tm-blue/40 bg-tm-blue-light text-tm-blue-dark" : "border-tm-line bg-white hover:border-zinc-300"
                }`}
              >
                <span className="text-sm">{emoji}</span> {users.length}
              </button>
            ))}
          </div>
        )}
        {msg.reply_count > 0 && !inThread && <ReplyLink msg={msg} onOpen={openThread} />}
      </div>

      {!editing && (
        <div className={`tm-raised absolute -top-4 right-6 items-center rounded-xl border border-tm-line bg-white p-0.5 ${menu || picker ? "flex" : "hidden group-hover:flex"}`}>
          {QUICK_EMOJI.slice(0, 3).map((e) => (
            <ToolBtn key={e} onClick={() => onReact(e)} title={`React ${e}`}>
              {e}
            </ToolBtn>
          ))}
          <ToolBtn onClick={() => setPicker(!picker)} title="Add reaction">
            <Icon name="smile" size={16} />
          </ToolBtn>
          {!inThread && !msg.parent_id && (
            <ToolBtn onClick={openThread} title="Reply in thread">
              <Icon name="messages" size={16} />
            </ToolBtn>
          )}
          <ToolBtn onClick={() => toggleSaved(msg.id)} title={saved ? "Remove from saved" : "Save for later"}>
            <Icon name="bookmark" size={16} filled={saved} />
          </ToolBtn>
          <div className="relative" ref={menuRef}>
            <ToolBtn onClick={() => setMenu(!menu)} title="More actions">
              <Icon name="more" size={16} />
            </ToolBtn>
            {menu && (
              <div className="tm-pop tm-float absolute top-9 right-0 z-30 w-52 rounded-xl bg-white p-1 text-sm">
                <MenuBtn icon="link" onClick={copyLink}>Copy link</MenuBtn>
                <MenuBtn icon="unread" onClick={() => { markUnread(msg); setMenu(false); }}>Mark unread</MenuBtn>
                <MenuBtn icon="pin" onClick={togglePin}>{msg.pinned_at ? "Unpin from channel" : "Pin to channel"}</MenuBtn>
                {mine && (
                  <>
                    <div className="my-1 h-px bg-tm-line" />
                    {!callLog && <MenuBtn icon="pencil" onClick={() => { setEditing(true); setMenu(false); }}>Edit message</MenuBtn>}
                    <MenuBtn icon="trash" onClick={remove} danger>Delete message</MenuBtn>
                  </>
                )}
              </div>
            )}
          </div>
          {picker && <EmojiPopover className="top-10 right-0" onClose={() => setPicker(false)} onPick={(e) => { onReact(e); setPicker(false); }} />}
        </div>
      )}
      {copied && <span className="tm-pop absolute top-1 right-6 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-white">Link copied</span>}
    </div>
  );
}

function EditBox({ msg, onClose }: { msg: Message; onClose: () => void }) {
  const editor = useRichEditor({
    initial: msg.body,
    autoFocus: true,
    onKeyDown: (e) => {
      if (e.key === "Escape") {
        onClose();
        return true;
      }
      if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey || !editor?.isActive("codeBlock"))) {
        e.preventDefault();
        save();
        return true;
      }
      return false;
    },
  });

  async function save() {
    if (!editor) return;
    const body = toMrkdwn(editor.getJSON());
    onClose();
    if (body && body !== msg.body) await supabase.from("messages").update({ body, edited_at: new Date().toISOString() }).eq("id", msg.id);
  }

  return (
    <div className="mt-1 rounded-xl border border-tm-blue/40 bg-white ring-4 ring-tm-blue/10">
      {editor && <FormatBar editor={editor} />}
      <EditorContent editor={editor} className="tm-rich tm-editor" />
      <div className="flex justify-end gap-2 px-2 pb-2 text-sm">
        <button className="rounded-lg px-3 py-1 transition hover:bg-tm-surface" onClick={onClose}>
          Cancel
        </button>
        <button className="rounded-lg bg-tm-green px-3 py-1 font-semibold text-white" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

// Summary of a finished call: answered or missed, how long it ran and who was in it.
// Calls logged before attendees were recorded have no people and show as ended.
function CallCard({ duration, people }: { duration: number; people?: string[] }) {
  const { profiles } = useChat();
  const missed = people?.length === 1;
  const shown = people?.slice(0, 4) ?? [];
  const extra = (people?.length ?? 0) - shown.length;
  const names = people?.map((id) => displayName(profiles[id])).join(", ");
  return (
    <div className="mt-1.5 flex w-[22rem] max-w-full items-center gap-3 rounded-2xl border border-tm-line bg-white p-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${missed ? "bg-red-50 text-red-500" : "bg-tm-green-light text-tm-green"}`}>
        <Icon name={missed ? "phoneOff" : "phone"} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-zinc-900">{missed ? "Missed call" : "Call ended"}</div>
        <div className="truncate text-xs text-zinc-500">
          {missed ? "No one joined" : `${callLength(duration)}${people ? ` · ${people.length} participants` : ""}`}
        </div>
      </div>
      {shown.length > 0 && (
        <div className="flex shrink-0 -space-x-2" title={names}>
          {shown.map((id) => (
            <span key={id} className="rounded-[30%] ring-2 ring-white">
              <Avatar profile={profiles[id]} size={26} />
            </span>
          ))}
          {extra > 0 && (
            <span className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[30%] bg-tm-surface px-1 text-[11px] font-semibold text-zinc-600 ring-2 ring-white">+{extra}</span>
          )}
        </div>
      )}
    </div>
  );
}

const ToolBtn = (p:{ onClick: () => void; title: string; children: React.ReactNode }) => (
  <button onClick={p.onClick} title={p.title} className="flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-sm transition hover:bg-tm-surface">
    {p.children}
  </button>
);

const MenuBtn = (p: { onClick: () => void; icon: IconName; danger?: boolean; children: React.ReactNode }) => (
  <button onClick={p.onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition ${p.danger ? "text-red-600 hover:bg-red-50" : "hover:bg-tm-blue-light hover:text-tm-blue-dark"}`}>
    <Icon name={p.icon} size={15} className="opacity-70" />
    {p.children}
  </button>
);

function ReplyLink({ msg, onOpen }: { msg: Message; onOpen: () => void }) {
  const fresh = useChat().threadUnread[msg.id]?.unread;
  return (
    // Hangs off the message on an elbow connector, indented, so it reads as replies to it rather than a new line of chat
    <div className="mt-1.5 flex items-start pl-1">
      <span className="mr-1.5 h-3 w-3 shrink-0 rounded-bl-md border-b-2 border-l-2 border-zinc-200" />
      <button
        onClick={onOpen}
        className="group/reply -mt-0.5 flex min-w-0 items-center gap-1.5 rounded-md px-1 text-[13px] leading-5 not-italic transition hover:bg-white"
      >
        <span className="font-semibold text-tm-blue group-hover/reply:underline">
          {msg.reply_count} {msg.reply_count === 1 ? "reply" : "replies"}
        </span>
        {!!fresh && <span className="tm-pop rounded-full bg-tm-green px-1.5 py-px text-[11px] font-bold text-white">{fresh} new</span>}
        {msg.last_reply_at && <span className="truncate text-xs text-zinc-400">· Last reply {timeOf(msg.last_reply_at)}</span>}
      </button>
    </div>
  );
}

type Preview = { title: string; description?: string; image: string | null; site: string } | null;
const unfurlCache = new Map<string, Promise<Preview>>();

function Unfurl({ url }: { url: string }) {
  const [data, setData] = useState<Preview>(null);
  useEffect(() => {
    if (!unfurlCache.has(url)) unfurlCache.set(url, fetch(`/api/unfurl?url=${encodeURIComponent(url)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    let live = true;
    unfurlCache.get(url)!.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [url]);
  if (!data) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="tm-fade mt-1.5 flex max-w-lg gap-3 rounded-xl border-l-4 border-tm-blue/40 bg-tm-surface p-3 transition hover:bg-tm-blue-light/60">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-zinc-400">{data.site}</div>
        <div className="truncate font-semibold text-tm-blue">{data.title}</div>
        {data.description && <div className="line-clamp-2 text-sm text-zinc-600">{data.description}</div>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.image && <img src={data.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
    </a>
  );
}

function AttachmentView({ a }: { a: Attachment }) {
  const url = useSignedUrl(a.path);
  const [open, setOpen] = useState(false);
  if (a.type.startsWith("audio/"))
    return url ? <AudioPlayer src={url} duration={a.duration} peaks={a.peaks} /> : <div className="h-[54px] w-80 max-w-full animate-pulse rounded-xl bg-tm-surface" />;
  if (a.type.startsWith("video/"))
    return url ? (
      <video src={url} controls playsInline preload="metadata" onLoadedMetadata={(e) => fixDuration(e.currentTarget)} className="max-h-80 w-full max-w-md rounded-xl border border-tm-line bg-black" />
    ) : (
      <div className="aspect-video w-96 max-w-full animate-pulse rounded-xl bg-tm-surface" />
    );
  if (a.type.startsWith("image/"))
    return (
      <>
        <button onClick={() => url && setOpen(true)} className="max-w-full overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={a.name} className="max-h-72 max-w-[min(24rem,100%)] rounded-xl border border-tm-line object-contain transition hover:brightness-95" /> : <div className="h-40 w-60 animate-pulse rounded-xl bg-tm-surface" />}
        </button>
        {open && url && <ImageViewer url={url} name={a.name} onClose={() => setOpen(false)} />}
      </>
    );
  return (
    <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" download={a.name} className="flex w-72 items-center gap-3 rounded-xl border border-tm-line bg-white p-2.5 transition hover:bg-tm-surface">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-tm-blue to-tm-blue-dark text-[10px] font-bold text-white uppercase">
        {a.name.split(".").pop()?.slice(0, 4)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{a.name}</span>
        <span className="text-xs text-zinc-400">{fileSize(a.size)}</span>
      </span>
    </a>
  );
}

function ImageViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="tm-fade fixed inset-0 z-50 flex flex-col bg-slate-950/85 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between px-5 py-3 text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">{name}</span>
        <div className="flex gap-2">
          <a href={url} download={name} className="rounded-lg px-3 py-1 transition hover:bg-white/10">
            Download
          </a>
          <button onClick={onClose} className="rounded-lg px-3 py-1 transition hover:bg-white/10">
            ✕
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          onClick={(e) => {
            e.stopPropagation();
            setZoom(!zoom);
          }}
          className={`tm-pop rounded-lg transition-transform duration-300 ${zoom ? "max-w-none scale-150 cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}`}
        />
      </div>
    </div>
  );
}
