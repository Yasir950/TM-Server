import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useChat } from "@/lib/store";
import { supabase, displayName } from "@/lib/supabase";
import ConversationRow from "@/components/ConversationRow";
import { Avatar, C } from "@/components/ui";

// Recent DMs with previews, and everyone else in the workspace to start one with
export default function DMs() {
  const { uid, channels, memberships, previews, profiles, dmMembers, online, reload } = useChat();
  const dms = Object.values(channels)
    .filter((c) => c.kind === "dm" && memberships[c.id])
    .sort((a, b) => (previews[b.id]?.created_at ?? b.created_at).localeCompare(previews[a.id]?.created_at ?? a.created_at));
  // People without a 1:1 DM yet
  const talked = new Set(dms.filter((c) => (dmMembers[c.id] ?? []).length === 2).flatMap((c) => dmMembers[c.id]));
  const others = Object.values(profiles).filter((p) => p.id !== uid && !talked.has(p.id)).sort((a, b) => displayName(a).localeCompare(displayName(b)));

  async function start(userId: string) {
    const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: [userId] });
    if (error) return alert(error.message);
    await reload();
    router.push(`/c/${data}`);
  }

  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      data={dms}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <ConversationRow c={item} preview />}
      ListFooterComponent={
        others.length ? (
          <View>
            <Text style={s.header}>Start a conversation</Text>
            {others.map((p) => (
              <Pressable key={p.id} onPress={() => start(p.id)} style={s.row}>
                <Avatar p={p} size={32} online={online.has(p.id)} />
                <Text style={{ fontSize: 16 }}>{displayName(p)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null
      }
    />
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4, fontWeight: "700", color: C.muted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
});
