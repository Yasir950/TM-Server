import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { displayName, type Message } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { dayLabel, plainText, timeOf } from "@/lib/format";
import { Avatar, Badge, C } from "./ui";

// Opens a message where it lives: thread replies in their thread, everything else in the conversation
export const openMessage = (m: Message) =>
  router.push(m.parent_id && !m.also_in_channel ? `/t/${m.parent_id}?c=${m.channel_id}` : `/c/${m.channel_id}?m=${m.id}`);

export const ago = (iso: string) => (dayLabel(iso) === "Today" ? timeOf(iso) : dayLabel(iso));

// A message in a list (search, saved, threads, activity), with where it was posted
export default function ResultCard({ m, label, count, onPress }: { m: Message; label?: string; count?: number; onPress?: () => void }) {
  const { profiles, channels, channelTitle } = useChat();
  const ch = channels[m.channel_id];
  const where = ch ? (ch.kind === "dm" ? channelTitle(ch) : `#${ch.name}`) : "a conversation";
  return (
    <Pressable onPress={onPress ?? (() => openMessage(m))} style={({ pressed }) => [{ flexDirection: "row", gap: 10, padding: 14, borderBottomWidth: 1, borderColor: C.line }, pressed && { backgroundColor: "#f6f6f6" }]}>
      <Avatar p={profiles[m.user_id]} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
          {label ?? (m.parent_id ? "Thread in " : "")}
          {where} · {ago(m.created_at)}
        </Text>
        <Text style={{ fontWeight: "700" }}>{m.bot_name ?? displayName(profiles[m.user_id])}</Text>
        <Text numberOfLines={3} style={{ color: C.text }}>
          {plainText(m.body) || "Attachment"}
        </Text>
      </View>
      {!!count && <Badge n={count} />}
    </Pressable>
  );
}
