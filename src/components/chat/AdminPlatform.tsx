"use client";

import { useEffect, useState } from "react";
import { supabase, displayName, type Workflow } from "@/lib/supabase";
import { timeOf, dayLabel } from "@/lib/format";
import { btn, btnGhost, input } from "../ui";
import { useChat } from "./store";
import { Locked } from "./Plan";

type DlpRule = { id: string; name: string; pattern: string; action: "block" | "redact"; enabled: boolean };
type Sub = { id: string; url: string; events: string[]; secret: string; enabled: boolean };
type Audit = { id: number; actor: string | null; action: string; target: string | null; details: Record<string, unknown>; created_at: string };

const EVENTS = ["message.posted", "channel.created", "member.joined"];
const select = "rounded-lg border border-tm-line bg-white px-2 py-2 text-sm";
const remove = "text-xs text-zinc-400 hover:text-red-600";

const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-tm-line bg-white p-5">
    <h2 className="text-sm font-semibold text-zinc-500">{title}</h2>
    {hint && <p className="mt-0.5 mb-3 text-xs text-zinc-400">{hint}</p>}
    {children}
  </section>
);

// Phase 3 admin cards: Workflow Builder, DLP, Events API, audit log
// DLP, Events API and the audit log need a plan that includes them (Admin > Plan)
export default function AdminPlatform({ notify }: { notify: (s: string) => void }) {
  const { plan } = useChat();
  return (
    <>
      <Workflows notify={notify} />
      <div className="grid gap-2 lg:grid-cols-2">
        {plan?.dlp ? <Dlp notify={notify} /> : <Locked title="Data loss prevention">Block or redact sensitive content like card numbers before it&apos;s posted.</Locked>}
        {plan?.events_api ? (
          <Events notify={notify} />
        ) : (
          <Locked title="Events API">Send signed callbacks to your own systems when messages are posted, channels are created or people join.</Locked>
        )}
      </div>
      {plan?.audit_log ? <AuditLog /> : <Locked title="Audit log">See who changed channels, members, roles, settings and integrations, and export the record.</Locked>}
    </>
  );
}

function Workflows({ notify }: { notify: (s: string) => void }) {
  const { channels, memberships } = useChat();
  const rooms = Object.values(channels).filter((c) => c.kind !== "dm" && !c.archived && memberships[c.id]);
  const [list, setList] = useState<Workflow[]>([]);
  const [f, setF] = useState({ channel_id: "", name: "", trigger: "member_joined", keyword: "", reply: "" });

  const load = () => supabase.from("workflows").select("*").order("created_at").then(({ data }) => setList(data ?? []));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const channel_id = f.channel_id || rooms[0]?.id;
    const { error } = await supabase.from("workflows").insert({ ...f, channel_id, keyword: f.trigger === "keyword" ? f.keyword.trim() : null });
    notify(error ? error.message : `Workflow “${f.name}” created`);
    if (!error) setF({ ...f, name: "", keyword: "", reply: "" });
    load();
  };
  const toggle = async (w: Workflow) => {
    await supabase.from("workflows").update({ enabled: !w.enabled }).eq("id", w.id);
    load();
  };
  const del = async (w: Workflow) => {
    await supabase.from("workflows").delete().eq("id", w.id);
    load();
  };

  return (
    <Card title="Workflow Builder" hint="Automatic replies in channels you belong to. Use {user} to mention whoever triggered the workflow.">
      <ul className="mb-3 divide-y divide-tm-line text-sm">
        {list.map((w) => (
          <li key={w.id} className="flex items-center gap-3 py-2">
            <input type="checkbox" checked={w.enabled} onChange={() => toggle(w)} title="Enabled" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{w.name}</span> <span className="text-zinc-400">in #{channels[w.channel_id]?.name}</span>
              <span className="text-zinc-500"> · {w.trigger === "keyword" ? `when someone says “${w.keyword}”` : "when someone joins"} → </span>
              <span className="text-zinc-600">{w.reply}</span>
            </span>
            <button className={remove} onClick={() => del(w)}>
              Delete
            </button>
          </li>
        ))}
        {!list.length && <li className="py-2 text-zinc-400">No workflows yet</li>}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
        <select className={select} value={f.channel_id || rooms[0]?.id} onChange={(e) => setF({ ...f, channel_id: e.target.value })}>
          {rooms.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
        <input className={input} placeholder="Workflow name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="flex gap-2">
          <select className={select} value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>
            <option value="member_joined">Member joins</option>
            <option value="keyword">Keyword</option>
          </select>
          {f.trigger === "keyword" && <input className={input} placeholder="keyword" value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} />}
        </div>
        <input className={`${input} sm:col-span-2`} placeholder="Reply, e.g. Welcome {user}! Read the canvas to get started." value={f.reply} onChange={(e) => setF({ ...f, reply: e.target.value })} />
        <button className={btn} onClick={add} disabled={!rooms.length || !f.name.trim() || !f.reply.trim() || (f.trigger === "keyword" && !f.keyword.trim())}>
          Add workflow
        </button>
      </div>
    </Card>
  );
}

