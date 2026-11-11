import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useChat } from "@/lib/store";
import { supabase, activeStatus, displayName, inDnd, isAdmin } from "@/lib/supabase";
import { signOut } from "@/lib/push";
import { Avatar, Button, C } from "@/components/ui";

const PAUSE: [number, string][] = [
  [0.5, "30 minutes"],
  [1, "1 hour"],
  [8, "8 hours"],
  [24, "24 hours"],
];

export default function You() {
  const { me, company, companies, superAdmin, switchCompany } = useChat();
  const status = activeStatus(me);
  const paused = inDnd(me);
  const setDnd = (hours: number | null) => supabase.from("profiles").update({ dnd_until: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null }).eq("id", me.id).then();

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Pressable onPress={() => router.push(`/member/${me.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 20 }}>
        <Avatar p={me} size={56} />
        <View>
          <Text style={{ fontSize: 20, fontWeight: "800" }}>{displayName(me)}</Text>
          <Text style={{ color: C.muted }}>{paused ? "🌙 Notifications paused" : "🟢 Active"}</Text>
        </View>
      </Pressable>
      <Row icon={status?.emoji || "😊"} text={status ? status.text || "Status set" : "Update your status"} onPress={() => router.push("/status")} />
      <Section title="Notifications" />
      {paused ? (
        <Row icon="🔔" text={`Resume notifications (paused until ${new Date(me.dnd_until!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`} onPress={() => setDnd(null)} />
      ) : (
        PAUSE.map(([h, label]) => <Row key={h} icon="🌙" text={`Pause for ${label}`} onPress={() => setDnd(h)} />)
      )}
      <Row icon="⚙️" text="Notification settings" onPress={() => Linking.openSettings()} />
      <Section title="Account" />
      <Row icon="👤" text="Edit profile" onPress={() => router.push("/profile")} />
      <Row icon="⏰" text="Reminders" onPress={() => router.push("/reminders")} />
      {company && <Row icon="🏢" text={`${company.name} · people & invites`} onPress={() => router.push("/company")} />}
      {company && isAdmin(me) && <Row icon="🛠" text="Admin" onPress={() => router.push("/admin")} />}
      {superAdmin && <Row icon="🛡" text="Super admin" onPress={() => router.push("/super-admin")} />}
      <Row icon="➕" text="Create or join a workspace" onPress={() => router.push("/workspace")} />
      {companies.length > 1 && (
        <>
          <Section title="Switch workspace" />
          {companies.map((co) => (
            <Row key={co.id} icon={co.id === company?.id ? "✓" : "  "} text={co.name} onPress={() => co.id !== company?.id && switchCompany(co.id)} />
          ))}
        </>
      )}
      <View style={{ padding: 20 }}>
        <Button title="Sign out" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

const Section = ({ title }: { title: string }) => <Text style={s.section}>{title}</Text>;
const Row = ({ icon, text, onPress }: { icon: string; text: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: "#f4f4f4" }]}>
    <Text style={{ width: 28, fontSize: 18, textAlign: "center" }}>{icon}</Text>
    <Text style={{ flex: 1, fontSize: 16 }}>{text}</Text>
  </Pressable>
);

const s = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6, color: C.muted, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
});
