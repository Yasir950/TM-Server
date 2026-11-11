import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from "react-native";
import { supabase, displayName, fmtBytes, WEB_URL, type Plan, type Profile } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { dayLabel, timeOf } from "@/lib/format";
import Choice from "@/components/Choice";
import { Avatar, Button, C, GhostButton, Label, field } from "@/components/ui";

// Port of the Admin view: Admin.tsx, Plan.tsx and AdminPlatform.tsx in src/components/chat
type Stats = { members: number; channels: number; messages_7d: number; active_7d: number; daily: { day: string; count: number }[]; top_channels: { name: string; count: number }[] };
type Usage = { members: number; storage_bytes: number; webhooks: number; workflows: number };
type Workflow = { id: string; channel_id: string; name: string; trigger: "member_joined" | "keyword"; keyword: string | null; reply: string; enabled: boolean };
type DlpRule = { id: string; name: string; pattern: string; action: "block" | "redact"; enabled: boolean };
type Sub = { id: string; url: string; events: string[]; secret: string; enabled: boolean };
type Audit = { id: number; actor: string | null; action: string; target: string | null; details: Record<string, unknown>; created_at: string };

const PRO_PRICE = 100;
const FEATURES: [keyof Plan, string][] = [
  ["guests", "Guest accounts"],
  ["ai_summaries", "AI summaries"],
  ["events_api", "Events API"],
  ["dlp", "Data loss prevention"],
  ["audit_log", "Audit log"],
  ["custom_retention", "Custom message retention"],
];
const EVENTS = ["message.posted", "channel.created", "member.joined"];

const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, gap: 10 }}>
    <Text style={{ fontWeight: "800", color: C.muted }}>{title}</Text>
    {hint && <Text style={{ color: C.muted, fontSize: 12 }}>{hint}</Text>}
    {children}
  </View>
);
const Locked = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: "#ccc", borderRadius: 14, padding: 14, gap: 4 }}>
    <Text style={{ fontWeight: "800", color: C.muted }}>
      {title} <Text style={{ color: C.blue, fontSize: 11 }}>PRO</Text>
    </Text>
    <Text style={{ color: C.muted }}>{children}</Text>
  </View>
);

export default function Admin() {
  const { plan } = useChat();
  const [notice, setNotice] = useState("");
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      {!!notice && (
        <Text onPress={() => setNotice("")} style={{ backgroundColor: "#e8f5fa", color: "#0b4c8c", padding: 10, borderRadius: 8, overflow: "hidden" }}>
          {notice}
        </Text>
      )}
      <PlanCard notify={setNotice} />
      <Analytics />
      <Members notify={setNotice} />
      <Retention notify={setNotice} />
      <Workflows notify={setNotice} />
      {plan?.dlp ? <Dlp notify={setNotice} /> : <Locked title="Data loss prevention">Block or redact sensitive content like card numbers before it's posted.</Locked>}
      {plan?.events_api ? <Events notify={setNotice} /> : <Locked title="Events API">Send signed callbacks to your own systems when messages are posted, channels are created or people join.</Locked>}
      {plan?.audit_log ? <AuditLog /> : <Locked title="Audit log">See who changed channels, members, roles, settings and integrations, and export the record.</Locked>}
    </ScrollView>
  );
}

function Meter({ label, used, limit, fmt = (n: number) => n.toLocaleString() }: { label: string; used: number; limit: number | null; fmt?: (n: number) => string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13 }}>
        {label}: <Text style={{ fontWeight: "700" }}>{fmt(used)}</Text> / {limit === null ? "unlimited" : fmt(limit)}
      </Text>
      <View style={{ height: 6, backgroundColor: "#eee", borderRadius: 3 }}>
        <View style={{ height: 6, width: `${pct}%`, backgroundColor: pct > 90 ? C.red : C.blue, borderRadius: 3 }} />
      </View>
    </View>
  );
}

