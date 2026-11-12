import { Pressable, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useChat } from "@/lib/store";
import { useCall } from "@/lib/calls";
import Conversation from "@/components/Conversation";
import { ChannelTitle, Icon } from "@/components/Icon";

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
          title: c ? (c.kind === "dm" ? channelTitle(c) : (c.name ?? "")) : "",
          headerTitle: c ? ({ tintColor }) => <ChannelTitle kind={c.kind} text={c.kind === "dm" ? channelTitle(c) : (c.name ?? "")} color={tintColor ?? "#fff"} /> : undefined,
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
              <Pressable onPress={() => router.push(`/call/${id}`)} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name="headphones" size={20} color="#fff" />
                {inCall > 0 && <Text style={{ color: "#fff", fontSize: 16 }}>{inCall}</Text>}
              </Pressable>
              <Pressable onPress={() => router.push(`/details/${id}`)} hitSlop={10}>
                <Icon name="info" size={21} color="#fff" />
              </Pressable>
            </View>
          ),
        }}
      />
      {inCall > 0 && (
        <Pressable onPress={() => router.push(`/call/${id}`)} style={{ backgroundColor: "#e6f6ee", padding: 8, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 }}>
          <Icon name="headphones" size={15} color="#1d7a4c" />
          <Text style={{ color: "#1d7a4c", fontWeight: "700" }}>
            {inCall} {inCall === 1 ? "person is" : "people are"} in a Meet here · Join
          </Text>
        </Pressable>
      )}
      <Conversation key={id} channelId={id} parentId={null} focusId={m} />
    </>
  );
}
