import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { supabase, displayName, isAdmin, WEB_URL, type Company, type Role } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { pickAndUploadImage } from "@/lib/upload";
import Choice from "@/components/Choice";
import { Avatar, Button, C, GhostButton, Label, Segmented, field } from "@/components/ui";

type Invite = { id: string; email: string | null; role: Role; token: string; uses: number; max_uses: number | null; expires_at: string };
type Request = { user_id: string; full_name: string; username: string; email: string; created_at: string };
const roleLabel: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
const inviteUrl = (token: string) => `${WEB_URL}/app?invite=${token}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });

// Port of MembersView + CompanyView (src/components/chat/Company.tsx)
export default function CompanyScreen() {
  const { me, company } = useChat();
  const [tab, setTab] = useState<"people" | "about" | "settings">("people");
  if (!company) return null;
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Segmented
        tabs={[
          ["people", "People"],
          ["about", "About"],
          ["settings", isAdmin(me) ? "Settings" : "Leave"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        {tab === "people" && <People />}
        {tab === "about" && <About company={company} />}
        {tab === "settings" && <Settings company={company} />}
      </View>
    </ScrollView>
  );
}

function People() {
  const { me, company, members, profiles, online } = useChat();
  const [q, setQ] = useState("");
  const canInvite = isAdmin(me) || (company?.members_can_invite && me.role !== "guest");
  const list = Object.values(members)
    .filter((m) => `${displayName(profiles[m.user_id])} ${profiles[m.user_id]?.username} ${m.designation} ${m.department}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || displayName(profiles[a.user_id]).localeCompare(displayName(profiles[b.user_id])));
  return (
    <>
      {canInvite && <Button title="Invite people" onPress={() => router.push("/invite")} />}
      <TextInput style={field} placeholder="Search people" value={q} onChangeText={setQ} />
      {list.map((m) => (
        <Pressable key={m.user_id} onPress={() => router.push(`/member/${m.user_id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: m.status === "active" ? 1 : 0.5 }}>
          <Avatar p={profiles[m.user_id]} size={40} online={online.has(m.user_id)} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 16 }}>{displayName(profiles[m.user_id])}</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>{[m.designation, m.department].filter(Boolean).join(" · ") || `@${profiles[m.user_id]?.username ?? ""}`}</Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 12 }}>{m.status === "active" ? roleLabel[m.role] : "Deactivated"}</Text>
        </Pressable>
      ))}
    </>
  );
}

function About({ company }: { company: Company }) {
  const { me, members, profiles, reload } = useChat();
  const admin = isAdmin(me);
  const [form, setForm] = useState(company);
  const [notice, setNotice] = useState("");
  const active = Object.values(members).filter((m) => m.status === "active");
  const owner = profiles[company.owner_id ?? ""];
  const set = (k: keyof Company) => (v: string) => setForm({ ...form, [k]: v });

  const logo = async () => {
    try {
      const url = await pickAndUploadImage(`company-${company.id}`);
      if (!url) return;
      const { error } = await supabase.from("companies").update({ logo_url: url }).eq("id", company.id);
      setNotice(error?.message ?? "Logo updated");
      reload();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const save = async () => {
    const { name, handle, email, phone, industry, size, website, address, description } = form;
    const { error } = await supabase.from("companies").update({ name, handle: handle.toLowerCase(), email, phone, industry, size, website, address, description }).eq("id", company.id);
    setNotice(error?.message ?? "Saved");
    if (!error) reload();
  };

  const rows: [string, string][] = [
    ["Owner", owner ? displayName(owner) : "–"],
    ["Admins", active.filter((m) => m.role === "admin").map((m) => displayName(profiles[m.user_id])).join(", ") || "–"],
    ["Members", String(active.length)],
    ["Email", company.email || "–"],
    ["Phone", company.phone || "–"],
    ["Website", company.website || "–"],
    ["Industry", company.industry || "–"],
    ["Size", company.size || "–"],
    ["Address", company.address || "–"],
    ["Created", fmtDate(company.created_at)],
  ];
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={admin ? logo : undefined}>
          {company.logo_url ? (
            <Image source={{ uri: company.logo_url }} style={{ width: 64, height: 64, borderRadius: 14 }} />
          ) : (
            <View style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>{company.name[0]}</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: "800" }}>{company.name}</Text>
          <Text style={{ color: C.muted }}>@{company.handle}</Text>
          {admin && (
            <Text style={{ color: C.blue }} onPress={logo}>
              Change logo
            </Text>
          )}
        </View>
      </View>
      {!!company.description && <Text>{company.description}</Text>}
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", gap: 12 }}>
          <Text style={{ width: 90, color: C.muted }}>{k}</Text>
          <Text style={{ flex: 1 }}>{v}</Text>
        </View>
      ))}
      {admin && (
        <>
          <Label>Edit company profile</Label>
          {(
            [
              ["name", "Name"],
              ["handle", "Handle"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["website", "Website"],
              ["industry", "Industry"],
              ["size", "Size"],
              ["address", "Address"],
              ["description", "Description"],
            ] as [keyof Company, string][]
          ).map(([k, label]) => (
            <TextInput key={k} style={field} placeholder={label} autoCapitalize={k === "handle" || k === "email" || k === "website" ? "none" : "sentences"} value={String(form[k] ?? "")} onChangeText={set(k)} multiline={k === "description"} />
          ))}
          {!!notice && <Text style={{ color: notice === "Saved" || notice === "Logo updated" ? C.green : C.red }}>{notice}</Text>}
          <Button title="Save company profile" onPress={save} />
        </>
      )}
    </>
  );
}

function Settings({ company }: { company: Company }) {
  const { me, reload } = useChat();
  const admin = isAdmin(me);
  const owner = me.role === "owner";
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [link, setLink] = useState({ role: "member", days: "7", max: "" });
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!admin) return;
    Promise.all([
      supabase.from("company_invites").select("*").eq("company_id", company.id).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      supabase.rpc("pending_join_requests"),
      supabase.from("company_domains").select("domain").eq("company_id", company.id),
    ]).then(([{ data: inv }, { data: req }, { data: dom }]) => {
      setInvites(inv ?? []);
      setRequests(req ?? []);
      setDomains((dom ?? []).map((d) => d.domain));
    });
  }, [company.id, admin, tick]);

  const done = async (error: { message: string } | null, ok: string) => {
    setNotice(error ? error.message : ok);
    if (!error) {
      await reload();
      setTick((t) => t + 1);
    }
  };

  return (
    <>
      {!!notice && <Text style={{ backgroundColor: "#e8f5fa", color: "#0b4c8c", padding: 10, borderRadius: 8, overflow: "hidden" }}>{notice}</Text>}
      {admin && requests.length > 0 && (
        <>
          <Label>Join requests</Label>
          {requests.map((r) => (
            <View key={r.user_id} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, gap: 6 }}>
              <Text style={{ fontWeight: "700" }}>
                {r.full_name || r.username} <Text style={{ color: C.muted, fontWeight: "400" }}>{r.email}</Text>
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <GhostButton title="Decline" onPress={async () => done((await supabase.rpc("review_join", { p_user: r.user_id, p_approve: false })).error, "Request declined")} />
                <GhostButton title="Approve" onPress={async () => done((await supabase.rpc("review_join", { p_user: r.user_id, p_approve: true })).error, "Member added")} />
              </View>
            </View>
          ))}
        </>
      )}
      {admin && (
        <>
          <Label>Invite links</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Choice
                value={link.role}
                options={[
                  { value: "member", label: "Member" },
                  { value: "guest", label: "Guest" },
                ]}
                onChange={(role) => setLink({ ...link, role })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Choice
                value={link.days}
                options={[
                  { value: "1", label: "1 day" },
                  { value: "7", label: "7 days" },
                  { value: "30", label: "30 days" },
                ]}
                onChange={(days) => setLink({ ...link, days })}
              />
            </View>
            <TextInput style={[field, { width: 80 }]} keyboardType="number-pad" placeholder="Max ∞" value={link.max} onChangeText={(max) => setLink({ ...link, max })} />
          </View>
          <Button
            title="Create invite link"
            onPress={async () => {
              const { data, error } = await supabase.rpc("create_invite_link", { p_role: link.role, p_days: Number(link.days), p_max_uses: link.max ? Number(link.max) : null });
              if (data) await Clipboard.setStringAsync(inviteUrl(data));
              await done(error, "Invite link created and copied");
            }}
          />
          {invites.map((i) => (
            <View key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ flex: 1, fontSize: 13 }} numberOfLines={2}>
                {i.email ?? "Invite link"} · {roleLabel[i.role]} · {i.uses}/{i.max_uses ?? "∞"} used · expires {fmtDate(i.expires_at)}
              </Text>
              <Text style={{ color: C.blue }} onPress={() => Clipboard.setStringAsync(inviteUrl(i.token))}>
                Copy
              </Text>
              <Text style={{ color: C.red }} onPress={async () => done((await supabase.rpc("revoke_invite", { p_id: i.id })).error, "Invite revoked")}>
                Revoke
              </Text>
            </View>
          ))}
          <Label>Join settings</Label>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1 }}>People can find this company by its handle and request to join</Text>
            <Switch value={company.allow_join_requests} onValueChange={async (v) => done((await supabase.from("companies").update({ allow_join_requests: v }).eq("id", company.id)).error, "Saved")} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1 }}>Members can invite people</Text>
            <Switch value={company.members_can_invite} onValueChange={async (v) => done((await supabase.from("companies").update({ members_can_invite: v }).eq("id", company.id)).error, "Saved")} />
          </View>
          <Text style={{ color: C.muted }}>Approved email domains: anyone signing up with these joins automatically{owner ? "" : " (owner only)"}</Text>
          {domains.map((d) => (
            <View key={d} style={{ flexDirection: "row" }}>
              <Text style={{ flex: 1 }}>@{d}</Text>
              {owner && (
                <Text style={{ color: C.red }} onPress={async () => done((await supabase.from("company_domains").delete().eq("domain", d)).error, "Domain removed")}>
                  Remove
                </Text>
              )}
            </View>
          ))}
          {owner && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[field, { flex: 1 }]} autoCapitalize="none" placeholder="acme.com" value={domain} onChangeText={setDomain} />
              <GhostButton
                title="Add"
                onPress={async () => {
                  await done((await supabase.from("company_domains").insert({ domain: domain.trim().toLowerCase().replace(/^@/, ""), company_id: company.id })).error, "Domain added");
                  setDomain("");
                }}
              />
            </View>
          )}
        </>
      )}
      <Label>Danger zone</Label>
      {!owner && (
        <GhostButton
          title="Leave company"
          danger
          onPress={() =>
            Alert.alert(`Leave ${company.name}?`, undefined, [
              { text: "Cancel", style: "cancel" },
              { text: "Leave", style: "destructive", onPress: async () => done((await supabase.rpc("leave_company")).error, "You left the company").then(() => router.dismissAll()) },
            ])
          }
        />
      )}
      {owner && (
        <>
          <Text style={{ color: C.muted }}>To leave, first transfer ownership from a member's profile. Deleting removes every channel, message and file. Type the handle @{company.handle} to confirm.</Text>
          <TextInput style={field} autoCapitalize="none" placeholder={company.handle} value={confirm} onChangeText={setConfirm} />
          <GhostButton
            title="Delete company"
            danger
            onPress={async () => {
              if (confirm.trim() !== company.handle) return setNotice(`Type ${company.handle} to confirm.`);
              await done((await supabase.rpc("delete_company")).error, "Company deleted");
              router.dismissAll();
            }}
          />
        </>
      )}
    </>
  );
}