function PlanCard({ notify }: { notify: (s: string) => void }) {
  const { company, plan, reload } = useChat();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.rpc("company_usage").then(({ data }) => setUsage(data as Usage));
  }, []);
  if (!company || !plan) return null;
  const next = plan.id === "free" ? "pro" : plan.id === "pro" ? "enterprise" : null;

  const request = async () => {
    setBusy(true);
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(`${WEB_URL}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ kind: "upgrade", plan: next, message: note }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return notify(out.error ?? "The request could not be sent");
    setAsking(false);
    setNote("");
    notify(next === "pro" ? "Upgrade requested. We'll confirm by email and switch your company to Pro." : "Thanks! Our team will contact you about Enterprise.");
    reload();
  };

  return (
    <Card title="Plan">
      <Text style={{ fontSize: 22, fontWeight: "800" }}>
        {plan.name} <Text style={{ fontSize: 14, color: C.muted, fontWeight: "400" }}>{plan.price_cents === null ? "custom pricing" : plan.price_cents === 0 ? "free" : `$${plan.price_cents / 100} / month`}</Text>
      </Text>
      {company.upgrade_requested_at && <Text style={{ color: C.blue, fontSize: 12 }}>Upgrade requested {new Date(company.upgrade_requested_at).toLocaleDateString()}. We'll be in touch by email.</Text>}
      {next && !asking && <Button title={next === "pro" ? `Upgrade to Pro · $${PRO_PRICE}/month` : "Talk to us about Enterprise"} onPress={() => setAsking(true)} />}
      <GhostButton title="Compare plans" onPress={() => Linking.openURL(`${WEB_URL}/pricing`)} />
      {asking && (
        <View style={{ backgroundColor: "#f6f6f6", borderRadius: 10, padding: 12, gap: 8 }}>
          <Text style={{ color: "#555" }}>
            {next === "pro"
              ? `Pro is $${PRO_PRICE} a month for ${company.name}: up to 250 members, unlimited history, 25 GB storage, group calls, AI summaries and every admin tool.`
              : "Tell us what you need and we'll reach out about custom limits and pricing."}
          </Text>
          <TextInput style={[field, { minHeight: 70, textAlignVertical: "top" }]} multiline maxLength={2000} placeholder="Anything we should know? (optional)" value={note} onChangeText={setNote} />
          <Button title={busy ? "Sending…" : "Send request"} disabled={busy} onPress={request} />
          <GhostButton title="Cancel" onPress={() => setAsking(false)} />
        </View>
      )}
      <Meter label="Members" used={usage?.members ?? 0} limit={plan.max_members} />
      <Meter label="File storage" used={usage?.storage_bytes ?? 0} limit={plan.storage_bytes} fmt={fmtBytes} />
      <Meter label="Webhooks" used={usage?.webhooks ?? 0} limit={plan.max_webhooks} />
      <Meter label="Workflows" used={usage?.workflows ?? 0} limit={plan.max_workflows} />
      <Text style={{ color: "#555" }}>
        History: {plan.history_days ? `${plan.history_days} days` : "unlimited"} · Calls: {plan.max_call_participants === 2 ? "1:1" : `up to ${plan.max_call_participants ?? "∞"} people`} · Largest file:{" "}
        {plan.max_file_bytes ? fmtBytes(plan.max_file_bytes) : "no limit"}
      </Text>
      {FEATURES.map(([k, label]) => (
        <Text key={k} style={plan[k] ? { color: C.text } : { color: "#aaa", textDecorationLine: "line-through" }}>
          {plan[k] ? "✓ " : ""}
          {label}
        </Text>
      ))}
    </Card>
  );
}

function Analytics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    supabase.rpc("admin_stats").then(({ data }) => setStats(data as Stats));
  }, []);
  // Last 14 days, including days with no messages
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, count: stats?.daily.find((x) => x.day === d)?.count ?? 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.count));
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(
          [
            ["Members", stats?.members],
            ["Channels", stats?.channels],
            ["Messages · 7 days", stats?.messages_7d],
            ["Active · 7 days", stats?.active_7d],
          ] as const
        ).map(([label, v]) => (
          <View key={label} style={{ width: "48%", borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
            <Text style={{ fontSize: 22, fontWeight: "800" }}>{v ?? "–"}</Text>
          </View>
        ))}
      </View>
      <Card title="Messages per day · last 14 days">
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 100, gap: 3 }}>
          {days.map((d) => (
            <View key={d.day} style={{ flex: 1, height: `${(d.count / peak) * 100}%`, minHeight: d.count ? 2 : 0, backgroundColor: C.blue, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: C.muted, fontSize: 11 }}>{days[0].day.slice(5)}</Text>
          <Text style={{ color: C.muted, fontSize: 11 }}>today</Text>
        </View>
      </Card>
      <Card title="Busiest channels · 30 days">
        {stats?.top_channels.length === 0 && <Text style={{ color: C.muted }}>No channel activity yet</Text>}
        {stats?.top_channels.map((c) => (
          <View key={c.name} style={{ flexDirection: "row" }}>
            <Text style={{ flex: 1 }}>#{c.name}</Text>
            <Text style={{ color: C.muted }}>{c.count}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function Members({ notify }: { notify: (s: string) => void }) {
  const { me, profiles, reload } = useChat();
  const setRole = async (p: Profile, role: string) => {
    const { error } = await supabase.rpc("set_member_role", { p_user: p.id, p_role: role });
    notify(error ? error.message : `${displayName(p)} is now ${role === "admin" ? "an admin" : "a member"}`);
    if (!error) reload();
  };
  return (
    <Card title="Members">
      {Object.values(profiles)
        .sort((a, b) => displayName(a).localeCompare(displayName(b)))
        .map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar p={p} size={28} />
            <Text style={{ flex: 1 }} numberOfLines={1}>
              <Text style={{ fontWeight: "700" }}>{displayName(p)}</Text> <Text style={{ color: C.muted }}>@{p.username}</Text>
            </Text>
            {p.role === "owner" || p.id === me.id ? (
              <Text style={{ color: C.muted, textTransform: "capitalize" }}>{p.role}</Text>
            ) : (
              <Choice
                compact
                value={p.role}
                options={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                  { value: "guest", label: "Guest" },
                ]}
                onChange={(r) => setRole(p, r)}
              />
            )}
          </View>
        ))}
    </Card>
  );
}

function Retention({ notify }: { notify: (s: string) => void }) {
  const { company, plan, reload } = useChat();
  const [retention, setRetention] = useState(company?.retention_days?.toString() ?? "");
  if (!plan?.custom_retention)
    return (
      <Locked title="Message retention">
        Choose how long messages are kept. On the {plan?.name ?? "Free"} plan, messages older than {plan?.history_days ?? 90} days are hidden{plan?.purge_days ? ` and deleted after ${plan.purge_days} days` : ""}.
      </Locked>
    );
  const save = async () => {
    const days = retention.trim() ? Math.max(1, Math.floor(Number(retention))) : null;
    if (!company) return;
    const { error } = await supabase.from("companies").update({ retention_days: days }).eq("id", company.id);
    notify(error ? error.message : days ? `Messages older than ${days} days will be deleted daily (pinned messages are kept)` : "Messages are kept forever");
    if (!error) reload();
  };
  const run = async () => {
    const { data, error } = await supabase.rpc("apply_retention");
    notify(error ? error.message : `${data} messages deleted`);
  };
  return (
    <Card title="Message retention" hint="Leave empty to keep messages forever. Pinned messages are never deleted.">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text>Delete messages older than</Text>
        <TextInput style={[field, { width: 70 }]} keyboardType="number-pad" placeholder="∞" value={retention} onChangeText={setRetention} />
        <Text>days</Text>
      </View>
      <Button title="Save" onPress={save} />
      {!!retention.trim() && <GhostButton title="Run now" onPress={run} />}
    </Card>
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
  return (
    <Card title="Workflow Builder" hint="Automatic replies in channels you belong to. Use {user} to mention whoever triggered the workflow.">
      {list.map((w) => (
        <View key={w.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch value={w.enabled} onValueChange={async () => (await supabase.from("workflows").update({ enabled: !w.enabled }).eq("id", w.id), load())} />
          <Text style={{ flex: 1, fontSize: 13 }}>
            <Text style={{ fontWeight: "700" }}>{w.name}</Text> in #{channels[w.channel_id]?.name} · {w.trigger === "keyword" ? `when someone says “${w.keyword}”` : "when someone joins"} → {w.reply}
          </Text>
          <Text style={{ color: C.red }} onPress={async () => (await supabase.from("workflows").delete().eq("id", w.id), load())}>
            Delete
          </Text>
        </View>
      ))}
      {!list.length && <Text style={{ color: C.muted }}>No workflows yet</Text>}
      <Choice value={f.channel_id || rooms[0]?.id || ""} options={rooms.map((c) => ({ value: c.id, label: `#${c.name}` }))} onChange={(channel_id) => setF({ ...f, channel_id })} placeholder="Channel" />
      <TextInput style={field} placeholder="Workflow name" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
      <Choice
        value={f.trigger}
        options={[
          { value: "member_joined", label: "Member joins" },
          { value: "keyword", label: "Keyword" },
        ]}
        onChange={(trigger) => setF({ ...f, trigger })}
      />
      {f.trigger === "keyword" && <TextInput style={field} placeholder="keyword" value={f.keyword} onChangeText={(keyword) => setF({ ...f, keyword })} />}
      <TextInput style={field} placeholder="Reply, e.g. Welcome {user}!" value={f.reply} onChangeText={(reply) => setF({ ...f, reply })} />
      <Button title="Add workflow" disabled={!rooms.length || !f.name.trim() || !f.reply.trim() || (f.trigger === "keyword" && !f.keyword.trim())} onPress={add} />
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
      {rules.map((r) => (
        <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch value={r.enabled} onValueChange={async () => (await supabase.from("dlp_rules").update({ enabled: !r.enabled }).eq("id", r.id), load())} />
          <Text style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700" }}>{r.name}</Text> <Text style={{ fontFamily: "monospace", fontSize: 12, color: C.muted }}>{r.pattern}</Text>
          </Text>
          <Text style={{ color: C.muted, textTransform: "capitalize" }}>{r.action}</Text>
          <Text style={{ color: C.red }} onPress={async () => (await supabase.from("dlp_rules").delete().eq("id", r.id), load())}>
            ✕
          </Text>
        </View>
      ))}
      {!rules.length && <Text style={{ color: C.muted }}>No rules</Text>}
      <TextInput style={field} placeholder="Name" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
      <TextInput style={[field, { fontFamily: "monospace" }]} autoCapitalize="none" placeholder="\b\d{4}([ -]?\d{4}){3}\b" value={f.pattern} onChangeText={(pattern) => setF({ ...f, pattern })} />
      <Choice
        value={f.action}
        options={[
          { value: "block", label: "Block" },
          { value: "redact", label: "Redact" },
        ]}
        onChange={(action) => setF({ ...f, action })}
      />
      <Button title="Add rule" disabled={!f.name.trim() || !f.pattern.trim()} onPress={add} />
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
    <Card title="Events API" hint="Events are POSTed as JSON to your HTTPS endpoint, signed with X-TM-Signature (hex HMAC-SHA256 of the body).">
      {subs.map((s) => (
        <View key={s.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch value={s.enabled} onValueChange={async () => (await supabase.from("event_subscriptions").update({ enabled: !s.enabled }).eq("id", s.id), load())} />
            <Text style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }} numberOfLines={1}>
              {s.url}
            </Text>
            <Text style={{ color: C.blue }} onPress={() => setShown(shown === s.id ? null : s.id)}>
              Secret
            </Text>
            <Text style={{ color: C.red }} onPress={async () => (await supabase.from("event_subscriptions").delete().eq("id", s.id), load())}>
              ✕
            </Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 12 }}>{s.events.join(", ")}</Text>
          {shown === s.id && (
            <Text selectable style={{ fontFamily: "monospace", fontSize: 12 }}>
              {s.secret}
            </Text>
          )}
        </View>
      ))}
      {!subs.length && <Text style={{ color: C.muted }}>No subscriptions</Text>}
      <TextInput style={field} autoCapitalize="none" keyboardType="url" placeholder="https://example.com/events" value={url} onChangeText={setUrl} />
      {EVENTS.map((e) => (
        <Pressable key={e} onPress={() => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e])} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={{ color: events.includes(e) ? C.blue : "#ccc" }}>{events.includes(e) ? "☑" : "☐"}</Text>
          <Text>{e}</Text>
        </Pressable>
      ))}
      <Button title="Subscribe" disabled={!/^https:\/\//.test(url.trim()) || !events.length} onPress={add} />
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
  return (
    <Card title="Audit log" hint="Channel, membership, role, settings, integration and message-deletion changes.">
      <Choice
        value={filter}
        options={[{ value: "", label: "All actions" }, ...["channel", "member", "role", "message", "settings", "workflows", "dlp_rules", "event_subscriptions", "channel_webhooks"].map((a) => ({ value: a, label: a }))]}
        onChange={(v) => (setBefore(null), setFilter(v))}
      />
      <GhostButton title="Export (share as JSON lines)" onPress={() => Share.share({ message: rows.map((r) => JSON.stringify(r)).join("\n") })} />
      {rows.map((r) => (
        <View key={r.id}>
          <Text style={{ color: C.muted, fontSize: 11 }}>
            {dayLabel(r.created_at)} {timeOf(r.created_at)}
          </Text>
          <Text style={{ fontSize: 13 }}>
            <Text style={{ fontWeight: "700" }}>{r.actor ? displayName(profiles[r.actor]) : "System"}</Text> <Text style={{ fontFamily: "monospace", color: C.blue }}>{r.action}</Text>{" "}
            <Text style={{ color: C.muted }}>{r.target}</Text> {Object.keys(r.details).length > 0 && <Text style={{ color: "#999", fontSize: 11 }}>{JSON.stringify(r.details)}</Text>}
          </Text>
        </View>
      ))}
      {!rows.length && <Text style={{ color: C.muted }}>Nothing logged yet</Text>}
      {rows.length >= 50 && (
        <Text style={{ color: C.blue }} onPress={() => setBefore(rows[rows.length - 1].created_at)}>
          Load older
        </Text>
      )}
    </Card>
  );
}
