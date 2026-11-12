import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase, fmtBytes, type PlanId, type Profile, type Role } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import Choice from "@/components/Choice";
import { Avatar, C, GhostButton, Segmented, field } from "@/components/ui";
import { Icon, channelIcon } from "@/components/Icon";

// Port of SuperAdminView (src/components/chat/SuperAdmin.tsx): every company and user on the platform
type Stats = { companies: number; companies_30d: number; users: number; users_30d: number; channels: number; messages: number; messages_7d: number; active_7d: number; daily_companies: { day: string; count: number }[] };
type CompanyRow = { id: string; name: string; handle: string; created_at: string; owner_name: string | null; owner_email: string | null; members: number; channels: number; messages: number; messages_7d: number; last_activity: string | null; plan: PlanId; upgrade_requested_at: string | null; storage_bytes: number };
type ChannelRow = { id: string; name: string | null; kind: "public" | "private" | "dm"; archived: boolean; members: number; messages: number; last_activity: string | null; people: string | null };
type UserRow = { id: string; full_name: string; username: string; avatar_url: string | null; email: string; created_at: string; last_sign_in_at: string | null; super_admin: boolean; companies: { id: string; name: string; role: Role; status: "active" | "deactivated" }[] };
type Request = { id: string; kind: "sales" | "upgrade" | "general"; name: string; email: string; company: string; team_size: string; message: string; handled_at: string | null; created_at: string };

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
const num = (n: number | undefined) => (n ?? 0).toLocaleString();
const KIND_LABEL = { sales: "Enterprise", upgrade: "Upgrade", general: "Question" } as const;
const ask = (title: string, msg: string, go: () => void) =>
  Alert.alert(title, msg, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", style: "destructive", onPress: go },
  ]);

