import { useState } from "react";
import { Alert, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase, activeStatus, displayName, inDnd, isAdmin, type Role } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import Choice from "@/components/Choice";
import { Avatar, Button, C, GhostButton, Label, field } from "@/components/ui";

// Admin section of a member's profile (port of MemberCard's admin box in src/components/chat/Company.tsx)
function AdminTools({ userId }: { userId: string }) {
  const { me, profiles, members, reload } = useChat();
  const m = members[userId];
  const name = displayName(profiles[userId]);
  const [designation, setDesignation] = useState(m.designation);
  const [department, setDepartment] = useState(m.department);
  const [error, setError] = useState("");
  const rpc = async (fn: string, args: object) => {
    const { error } = await supabase.rpc(fn, args);
    setError(error?.message ?? "");
    if (!error) await reload();
    return !error;
  };
  const confirm = (title: string, msg: string, go: () => void) =>
    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: "destructive", onPress: go },
    ]);
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 10 }}>
      <Label>Admin</Label>
      <TextInput style={field} placeholder="Designation" value={designation} onChangeText={setDesignation} />
      <TextInput style={field} placeholder="Department" value={department} onChangeText={setDepartment} />
      <GhostButton
        title="Save details"
        onPress={async () => {
          const { error } = await supabase.from("company_members").update({ designation, department }).eq("company_id", me.current_company_id).eq("user_id", userId);
          setError(error?.message ?? "");
          if (!error) reload();
        }}
      />
      <Choice
        value={m.role}
        options={(["admin", "member", "guest"] as Role[]).map((r) => ({ value: r, label: `Role: ${r[0].toUpperCase()}${r.slice(1)}` }))}
        onChange={(r) => rpc("set_member_role", { p_user: userId, p_role: r })}
      />
      <GhostButton title={m.status === "active" ? "Deactivate" : "Reactivate"} onPress={() => rpc("set_member_status", { p_user: userId, p_active: m.status !== "active" })} />
      {me.role === "owner" && m.status === "active" && (
        <GhostButton title="Transfer ownership" onPress={() => confirm(`Make ${name} the owner?`, "You will become an admin.", () => rpc("transfer_ownership", { p_user: userId }))} />
      )}
      <GhostButton
        title="Remove from company"
        danger
        onPress={() =>
          confirm(`Remove ${name}?`, "They lose access to its channels and projects. Their messages stay.", async () => {
            if (await rpc("remove_member", { p_user: userId })) router.back();
          })
        }
      />
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
    </View>
  );
}

// A person's profile: status, title, contact details the viewer may see, and a Message button
export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uid, me, profiles, members, online, away, reload } = useChat();
  const p = profiles[id];
  const m = members[id];
  if (!p) return null;
  const status = activeStatus(p);

  async function message() {
    const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: [id] });
    if (error) return alert(error.message);
    await reload();
    router.replace(`/c/${data}`);
  }

  const row = (label: string, value?: string | null, onPress?: () => void) =>
    value ? (
      <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line }}>
        <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
        <Text style={{ fontSize: 16, color: onPress ? C.blue : C.text }} onPress={onPress}>
          {value}
        </Text>
      </View>
    ) : null;

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Stack.Screen options={{ title: displayName(p) }} />
      <View style={{ alignItems: "center", gap: 8 }}>
        <Avatar p={p} size={96} />
        <Text style={{ fontSize: 22, fontWeight: "800" }}>{displayName(p)}</Text>
        {!!m?.designation && <Text style={{ color: C.muted }}>{m.designation}</Text>}
        <Text style={{ color: C.muted }}>
          {online.has(id) ? (away.has(id) ? "🟡 Away" : "🟢 Active") : "⚪ Offline"}
          {inDnd(p) ? " · 🌙 Notifications paused" : ""}
        </Text>
        {status && <Text>{`${status.emoji} ${status.text}`.trim()}</Text>}
      </View>
      <Button title={id === uid ? "Message yourself" : "Message"} onPress={message} />
      {id === uid && <GhostButton title="Edit profile" onPress={() => router.push("/profile")} />}
      {id !== uid && (
        <GhostButton
          title="🎧 Call"
          onPress={async () => {
            const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: [id] });
            if (error) return alert(error.message);
            await reload();
            router.replace(`/call/${data}`);
          }}
        />
      )}
      <View>
        {row("Username", `@${p.username}`)}
        {row("Role", m?.role && m.role[0].toUpperCase() + m.role.slice(1))}
        {row("Department", m?.department)}
        {row("Email", m?.email, m?.email ? () => Linking.openURL(`mailto:${m.email}`) : undefined)}
        {row("Phone", m?.phone, m?.phone ? () => Linking.openURL(`tel:${m.phone}`) : undefined)}
        {row("Joined", m?.joined_at && new Date(m.joined_at).toLocaleDateString())}
        {row("Last signed in", m?.last_sign_in_at && new Date(m.last_sign_in_at).toLocaleString())}
      </View>
      {isAdmin(me) && id !== uid && m && m.role !== "owner" && <AdminTools userId={id} />}
    </ScrollView>
  );
}
