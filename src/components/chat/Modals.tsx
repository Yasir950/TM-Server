"use client";

import { useEffect, useState } from "react";
import { supabase, displayName, type Channel, type Membership, type Message, type Webhook } from "@/lib/supabase";
import { timeOf, fileSize } from "@/lib/format";
import { Avatar, Modal, RowSkeleton, StatusBadge, Tabs, btn, btnGhost, input } from "../ui";
import { useChat } from "./store";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_\s-]/g, "");

export function CreateChannel({ onClose }: { onClose: () => void }) {
  const { reload, setActive } = useChat();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [priv, setPriv] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("create_channel", { p_name: name, p_kind: priv ? "private" : "public", p_topic: topic });
    if (error) return setError(error.message.includes("channels_name_key") ? "That name is already taken." : error.message);
    await reload();
    setActive(data);
    onClose();
  }

  return (
    <Modal title="Create a channel" onClose={onClose}>
      <form onSubmit={create} className="space-y-4">
        <label className="block text-sm font-medium">
          Name
          <div className="relative mt-1.5">
            <span className="absolute top-2.5 left-3.5 text-zinc-400">#</span>
            <input className={`${input} pl-7`} value={name} maxLength={80} onChange={(e) => setName(slug(e.target.value))} placeholder="e.g. plan-budget" autoFocus required />
          </div>
        </label>
        <label className="block text-sm font-medium">
          Topic <span className="font-normal text-zinc-400">(optional)</span>
          <input className={`${input} mt-1.5`} value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-tm-surface p-3 text-sm">
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="accent-tm-blue" />
          <span>
            <span className="font-medium">Make private</span>
            <span className="block text-xs text-zinc-500">Only invited people can view and join</span>
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end">
          <button className={btn}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

export function BrowseChannels({ onClose }: { onClose: () => void }) {
  const { memberships, setActive, reload, me } = useChat();
  const [all, setAll] = useState<(Channel & { channel_members: { count: number }[] })[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("channels")
      .select("*, channel_members(count)")
      .neq("kind", "dm")
      .eq("archived", false)
      .eq("company_id", me.current_company_id)
      .order("name")
      .then(({ data }) => setAll((data as typeof all) ?? []));
  }, [me.current_company_id]);

  async function open(c: Channel) {
    if (!memberships[c.id]) {
      await supabase.from("channel_members").insert({ channel_id: c.id, user_id: me.id });
      await reload();
    }
    setActive(c.id);
    onClose();
  }

  const shown = all.filter((c) => c.name?.includes(q.toLowerCase()));
  return (
    <Modal title="Browse channels" onClose={onClose}>
      <input className={input} placeholder="Search for channels" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-tm-surface">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                <span className="text-zinc-400">{c.kind === "private" ? "🔒" : "#"}</span> {c.name}
              </div>
              <div className="truncate text-xs text-zinc-500">
                {c.channel_members[0]?.count ?? 0} members{c.topic && ` · ${c.topic}`}
              </div>
            </div>
            <button className={memberships[c.id] ? btnGhost : btn} onClick={() => open(c)}>
              {memberships[c.id] ? "Open" : "Join"}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="py-6 text-center text-sm text-zinc-500">No channels found.</li>}
      </ul>
    </Modal>
  );
}

