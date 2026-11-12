"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { supabase, displayName, fmtBytes, type Attachment, type Message, type Profile } from "@/lib/supabase";
import { clock, fileSize, toMrkdwn } from "@/lib/format";
import { Avatar, EmojiPopover } from "../ui";
import { Icon, type IconName } from "../icons";
import { useChat } from "./store";
import { COMMANDS, runCommand } from "./commands";
import { FormatBar, useRichEditor } from "./RichEditor";
import { AudioPlayer, VideoRecorder, VoiceRecorder, clipMeta } from "./Clips";

type Props = {
  channelId: string;
  parentId?: string;
  placeholder: string;
  onSent?: (m: Message) => void;
  onTyping?: () => void;
  alsoSendLabel?: string;
};

const FORMAT_KEY = "tm:formatbar";

// @here is still understood when typed; the picker offers the one name for it
const GROUP_MENTIONS = [{ username: "channel", hint: "Notify everyone in this channel" }];

export default function Composer({ channelId, parentId, placeholder, onSent, onTyping, alsoSendLabel }: Props) {
  const [alsoSend, setAlsoSend] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const { me, profiles, channels, reload, setView, plan } = useChat();
  const [notice, setNotice] = useState("");
  const draftKey = `tm:draft:${channelId}:${parentId ?? ""}`;
  // Composer is remounted per conversation (parents are keyed), so the draft loads once
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mention, setMention] = useState<{ q: string; from: number; to: number } | null>(null);
  const [sel, setSel] = useState(0);
  const [formatting, setFormatting] = useState(() => localStorage.getItem(FORMAT_KEY) !== "0");
  const [recording, setRecording] = useState<"voice" | "video" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (more: File[]) => setFiles((f) => [...f, ...more]);

  const editor = useRichEditor({
    initial: text,
    placeholder,
    autoFocus: true,
    onChange: (md) => {
      setText(md);
      setSel(0);
      onTyping?.();
    },
    onCaret: trackMention,
    onKeyDown,
    onFiles: addFiles,
  });

  useEffect(() => {
    if (text) localStorage.setItem(draftKey, text);
    else localStorage.removeItem(draftKey);
  }, [text, draftKey]);

  // Whole-channel mentions first (not in DMs), then people
  const suggestions: { username: string; profile?: Profile; hint: string }[] = mention
    ? [
        ...(channels[channelId]?.kind === "dm" ? [] : GROUP_MENTIONS).filter((g) => g.username.startsWith(mention.q.toLowerCase())),
        ...Object.values(profiles)
          .filter((p) => (p.username + " " + p.full_name).toLowerCase().includes(mention.q.toLowerCase()))
          .map((p) => ({ username: p.username, profile: p, hint: `@${p.username}` })),
      ].slice(0, 6)
    : [];
  const commands = /^\/\w*$/.test(text) ? COMMANDS.filter(([c]) => c.startsWith(text.toLowerCase())) : [];

  function trackMention(ed: Editor) {
    const { $from, empty } = ed.state.selection;
    const m = empty && !ed.isActive("codeBlock") ? /(^|\s)@([\w.-]*)$/.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "￼")) : null;
    setMention(m ? { q: m[2], from: $from.pos - m[2].length, to: $from.pos } : null);
  }

  function pickMention(username: string) {
    if (!mention || !editor) return;
    editor.chain().focus().insertContentAt({ from: mention.from, to: mention.to }, { type: "text", text: `${username} ` }).run();
    setMention(null);
  }

  function setPlain(s: string) {
    editor?.chain().setContent(s ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: s }] }] } : "", { emitUpdate: false }).focus("end").run();
    setText(s);
  }

  async function send() {
    if (!editor) return;
    let body = toMrkdwn(editor.getJSON());
    if ((!body && !files.length) || sending) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      if (body.startsWith("/") && !files.length) {
        const r = await runCommand(body, { me, channel: channels[channelId], profiles, reload, openReminders: () => setView("reminders") });
        if (r && !r.body) {
          setPlain("");
          setNotice(r.notice ?? "");
          return;
        }
        if (r?.body) body = r.body;
      }
      const attachments: Attachment[] = [];
      // Per-file limit comes from the company's plan; the bucket only knows the largest plan's limit
      const tooBig = plan?.max_file_bytes ? files.find((f) => f.size > plan.max_file_bytes!) : undefined;
      if (tooBig && plan?.max_file_bytes)
        throw new Error(`${tooBig.name} is ${fmtBytes(tooBig.size)}. Files on the ${plan.name} plan can be up to ${fmtBytes(plan.max_file_bytes)}.`);
      for (const f of files) {
        const path = `${channelId}/${crypto.randomUUID()}/${f.name}`;
        const { error } = await supabase.storage.from("attachments").upload(path, f, { contentType: f.type });
        // The storage policy refuses uploads once the company's quota is used up
        if (error && /row-level security|policy/i.test(error.message))
          throw new Error(`Your company has used all of its file storage${plan ? ` on the ${plan.name} plan` : ""}. An admin can free up space or upgrade.`);
        if (error) throw error;
        attachments.push({ name: f.name, path, size: f.size, type: f.type || "application/octet-stream", ...clipMeta.get(f) });
      }
      const byName = new Map(Object.values(profiles).map((p) => [p.username.toLowerCase(), p.id]));
      const mentions = [...body.matchAll(/(?:^|\s)@([\w.-]+)/g)].map((m) => byName.get(m[1].toLowerCase())).filter(Boolean) as string[];
      const { data, error } = await supabase
        .from("messages")
        .insert({ channel_id: channelId, user_id: me.id, parent_id: parentId ?? null, also_in_channel: !!parentId && alsoSend, body, attachments, mentions: [...new Set(mentions)] })
        .select()
        .single();
      if (error) throw error;
      setPlain("");
      setFiles([]);
      setAlsoSend(false);
      onSent?.(data as Message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      editor.commands.focus();
    }
  }

  // Runs before the editor handles the key; true means we took it
  function onKeyDown(e: KeyboardEvent): boolean {
    if (commands.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s + (e.key === "ArrowDown" ? 1 : commands.length - 1)) % commands.length);
        return true;
      }
      if (e.key === "Tab" || (e.key === "Enter" && commands[sel % commands.length][0] !== text)) {
        e.preventDefault();
        setPlain(commands[sel % commands.length][0] + " ");
        return true;
      }
    }
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(suggestions[sel].username);
        return true;
      }
      if (e.key === "Escape") {
        setMention(null);
        return true;
      }
    }
    // Enter sends; inside a code block it's a new line and Ctrl/Cmd+Enter sends
    if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey || !editor?.isActive("codeBlock"))) {
      e.preventDefault();
      send();
      return true;
    }
    return false;
  }

  function insertMention() {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset);
    editor.chain().focus().insertContent(before && !/\s$/.test(before) ? " @" : "@").run();
  }

  const toggleFormatting = () => {
    localStorage.setItem(FORMAT_KEY, formatting ? "0" : "1");
    setFormatting(!formatting);
  };

  return (
    <div
      className="relative px-5 pb-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {commands.length > 0 && (
        <ul className="tm-pop tm-float absolute bottom-full left-5 z-10 mb-1 w-96 overflow-hidden rounded-xl bg-white p-1">
          {commands.map(([c, hint], i) => (
            <li key={c}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPlain(c + " ");
                }}
                className={`flex w-full items-baseline gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${i === sel % commands.length ? "bg-tm-blue text-white" : ""}`}
              >
                <span className="font-mono font-semibold">{c}</span>
                <span className={`truncate text-xs ${i === sel % commands.length ? "text-white/80" : "text-zinc-500"}`}>{hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <ul className="tm-pop tm-float absolute bottom-full left-5 z-10 mb-1 w-72 overflow-hidden rounded-xl bg-white p-1">
          {suggestions.map((s, i) => (
            <li key={s.username}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(s.username);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${i === sel ? "bg-tm-blue text-white" : ""}`}
              >
                {s.profile ? (
                  <Avatar profile={s.profile} size={20} />
                ) : (
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${i === sel ? "bg-white/20" : "bg-tm-blue-light text-tm-blue"}`}>
                    <Icon name="bell" size={12} />
                  </span>
                )}
                <span className="font-semibold">{s.profile ? displayName(s.profile) : `@${s.username}`}</span>
                <span className={`truncate ${i === sel ? "text-white/80" : "text-zinc-500"}`}>{s.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-2xl border border-tm-line bg-white transition focus-within:border-tm-blue/40 focus-within:ring-4 focus-within:ring-tm-blue/10">
        {formatting && editor && recording !== "voice" && <FormatBar editor={editor} />}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {files.map((f, i) => (
              <FileChip key={i} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}
        {recording === "voice" && (
          <VoiceRecorder
            onDone={(f) => {
              addFiles([f]);
              setRecording(null);
              editor?.commands.focus();
            }}
            onCancel={() => setRecording(null)}
          />
        )}
        <div className={recording === "voice" ? "hidden" : ""}>
          <EditorContent editor={editor} className="tm-rich tm-editor" />
        </div>
        <div className="relative flex items-center gap-0.5 px-2 pb-2">
          <BarBtn icon="plus" title="Attach files" onClick={() => fileInput.current?.click()} />
          <BarBtn icon="type" title={formatting ? "Hide formatting" : "Show formatting"} active={formatting} onClick={toggleFormatting} />
          <BarBtn icon="smile" title="Emoji" onClick={() => setEmoji(!emoji)} />
          <BarBtn icon="at" title="Mention someone" onClick={insertMention} />
          {emoji && (
            <EmojiPopover
              className="bottom-10 left-0"
              onClose={() => setEmoji(false)}
              onPick={(e) => {
                editor?.chain().focus().insertContent(e).run();
                setEmoji(false);
              }}
            />
          )}
          <span className="mx-1 h-5 w-px bg-tm-line" />
          <BarBtn icon="video" title="Record a video clip" disabled={!!recording} onClick={() => setRecording("video")} />
          <BarBtn icon="mic" title="Record an audio clip" disabled={!!recording} active={recording === "voice"} onClick={() => setRecording("voice")} />
          {alsoSendLabel && (
            <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 select-none">
              <input type="checkbox" checked={alsoSend} onChange={(e) => setAlsoSend(e.target.checked)} className="accent-tm-blue" />
              {alsoSendLabel}
            </label>
          )}
          <span className="flex-1" />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            onClick={send}
            disabled={sending || recording === "voice" || (!text.trim() && !files.length)}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-tm-green px-3 text-sm font-semibold text-white transition hover:brightness-105 active:scale-95 disabled:bg-tm-surface disabled:text-zinc-300"
            title="Send (Enter)"
          >
            {sending ? "…" : <Icon name="send" size={15} />}
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {notice && !error && <p className="tm-fade mt-1 max-h-60 overflow-y-auto text-xs whitespace-pre-line text-zinc-500">{notice} <span className="text-zinc-400">· only visible to you</span></p>}
      {recording === "video" && (
        <VideoRecorder
          onDone={(f) => addFiles([f])}
          onClose={() => {
            setRecording(null);
            editor?.commands.focus();
          }}
        />
      )}
    </div>
  );
}

function BarBtn({ icon, title, onClick, active, disabled }: { icon: IconName; title: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-40 ${active ? "bg-tm-blue-light text-tm-blue-dark" : "text-zinc-400 hover:bg-tm-surface hover:text-zinc-700"}`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

// Pending attachment, with a playable preview for recorded clips
function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const meta = clipMeta.get(file);
  const kind = file.type.split("/")[0];
  const url = useMemo(() => (["image", "video", "audio"].includes(kind) ? URL.createObjectURL(file) : null), [file, kind]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const remove = (
    <button onClick={onRemove} title="Remove" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white hover:text-zinc-700">
      <Icon name="x" size={14} />
    </button>
  );

  if (kind === "audio" && url)
    return (
      <span className="tm-pop flex items-center gap-1">
        <AudioPlayer src={url} duration={meta?.duration} peaks={meta?.peaks} />
        {remove}
      </span>
    );
  return (
    <span className="tm-pop flex items-center gap-2 rounded-lg bg-tm-surface py-1 pr-1 pl-1.5 text-xs">
      {kind === "video" && url ? (
        <video src={url} muted preload="metadata" className="h-10 w-16 rounded-md bg-black object-cover" />
      ) : kind === "image" && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-10 w-10 rounded-md object-cover" />
      ) : (
        <Icon name="paperclip" size={16} className="mx-1 text-zinc-400" />
      )}
      <span className="max-w-48 truncate">{meta ? "Video clip" : file.name}</span>
      <span className="text-zinc-400">{meta ? clock(meta.duration) : fileSize(file.size)}</span>
      {remove}
    </span>
  );
}
