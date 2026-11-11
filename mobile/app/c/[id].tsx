import { Pressable, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useChat } from "@/lib/store";
import { useCall } from "@/lib/calls";
import Conversation from "@/components/Conversation";

// ?m= scrolls to a message (permalinks, notifications)
export default function ChannelScreen() {
  const { id, m } = useLocalSearchParams<{ id: string; m?: string }>();
  const { channels, channelTitle } = useChat();
  const { huddles } = useCall();
  const c = channels[id];
  const inCall = huddles[id]?.length ?? 0;
  return (
    <>
      <Stack.Screen
        options={{
          title: c ? (c.kind === "dm" ? channelTitle(c) : `${c.kind === "private" ? "🔒" : "#"} ${c.name}`) : "",
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
              <Pressable onPress={() => router.push(`/call/${id}`)} hitSlop={10}>
                <Text style={{ color: "#fff", fontSize: 18 }}>{inCall ? `🎧 ${inCall}` : "🎧"}</Text>
              </Pressable>
              <Pressable onPress={() => router.push(`/details/${id}`)} hitSlop={10}>
                <Text style={{ color: "#fff", fontSize: 20 }}>ⓘ</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      {inCall > 0 && (
        <Pressable onPress={() => router.push(`/call/${id}`)} style={{ backgroundColor: "#e6f6ee", padding: 8, alignItems: "center" }}>
          <Text style={{ color: "#1d7a4c", fontWeight: "700" }}>
            🎧 {inCall} {inCall === 1 ? "person is" : "people are"} in a Meet here · Join
          </Text>
        </Pressable>
      )}
      <Conversation key={id} channelId={id} parentId={null} focusId={m} />
    </>
  );
}
