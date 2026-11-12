import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useChat } from "@/lib/store";
import ConversationRow from "@/components/ConversationRow";
import { WorkspaceForm } from "@/components/WorkspaceForm";
import { Badge, C } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";

// Slack-style Home: starred, channels, then direct messages
export default function Home() {
  const { company, channels, memberships, previews, channelTitle, reload } = useChat();
  const [refreshing, setRefreshing] = useState(false);

  if (!company)
    return (
      <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, gap: 8 }} keyboardShouldPersistTaps="handled">
        <Text style={s.emptyTitle}>Welcome</Text>
        <Text style={s.emptyText}>Create a company for your team, or join one you've been invited to.</Text>
        <WorkspaceForm />
      </ScrollView>
    );

  const list = Object.values(channels).filter((c) => !c.archived && memberships[c.id]);
  const byName = (a: (typeof list)[0], b: (typeof list)[0]) => channelTitle(a).localeCompare(channelTitle(b));
  const recent = (a: (typeof list)[0], b: (typeof list)[0]) => (previews[b.id]?.created_at ?? b.created_at).localeCompare(previews[a.id]?.created_at ?? a.created_at);
  const sections = [
    { title: "Starred", data: list.filter((c) => memberships[c.id].starred).sort(byName) },
    { title: "Channels", data: list.filter((c) => c.kind !== "dm" && !memberships[c.id].starred).sort(byName) },
    { title: "Direct messages", data: list.filter((c) => c.kind === "dm" && !memberships[c.id].starred).sort(recent).slice(0, 15) },
  ].filter((x) => x.data.length);

  return (
    <SectionList
      style={{ backgroundColor: C.bg }}
      sections={sections}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={<Shortcuts />}
      renderSectionHeader={({ section }) => <Text style={s.header}>{section.title}</Text>}
      renderItem={({ item }) => <ConversationRow c={item} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await reload();
            setRefreshing(false);
          }}
        />
      }
    />
  );
}

// Search bar, then Threads / Saved / Reminders / Meetings / Projects / Tasks, like Slack's Home
function Shortcuts() {
  const { threadUnread } = useChat();
  const threads = Object.values(threadUnread).reduce((n, t) => n + t.unread, 0);
  const items: [IconName, string, string, number?][] = [
    ["message-circle", "Threads", "/threads", threads],
    ["bookmark", "Saved", "/saved"],
    ["clock", "Reminders", "/reminders"],
    ["calendar", "Meetings", "/meetings"],
    ["trello", "Projects", "/projects"],
    ["check-square", "My tasks", "/tasks"],
  ];
  return (
    <View>
      <Pressable onPress={() => router.push("/search")} style={s.search}>
        <Icon name="search" size={16} />
        <Text style={{ color: C.muted }}>Jump to or search…</Text>
      </Pressable>
      {items.map(([icon, label, to, n]) => (
        <Pressable key={to} onPress={() => router.push(to)} style={({ pressed }) => [s.shortcut, pressed && { backgroundColor: "#f4f4f4" }]}>
          <View style={{ width: 24, alignItems: "center" }}>
            <Icon name={icon} size={18} color={C.text} />
          </View>
          <Text style={[{ flex: 1, fontSize: 16 }, !!n && { fontWeight: "800" }]}>{label}</Text>
          <Badge n={n ?? 0} />
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  search: { margin: 12, marginBottom: 4, padding: 10, borderRadius: 8, backgroundColor: "#f1f1f1", flexDirection: "row", alignItems: "center", gap: 8 },
  shortcut: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  header: { backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, fontWeight: "700", color: C.muted, fontSize: 13 },
  empty: { flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: C.bg },
  emptyTitle: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  emptyText: { color: C.muted, textAlign: "center" },
});