export default function SuperAdmin() {
  const [tab, setTab] = useState<"companies" | "users" | "requests">("companies");
  const [stats, setStats] = useState<Stats | null>(null);
  const [notice, setNotice] = useState("");
  const [now] = useState(() => Date.now());
  useEffect(() => {
    supabase.rpc("platform_stats").then(({ data, error }) => (error ? setNotice(error.message) : setStats(data as Stats)));
  }, []);
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, count: stats?.daily_companies.find((x) => x.day === d)?.count ?? 0 };
  });
  const peak = Math.max(1, ...days.map((d) => d.count));

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      {!!notice && (
        <Text onPress={() => setNotice("")} style={{ backgroundColor: "#e8f5fa", color: "#0b4c8c", padding: 10, borderRadius: 8, overflow: "hidden" }}>
          {notice}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(
          [
            ["Companies", stats?.companies, `+${num(stats?.companies_30d)} in 30 days`],
            ["Users", stats?.users, `+${num(stats?.users_30d)} in 30 days`],
            ["Messages · 7d", stats?.messages_7d, `${num(stats?.messages)} all time`],
            ["Active · 7d", stats?.active_7d, `${num(stats?.channels)} channels`],
          ] as const
        ).map(([label, v, sub]) => (
          <View key={label} style={{ width: "48%", borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
            <Text style={{ fontSize: 22, fontWeight: "800" }}>{num(v)}</Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>{sub}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: C.muted, fontWeight: "700" }}>New companies per day · last 30 days</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: 80, gap: 2 }}>
        {days.map((d) => (
          <View key={d.day} style={{ flex: 1, height: `${(d.count / peak) * 100}%`, minHeight: d.count ? 2 : 0, backgroundColor: C.blue }} />
        ))}
      </View>
      <Segmented
        tabs={[
          ["companies", "Companies"],
          ["users", "Users"],
          ["requests", "Requests"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "companies" ? <Companies notify={setNotice} /> : tab === "users" ? <Users notify={setNotice} /> : <Requests notify={setNotice} />}
    </ScrollView>
  );
}

function Companies({ notify }: { notify: (s: string) => void }) {
  const { company, switchCompany, reload } = useChat();
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [chans, setChans] = useState<ChannelRow[] | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(() => supabase.rpc("platform_companies").then(({ data, error }) => (error ? notify(error.message) : setRows(data ?? []))), [notify]);
  useEffect(() => {
    load();
  }, [load]);

  const expand = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setChans(null);
    const { data, error } = await supabase.rpc("platform_company_channels", { p_company: id });
    if (error) notify(error.message);
    setChans(data ?? []);
  };
  // Enters the company as its owner, optionally straight into one of its conversations
  const enter = async (companyId: string, channelId?: string) => {
    if (companyId !== company?.id) await switchCompany(companyId);
    router.dismissAll();
    if (channelId) router.push(`/c/${channelId}`);
  };
  const remove = async (c: CompanyRow) => {
    if (deleting?.text !== c.handle) return notify(`Type the handle "${c.handle}" to confirm.`);
    const { error } = await supabase.rpc("platform_delete_company", { p_company: c.id });
    notify(error ? error.message : `${c.name} deleted`);
    if (error) return;
    setDeleting(null);
    setOpen(null);
    await Promise.all([load(), reload()]);
  };
  const setPlan = (c: CompanyRow, plan: PlanId) =>
    ask(`Move ${c.name} to ${plan}?`, `Currently on ${c.plan}.`, async () => {
      const { error } = await supabase.rpc("set_company_plan", { p_company: c.id, p_plan: plan });
      notify(error ? error.message : `${c.name} is now on ${plan}`);
      if (!error) await Promise.all([load(), reload()]);
    });

  const shown = rows?.filter((c) => `${c.name} ${c.handle} ${c.owner_name ?? ""} ${c.owner_email ?? ""} ${c.plan}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <TextInput style={field} placeholder="Search name, handle or owner" value={q} onChangeText={setQ} />
      {shown && <Text style={{ color: C.muted }}>{shown.length} companies</Text>}
      {shown?.map((c) => (
        <View key={c.id} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 6 }}>
          <Pressable onPress={() => expand(c.id)}>
            <Text style={{ fontWeight: "800", fontSize: 16 }}>
              {open === c.id ? "▾" : "▸"} {c.name}
              {c.id === company?.id && <Text style={{ color: C.blue, fontSize: 12 }}> Viewing</Text>}
              {c.upgrade_requested_at && <Text style={{ color: "#a15c00", fontSize: 12 }}> Upgrade requested</Text>}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              @{c.handle} · owner {c.owner_name ?? "–"}
              {c.owner_email ? ` (${c.owner_email})` : ""} · created {fmtDate(c.created_at)}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {num(c.members)} members · {num(c.channels)} channels · {num(c.messages_7d)} msgs 7d · last {fmtDate(c.last_activity)} · {fmtBytes(c.storage_bytes)}
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Choice
                value={c.plan}
                options={[
                  { value: "free", label: "Free" },
                  { value: "pro", label: "Pro" },
                  { value: "enterprise", label: "Enterprise" },
                ]}
                onChange={(p) => setPlan(c, p)}
              />
            </View>
            <GhostButton title="Open" onPress={() => enter(c.id)} />
            <GhostButton icon="trash-2" title="" danger onPress={() => setDeleting(deleting?.id === c.id ? null : { id: c.id, text: "" })} />
          </View>
          {deleting?.id === c.id && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: C.red }}>Permanently deletes {c.name} with every channel, message and file. Type "{c.handle}" to confirm.</Text>
              <TextInput style={field} autoCapitalize="none" value={deleting.text} onChangeText={(text) => setDeleting({ id: c.id, text })} />
              <GhostButton title="Delete company" danger onPress={() => remove(c)} />
            </View>
          )}
          {open === c.id &&
            (chans?.length === 0 ? (
              <Text style={{ color: C.muted }}>No conversations yet</Text>
            ) : (
              chans?.map((ch) => (
                <Pressable key={ch.id} onPress={() => enter(c.id, ch.id)} style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                  <Icon name={channelIcon(ch.kind)} size={14} style={{ width: 18 }} />
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {ch.kind === "dm" ? ch.people || "Empty conversation" : ch.name}
                    {ch.archived ? " (archived)" : ""}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 12 }}>{num(ch.messages)} msgs</Text>
                </Pressable>
              ))
            ))}
        </View>
      ))}
    </>
  );
}

function Requests({ notify }: { notify: (s: string) => void }) {
  const [rows, setRows] = useState<Request[] | null>(null);
  const [showHandled, setShowHandled] = useState(false);
  const load = useCallback(
    () =>
      supabase
        .from("contact_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200)
        .then(({ data, error }) => (error ? notify(error.message) : setRows(data ?? []))),
    [notify],
  );
  useEffect(() => {
    load();
  }, [load]);
  const toggle = async (r: Request) => {
    const { error } = await supabase.from("contact_requests").update({ handled_at: r.handled_at ? null : new Date().toISOString() }).eq("id", r.id);
    if (error) notify(error.message);
    else load();
  };
  const shown = rows?.filter((r) => showHandled || !r.handled_at);
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Switch value={showHandled} onValueChange={setShowHandled} />
        <Text>Show handled</Text>
      </View>
      {shown?.length === 0 && <Text style={{ color: C.muted }}>No open requests</Text>}
      {shown?.map((r) => (
        <View key={r.id} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 6, opacity: r.handled_at ? 0.6 : 1 }}>
          <Text>
            <Text style={{ fontWeight: "800", color: C.blue }}>{KIND_LABEL[r.kind]}</Text> <Text style={{ fontWeight: "700" }}>{r.name}</Text>
            {r.company ? ` · ${r.company}` : ""}
            {r.team_size ? ` · ${r.team_size} people` : ""}
          </Text>
          <Text style={{ color: C.blue }} onPress={() => Linking.openURL(`mailto:${r.email}`)}>
            {r.email}
          </Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{fmtDate(r.created_at)}</Text>
          {!!r.message && <Text>{r.message}</Text>}
          <GhostButton title={r.handled_at ? "Reopen" : "Mark handled"} onPress={() => toggle(r)} />
        </View>
      ))}
    </>
  );
}

function Users({ notify }: { notify: (s: string) => void }) {
  const { uid, switchCompany, reload } = useChat();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(() => supabase.rpc("platform_users").then(({ data, error }) => (error ? notify(error.message) : setRows(data ?? []))), [notify]);
  useEffect(() => {
    load();
  }, [load]);
  const nameOf = (u: UserRow) => u.full_name || `@${u.username}`;

  const toggleSuper = (u: UserRow) =>
    ask(u.super_admin ? `Remove super admin access from ${nameOf(u)}?` : `Make ${nameOf(u)} a super admin?`, u.super_admin ? "" : "They will be able to see and manage every company.", async () => {
      const { error } = await supabase.rpc("set_super_admin", { p_user: u.id, p_on: !u.super_admin });
      notify(error ? error.message : u.super_admin ? `${nameOf(u)} is no longer a super admin` : `${nameOf(u)} is now a super admin`);
      if (!error) load();
    });
  const removeFrom = (u: UserRow, c: UserRow["companies"][number]) =>
    ask(`Remove ${nameOf(u)} from ${c.name}?`, "", async () => {
      const { error } = await supabase.rpc("remove_member", { p_user: u.id, p_company: c.id });
      notify(error ? error.message : `${nameOf(u)} removed from ${c.name}`);
      if (!error) await Promise.all([load(), reload()]);
    });
  const deleteUser = async (u: UserRow) => {
    if (deleting?.text !== u.email) return notify(`Type their email "${u.email}" to confirm.`);
    const { error } = await supabase.rpc("platform_delete_user", { p_user: u.id });
    notify(error ? error.message : `${nameOf(u)} deleted`);
    if (!error) {
      setDeleting(null);
      await Promise.all([load(), reload()]);
    }
  };

  const shown = rows?.filter((u) => `${u.full_name} ${u.username} ${u.email} ${u.companies.map((c) => c.name).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <TextInput style={field} placeholder="Search name, email or company" value={q} onChangeText={setQ} />
      {shown && <Text style={{ color: C.muted }}>{shown.length} users</Text>}
      {shown?.map((u) => (
        <View key={u.id} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Avatar p={u as unknown as Profile} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800" }}>
                {u.full_name || u.username} <Text style={{ color: C.muted, fontWeight: "400" }}>@{u.username}</Text>
                {u.super_admin && <Text style={{ color: C.blue, fontSize: 12 }}> Super admin</Text>}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>
                {u.email} · joined {fmtDate(u.created_at)} · last sign-in {fmtDate(u.last_sign_in_at)}
              </Text>
            </View>
          </View>
          {u.companies.length === 0 && <Text style={{ color: C.muted, fontSize: 12 }}>No company</Text>}
          {u.companies.map((c) => (
            <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ flex: 1, color: c.status === "active" ? C.text : C.red }} onPress={() => switchCompany(c.id).then(() => router.dismissAll())}>
                {c.name} · {c.role}
                {c.status !== "active" ? " (deactivated)" : ""}
              </Text>
              <Text style={{ color: C.red }} onPress={() => removeFrom(u, c)}>
                Remove
              </Text>
            </View>
          ))}
          {u.id !== uid && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <GhostButton title={u.super_admin ? "Revoke super admin" : "Make super admin"} onPress={() => toggleSuper(u)} />
              <GhostButton title="Delete" danger onPress={() => setDeleting(deleting?.id === u.id ? null : { id: u.id, text: "" })} />
            </View>
          )}
          {deleting?.id === u.id && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: C.red }}>Permanently deletes {nameOf(u)}'s account, messages and files. Type their email to confirm.</Text>
              <TextInput style={field} autoCapitalize="none" keyboardType="email-address" value={deleting.text} onChangeText={(text) => setDeleting({ id: u.id, text })} />
              <GhostButton title="Delete user" danger onPress={() => deleteUser(u)} />
            </View>
          )}
        </View>
      ))}
    </>
  );
}
