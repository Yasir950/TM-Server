import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useChat } from "@/lib/store";
import { supabase, activeStatus, displayName, inDnd, isAdmin } from "@/lib/supabase";
import { signOut } from "@/lib/push";
import { Avatar, Button, C } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";

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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {paused ? <Icon name="moon" size={13} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green }} />}
            <Text style={{ color: C.muted }}>{paused ? "Notifications paused" : "Active"}</Text>
          </View>
        </View>
      </Pressable>
      <Row icon="smile" emoji={status?.emoji} text={status ? status.text || "Status set" : "Update your status"} onPress={() => router.push("/status")} />
      <Section title="Notifications" />
      {paused ? (
        <Row icon="bell" text={`Resume notifications (paused until ${new Date(me.dnd_until!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`} onPress={() => setDnd(null)} />
      ) : (
        PAUSE.map(([h, label]) => <Row key={h} icon="moon" text={`Pause for ${label}`} onPress={() => setDnd(h)} />)
      )}
      <Row icon="settings" text="Notification settings" onPress={() => Linking.openSettings()} />
      <Section title="Account" />
      <Row icon="user" text="Edit profile" onPress={() => router.push("/profile")} />
      <Row icon="clock" text="Reminders" onPress={() => router.push("/reminders")} />
      {company && <Row icon="briefcase" text={`${company.name} · people & invites`} onPress={() => router.push("/company")} />}
      {company && isAdmin(me) && <Row icon="tool" text="Admin" onPress={() => router.push("/admin")} />}
      {superAdmin && <Row icon="shield" text="Super admin" onPress={() => router.push("/super-admin")} />}
      <Row icon="plus" text="Add or join a company" onPress={() => router.push("/workspace")} />
      {companies.length > 1 && (
        <>
          <Section title="Switch workspace" />
          {companies.map((co) => (
            <Row key={co.id} icon={co.id === company?.id ? "check" : undefined} text={co.name} onPress={() => co.id !== company?.id && switchCompany(co.id)} />
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
// `emoji` is user content (their status emoji) and wins over the icon when set
const Row = ({ icon, emoji, text, onPress }: { icon?: IconName; emoji?: string; text: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: "#f4f4f4" }]}>
    <View style={{ width: 28, alignItems: "center" }}>{emoji ? <Text style={{ fontSize: 18 }}>{emoji}</Text> : icon && <Icon name={icon} size={20} color={C.text} />}</View>
    <Text style={{ flex: 1, fontSize: 16 }}>{text}</Text>
  </Pressable>
);

const s = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6, color: C.muted, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
});
