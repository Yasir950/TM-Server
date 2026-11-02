"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, displayName } from "@/lib/supabase";
import { renderBody, timeOf } from "@/lib/format";
import { Icon } from "../icons";
import { useChat } from "./store";

type Row = { channel_id: string; body: string; updated_by: string | null; updated_at: string };
const TASK = /^(\s*)- \[( |x)\] (.*)$/i;

// A shared markdown doc per channel. Lines like "- [ ] task" render as a checklist anyone can tick.
export default function Canvas({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { me, profiles, channels } = useChat();
  const [row, setRow] = useState<Row | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    supabase
      .from("canvases")
      .select("*")
      .eq("channel_id", channelId)
      .maybeSingle()
      .then(({ data }) => setRow(data ?? { channel_id: channelId, body: "", updated_by: null, updated_at: "" }));
    const ch = supabase
      .channel(`canvas:${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "canvases", filter: `channel_id=eq.${channelId}` }, ({ new: r }) => setRow(r as Row))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId]);

  const save = async (body: string) => {
    const { data, error } = await supabase
      .from("canvases")
      .upsert({ channel_id: channelId, body, updated_at: new Date().toISOString(), updated_by: me.id })
      .select()
      .single();
    setError(error ? error.message : "");
    if (data) setRow(data);
  };

  const edit = (body: string) => {
    setDraft(body);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(body), 800);
  };

  const toggle = (i: number) => {
    if (!row) return;
    const lines = row.body.split("\n");
    lines[i] = lines[i].replace(TASK, (_, ind, x, t) => `${ind}- [${x.trim() ? " " : "x"}] ${t}`);
    save(lines.join("\n"));
  };

  const users = new Set(Object.values(profiles).map((p) => p.username.toLowerCase()));
  const chans = new Set(Object.values(channels).map((c) => (c.name ?? "").toLowerCase()));
  const lines = row?.body.split("\n") ?? [];
  const tasks = lines.filter((l) => TASK.test(l));
  const done = tasks.filter((l) => /\[x\]/i.test(l)).length;

  return (
    <aside className="tm-fade fixed inset-y-0 right-0 z-40 flex w-[min(26rem,100vw)] flex-col border-l border-tm-line bg-white shadow-2xl">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tm-line px-4">
        <span className="font-semibold">Canvas</span>
        {tasks.length > 0 && (
          <span className="rounded-full bg-tm-surface px-2 py-0.5 text-xs text-zinc-500">
            {done}/{tasks.length} done
          </span>
        )}
        <button
          onClick={() => (draft === null ? setDraft(row?.body ?? "") : (clearTimeout(saveTimer.current), save(draft), setDraft(null)))}
          className="ml-auto rounded-lg px-2 py-1 text-sm text-tm-blue hover:bg-tm-surface"
        >
          {draft === null ? "Edit" : "Done"}
        </button>
        <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-tm-surface" title="Close">
          <Icon name="x" size={16} />
        </button>
      </header>
      {draft !== null ? (
        <textarea
          autoFocus
          className="flex-1 resize-none p-4 font-mono text-sm outline-none"
          placeholder={"# Project notes\n\n- [ ] A task\n- [x] A finished task"}
          value={draft}
          onChange={(e) => edit(e.target.value)}
        />
      ) : (
        <div className="tm-rich flex-1 space-y-1 overflow-y-auto p-4 text-[15px]">
          {!row?.body.trim() && <p className="text-sm text-zinc-400">Empty canvas. Click Edit to add notes, links and checklists for this channel.</p>}
          {lines.map((l, i) => {
            const t = TASK.exec(l);
            if (t)
              return (
                <label key={i} className="flex cursor-pointer items-start gap-2" style={{ paddingLeft: t[1].length * 8 }}>
                  <input type="checkbox" className="mt-1.5" checked={t[2].toLowerCase() === "x"} onChange={() => toggle(i)} />
                  <span className={t[2].trim() ? "text-zinc-400 line-through" : ""} dangerouslySetInnerHTML={{ __html: renderBody(t[3], users, chans) }} />
                </label>
              );
            const h = /^(#{1,3}) (.*)$/.exec(l);
            if (h) return <div key={i} className={`font-bold ${["text-xl", "text-lg", "text-base"][h[1].length - 1]}`} dangerouslySetInnerHTML={{ __html: renderBody(h[2], users, chans) }} />;
            return l.trim() ? <div key={i} dangerouslySetInnerHTML={{ __html: renderBody(l, users, chans) }} /> : <div key={i} className="h-2" />;
          })}
        </div>
      )}
      <footer className="border-t border-tm-line px-4 py-2 text-xs text-zinc-400">
        {error ? <span className="text-red-600">{error}</span> : row?.updated_by ? `Last edited by ${displayName(profiles[row.updated_by])} · ${timeOf(row.updated_at)}` : "Markdown · “- [ ] ” makes a checklist item"}
      </footer>
    </aside>
  );
}