export function PeoplePicker({ exclude, picked, setPicked }: { exclude: string[]; picked: string[]; setPicked: (ids: string[]) => void }) {
  const { profiles, online, away } = useChat();
  const [q, setQ] = useState("");
  const people = Object.values(profiles).filter((p) => !exclude.includes(p.id) && (displayName(p) + p.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {picked.map((id) => (
            <button key={id} onClick={() => setPicked(picked.filter((x) => x !== id))} className="tm-pop rounded-lg bg-tm-blue-light px-2 py-0.5 text-sm text-tm-blue-dark">
              {displayName(profiles[id])} ✕
            </button>
          ))}
        </div>
      )}
      <input className={input} placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id])}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-tm-surface ${picked.includes(p.id) ? "bg-tm-blue-light" : ""}`}
            >
              <Avatar profile={p} size={28} online={online.has(p.id)} away={away.has(p.id)} />
              <span className="font-medium">{displayName(p)}</span>
              <span className="text-sm text-zinc-400">@{p.username}</span>
              <StatusBadge profile={p} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function NewDM({ onClose }: { onClose: () => void }) {
  const { reload, setActive } = useChat();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function start() {
    const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: picked });
    if (error) return setError(error.message);
    await reload();
    setActive(data);
    onClose();
  }

  return (
    <Modal title="New message" onClose={onClose}>
      <PeoplePicker exclude={[]} picked={picked} setPicked={setPicked} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end">
        <button className={btn} disabled={picked.length === 0} onClick={start}>
          Go to conversation
        </button>
      </div>
    </Modal>
  );
}

type Tab = "about" | "members" | "pinned" | "files" | "integrations";

export function ChannelDetails({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { me, profiles, online, away, memberships, reload, setActive, updateMembership, channelTitle } = useChat();
  const [tab, setTab] = useState<Tab>("about");
  const [members, setMembers] = useState<string[]>([]);
  const [topic, setTopic] = useState(channel.topic);
  const [name, setName] = useState(channel.name ?? "");
  const [adding, setAdding] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const mem = memberships[channel.id];
  const isDM = channel.kind === "dm";

  useEffect(() => {
    supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channel.id)
      .then(({ data }) => setMembers((data ?? []).map((r) => r.user_id)));
  }, [channel.id]);

  async function saveAbout() {
    setError("");
    const patch: Partial<Channel> = {};
    if (topic !== channel.topic) patch.topic = topic;
    if (!isDM && slug(name).replace(/\s+/g, "-") !== channel.name) patch.name = slug(name).trim().replace(/\s+/g, "-");
    if (!Object.keys(patch).length) return;
    const { error } = await supabase.from("channels").update(patch).eq("id", channel.id);
    if (error) setError(error.message.includes("channels_name_key") ? "That name is already taken." : error.message);
  }
  async function addPeople() {
    if (adding?.length) {
      await supabase.from("channel_members").insert(adding.map((user_id) => ({ channel_id: channel.id, user_id })));
      setMembers([...members, ...adding]);
    }
    setAdding(null);
  }
  async function leave() {
    await supabase.from("channel_members").delete().match({ channel_id: channel.id, user_id: me.id });
    setActive(null);
    await reload();
    onClose();
  }
  async function archive() {
    if (!confirm(`Archive #${channel.name}? Its history stays readable but nobody can post.`)) return;
    await supabase.from("channels").update({ archived: !channel.archived }).eq("id", channel.id);
    onClose();
  }
  async function convert() {
    const n = prompt("Name for the new private channel:");
    if (!n) return;
    const { error } = await supabase.rpc("convert_dm_to_channel", { p_id: channel.id, p_name: slug(n) });
    if (error) return setError(error.message.includes("channels_name_key") ? "That name is already taken." : error.message);
    await reload();
    onClose();
  }

  if (adding)
    return (
      <Modal title={`Add people to #${channel.name}`} onClose={() => setAdding(null)}>
        <PeoplePicker exclude={members} picked={adding} setPicked={setAdding} />
        <div className="mt-4 flex justify-end">
          <button className={btn} disabled={!adding.length} onClick={addPeople}>
            Add
          </button>
        </div>
      </Modal>
    );

  const tabs: [Tab, string][] = [
    ["about", "About"],
    ["members", `Members ${members.length || ""}`],
    ["pinned", "Pinned"],
    ["files", "Files"],
  ];
  if (!isDM) tabs.push(["integrations", "Integrations"]);

  return (
    <Modal wide title={isDM ? channelTitle(channel) : `${channel.kind === "private" ? "🔒" : "#"} ${channel.name}`} onClose={onClose}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="tm-fade min-h-64" key={tab}>
        {tab === "about" && (
          <div className="space-y-4">
            {!isDM && (
              <label className="block text-sm font-medium">
                Channel name
                <input className={`${input} mt-1.5`} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveAbout} />
              </label>
            )}
            {!isDM && (
              <label className="block text-sm font-medium">
                Topic
                <input className={`${input} mt-1.5`} value={topic} onChange={(e) => setTopic(e.target.value)} onBlur={saveAbout} placeholder="Add a topic" />
              </label>
            )}
            <div>
              <div className="mb-1.5 text-sm font-medium">Notifications</div>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-tm-surface p-1 text-sm">
                {(["default", "all", "mentions", "nothing"] as Membership["notify"][]).map((n) => (
                  <button
                    key={n}
                    onClick={() => updateMembership(channel.id, { notify: n })}
                    className={`rounded-lg py-1.5 capitalize transition ${mem?.notify === n ? "tm-raised bg-white text-tm-blue" : "text-zinc-500 hover:text-zinc-800"}`}
                  >
                    {n === "default" ? "Default" : n === "all" ? "All" : n === "mentions" ? "Mentions" : "Off"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-400">Default: every message in DMs, only mentions in channels.</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-2 pt-2">
              <button className={btnGhost} onClick={() => updateMembership(channel.id, { starred: !mem?.starred })}>
                {mem?.starred ? "★ Unstar" : "☆ Star"}
              </button>
              <button className={btnGhost} onClick={() => updateMembership(channel.id, { muted: !mem?.muted })}>
                {mem?.muted ? "🔔 Unmute" : "🔕 Mute"}
              </button>
              {isDM && members.length > 2 && (
                <button className={btnGhost} onClick={convert}>
                  Convert to private channel
                </button>
              )}
              {!isDM && (
                <>
                  <button className={btnGhost} onClick={archive}>
                    {channel.archived ? "Unarchive" : "🗄️ Archive"}
                  </button>
                  <button className={`${btnGhost} text-red-600`} onClick={leave}>
                    Leave channel
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "members" && (
          <>
            {channel.kind === "private" && (
              <button className="mb-2 text-sm font-medium text-tm-blue hover:underline" onClick={() => setAdding([])}>
                + Add people
              </button>
            )}
            <ul className="max-h-80 space-y-0.5 overflow-y-auto">
              {members.map((id) => (
                <li key={id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
                  <Avatar profile={profiles[id]} size={30} online={online.has(id)} away={away.has(id)} />
                  <span className="font-medium">{displayName(profiles[id])}</span>
                  {id === me.id && <span className="text-sm text-zinc-400">(you)</span>}
                  <StatusBadge profile={profiles[id]} withText />
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "pinned" && <PinnedList channelId={channel.id} />}
        {tab === "files" && <FilesList channelId={channel.id} />}
        {tab === "integrations" && <Webhooks channelId={channel.id} />}
      </div>
    </Modal>
  );
}

function PinnedList({ channelId }: { channelId: string }) {
  const { profiles, setActive } = useChat();
  const [pins, setPins] = useState<Message[] | null>(null);
  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .not("pinned_at", "is", null)
      .is("deleted_at", null)
      .order("pinned_at", { ascending: false })
      .then(({ data }) => setPins((data as Message[]) ?? []));
  }, [channelId]);
  if (!pins) return <RowSkeleton count={3} size={0} />;
  if (!pins.length) return <Empty icon="📌" text="No pinned messages yet. Use ⋯ → Pin on any message." />;
  return (
    <ul className="max-h-80 space-y-2 overflow-y-auto">
      {pins.map((m) => (
        <li key={m.id}>
          <button onClick={() => setActive(channelId, m.id)} className="w-full rounded-xl bg-tm-surface p-3 text-left transition hover:bg-tm-blue-light/60">
            <div className="text-xs text-zinc-400">
              {m.bot_name ?? displayName(profiles[m.user_id])} · {timeOf(m.created_at)}
            </div>
            <div className="line-clamp-2 text-sm">{m.body || "📎 Attachment"}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FilesList({ channelId }: { channelId: string }) {
  const { profiles, setActive } = useChat();
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .neq("attachments", "[]")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setMsgs((data as Message[]) ?? []));
  }, [channelId]);
  if (!msgs) return <RowSkeleton count={4} size={36} />;
  const files = msgs.flatMap((m) => m.attachments.map((a) => ({ a, m })));
  if (!files.length) return <Empty icon="📁" text="No files shared here yet." />;
  return (
    <ul className="max-h-80 space-y-1 overflow-y-auto">
      {files.map(({ a, m }) => (
        <li key={a.path}>
          <button onClick={() => setActive(channelId, m.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-tm-surface">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-tm-blue-light text-[10px] font-bold text-tm-blue uppercase">{a.name.split(".").pop()?.slice(0, 4)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.name}</span>
              <span className="text-xs text-zinc-400">
                {fileSize(a.size)} · {displayName(profiles[m.user_id])}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Webhooks({ channelId }: { channelId: string }) {
  const { profiles } = useChat();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("channel_webhooks")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at")
      .then(({ data }) => setHooks((data as Webhook[]) ?? []));
  }, [channelId]);

  const url = (h: Webhook) => `${location.origin}/api/webhooks/${h.token}`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { data } = await supabase.from("channel_webhooks").insert({ channel_id: channelId, name: name.trim() }).select().single();
    if (data) setHooks([...hooks, data as Webhook]);
    setName("");
  }
  async function remove(id: string) {
    if (!confirm("Delete this webhook? Anything using its URL will stop posting.")) return;
    await supabase.from("channel_webhooks").delete().eq("id", id);
    setHooks(hooks.filter((h) => h.id !== id));
  }
  function copy(h: Webhook) {
    navigator.clipboard.writeText(url(h));
    setCopied(h.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Incoming webhooks let other systems post into this channel. Send a POST with JSON <code className="tm-code">{`{"text": "Hello"}`}</code> to the URL. Add
        <code className="tm-code">username</code> to override the sender name.
      </p>
      <form onSubmit={add} className="flex gap-2">
        <input className={input} placeholder="Webhook name, e.g. Deploy bot" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className={btn}>Add</button>
      </form>
      <ul className="space-y-2">
        {hooks.map((h) => (
          <li key={h.id} className="tm-fade rounded-xl border border-tm-line p-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <span className="font-medium">{h.name}</span>
              <span className="text-xs text-zinc-400">by {displayName(profiles[h.created_by])}</span>
              <button onClick={() => remove(h.id)} className="ml-auto rounded-lg px-2 py-0.5 text-xs text-red-600 transition hover:bg-red-50">
                Delete
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-tm-surface px-2 py-1.5 font-mono text-xs text-zinc-600">{url(h)}</code>
              <button onClick={() => copy(h)} className="rounded-lg bg-tm-blue-light px-2.5 py-1.5 text-xs font-medium text-tm-blue transition hover:bg-tm-blue/15">
                {copied === h.id ? "Copied ✓" : "Copy URL"}
              </button>
            </div>
            <details className="mt-2 text-xs text-zinc-500">
              <summary className="cursor-pointer select-none">Example</summary>
              <pre className="tm-pre mt-1">{`curl -X POST ${url(h)} \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "Build passed ✅"}'`}</pre>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-zinc-400">
    <span className="text-3xl opacity-60">{icon}</span>
    {text}
  </div>
);