function Dlp({ notify }: { notify: (s: string) => void }) {
  const [rules, setRules] = useState<DlpRule[]>([]);
  const [f, setF] = useState({ name: "", pattern: "", action: "block" });
  const load = () => supabase.from("dlp_rules").select("*").order("created_at").then(({ data }) => setRules(data ?? []));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const { error } = await supabase.from("dlp_rules").insert(f);
    notify(error ? error.message : `DLP rule “${f.name}” added`);
    if (!error) setF({ name: "", pattern: "", action: "block" });
    load();
  };

  return (
    <Card title="Data loss prevention" hint="Messages matching a pattern (case-insensitive regex) are blocked or have the match redacted.">
      <ul className="mb-3 divide-y divide-tm-line text-sm">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2">
            <input type="checkbox" checked={r.enabled} onChange={async () => (await supabase.from("dlp_rules").update({ enabled: !r.enabled }).eq("id", r.id), load())} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{r.name}</span> <code className="text-xs text-zinc-500">{r.pattern}</code>
            </span>
            <span className="text-xs text-zinc-500 capitalize">{r.action}</span>
            <button className={remove} onClick={async () => (await supabase.from("dlp_rules").delete().eq("id", r.id), load())}>
              Delete
            </button>
          </li>
        ))}
        {!rules.length && <li className="py-2 text-zinc-400">No rules</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input className={`${input} w-32 flex-1`} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={`${input} w-40 flex-1 font-mono`} placeholder="\b\d{4}([ -]?\d{4}){3}\b" value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })} />
        <select className={select} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="block">Block</option>
          <option value="redact">Redact</option>
        </select>
        <button className={btn} onClick={add} disabled={!f.name.trim() || !f.pattern.trim()}>
          Add
        </button>
      </div>
    </Card>
  );
}

function Events({ notify }: { notify: (s: string) => void }) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.posted"]);
  const [shown, setShown] = useState<string | null>(null);
  const load = () => supabase.from("event_subscriptions").select("*").order("created_at").then(({ data }) => setSubs(data ?? []));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const { error } = await supabase.from("event_subscriptions").insert({ url: url.trim(), events });
    notify(error ? error.message : "Event subscription added");
    if (!error) setUrl("");
    load();
  };

  return (
    <Card title="Events API" hint="Events are POSTed as JSON to your HTTPS endpoint, signed with X-TM-Signature (hex HMAC-SHA256 of the body). Requires pg_net.">
      <ul className="mb-3 divide-y divide-tm-line text-sm">
        {subs.map((s) => (
          <li key={s.id} className="py-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={s.enabled} onChange={async () => (await supabase.from("event_subscriptions").update({ enabled: !s.enabled }).eq("id", s.id), load())} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.url}</span>
              <button className="text-xs text-tm-blue hover:underline" onClick={() => setShown(shown === s.id ? null : s.id)}>
                Secret
              </button>
              <button className={remove} onClick={async () => (await supabase.from("event_subscriptions").delete().eq("id", s.id), load())}>
                Delete
              </button>
            </div>
            <div className="mt-0.5 pl-6 text-xs text-zinc-400">{s.events.join(", ")}</div>
            {shown === s.id && <code className="mt-1 block pl-6 text-xs break-all text-zinc-600">{s.secret}</code>}
          </li>
        ))}
        {!subs.length && <li className="py-2 text-zinc-400">No subscriptions</li>}
      </ul>
      <input className={input} placeholder="https://example.com/events" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        {EVENTS.map((e) => (
          <label key={e} className="flex items-center gap-1">
            <input type="checkbox" checked={events.includes(e)} onChange={() => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e])} />
            {e}
          </label>
        ))}
        <button className={`${btn} ml-auto`} onClick={add} disabled={!/^https:\/\//.test(url.trim()) || !events.length}>
          Subscribe
        </button>
      </div>
    </Card>
  );
}

function AuditLog() {
  const { profiles } = useChat();
  const [rows, setRows] = useState<Audit[]>([]);
  const [filter, setFilter] = useState("");
  const [before, setBefore] = useState<string | null>(null);

  useEffect(() => {
    let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(50);
    if (filter) q = q.like("action", `${filter}%`);
    if (before) q = q.lt("created_at", before);
    q.then(({ data }) => setRows((r) => (before ? [...r, ...(data ?? [])] : (data ?? []))));
  }, [filter, before]);

  const download = () => {
    const blob = new Blob([rows.map((r) => JSON.stringify(r)).join("\n")], { type: "application/x-ndjson" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "audit-log.jsonl" });
    a.click();
  };

  return (
    <Card title="Audit log" hint="Channel, membership, role, settings, integration and message-deletion changes.">
      <div className="mb-2 flex gap-2">
        <select className={select} value={filter} onChange={(e) => (setBefore(null), setFilter(e.target.value))}>
          <option value="">All actions</option>
          {["channel", "member", "role", "message", "settings", "workflows", "dlp_rules", "event_subscriptions", "channel_webhooks"].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button className={btnGhost} onClick={download} disabled={!rows.length}>
          Export
        </button>
      </div>
      <ul className="divide-y divide-tm-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-3 py-1.5">
            <span className="w-28 shrink-0 text-xs text-zinc-400">
              {dayLabel(r.created_at)} {timeOf(r.created_at)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.actor ? displayName(profiles[r.actor]) : "System"}</span> <code className="text-xs text-tm-blue">{r.action}</code>{" "}
              <span className="text-zinc-500">{r.target}</span>{" "}
              {Object.keys(r.details).length > 0 && <span className="text-xs text-zinc-400">{JSON.stringify(r.details)}</span>}
            </span>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-zinc-400">Nothing logged yet</li>}
      </ul>
      {rows.length >= 50 && (
        <button className="mt-2 text-xs text-tm-blue hover:underline" onClick={() => setBefore(rows[rows.length - 1].created_at)}>
          Load older
        </button>
      )}
    </Card>
  );
}
