import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useChat } from "@/lib/store";
import { plainText, timeOf } from "@/lib/format";
import { displayName, type Channel } from "@/lib/supabase";
import { Avatar, Badge, C } from "./ui";
import { Icon, channelIcon } from "./Icon";

// One channel or DM in a list: bold when unread, mention count badge, last message preview
export default function ConversationRow({ c, preview }: { c: Channel; preview?: boolean }) {
  const { uid, unread, memberships, previews, profiles, dmMembers, online, channelTitle } = useChat();
  const u = unread[c.id];
  const muted = memberships[c.id]?.muted;
  const bold = !!u?.unread && !muted;
  const p = previews[c.id];
  const other = c.kind === "dm" ? ((dmMembers[c.id] ?? []).find((id) => id !== uid) ?? uid) : null;
  return (
    <Pressable onPress={() => router.push(`/c/${c.id}`)} style={({ pressed }) => [s.row, pressed && { backgroundColor: "#f4f4f4" }]}>
      {other ? (
        <Avatar p={profiles[other]} size={preview ? 40 : 24} online={online.has(other)} />
      ) : (
        <View style={s.hash}>
          <Icon name={channelIcon(c.kind)} size={16} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[s.title, bold && s.bold, muted && { color: "#aaa" }]} numberOfLines={1}>
          {channelTitle(c)}
        </Text>
        {preview && p && (
          <Text style={s.preview} numberOfLines={1}>
            {p.user_id === uid ? "You" : displayName(profiles[p.user_id])}: {plainText(p.body) || "Sent an attachment"}
          </Text>
        )}
      </View>
      {preview && p && <Text style={s.time}>{timeOf(p.created_at)}</Text>}
      <Badge n={muted ? 0 : (c.kind === "dm" ? u?.unread : u?.mentions) ?? 0} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  hash: { width: 24, alignItems: "center" },
  title: { fontSize: 16, color: C.text },
  bold: { fontWeight: "800" },
  preview: { color: C.muted, fontSize: 14, marginTop: 2 },
  time: { color: C.muted, fontSize: 12 },
});
