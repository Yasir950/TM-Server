import { Modal, Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { displayName } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { useCall } from "@/lib/calls";
import { Avatar, C } from "./ui";
import { Icon } from "./Icon";

// Incoming call sheet (rings that arrive over realtime while the app is open) and the "in a call" bar
export default function CallOverlays() {
  const { profiles } = useChat();
  const call = useCall();
  const path = usePathname();
  const onCallScreen = path.startsWith("/call/");
  const r = call.ring;

  return (
    <>
      <Modal visible={!!r && !onCallScreen} transparent animationType="slide" onRequestClose={() => call.dismissRing(true)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          {r && (
            <View style={{ backgroundColor: "#111", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 44, alignItems: "center", gap: 10 }}>
              <Avatar p={profiles[r.from]} size={72} />
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>{r.meeting ? `${r.title} is starting` : `${displayName(profiles[r.from])} is calling`}</Text>
              <Text style={{ color: "#aaa" }}>{r.meeting ? `Organized by ${displayName(profiles[r.from])}` : `in ${r.title}`}</Text>
              <View style={{ flexDirection: "row", gap: 16, marginTop: 16 }}>
                <Pressable onPress={() => call.dismissRing(true)} style={{ backgroundColor: C.red, borderRadius: 28, paddingHorizontal: 28, paddingVertical: 14 }}>
                  <Text style={{ color: "#fff", fontWeight: "800" }}>Decline</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    call.join(r.channelId);
                    router.push(`/call/${r.channelId}`);
                  }}
                  style={{ backgroundColor: C.green, borderRadius: 28, paddingHorizontal: 28, paddingVertical: 14 }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>{r.meeting ? "Join" : "Answer"}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
      {call.huddle && !onCallScreen && (
        <Pressable onPress={() => router.push(`/call/${call.huddle}`)} style={{ position: "absolute", left: 12, right: 12, bottom: 96, backgroundColor: C.green, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8 }}>
          <Icon name="headphones" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", flex: 1 }} numberOfLines={1}>
            In {call.callName(call.huddle)} · {call.people.length} {call.people.length === 1 ? "person" : "people"}
          </Text>
          <Icon name={call.me.muted ? "mic-off" : "mic"} size={16} color="#fff" />
          <Text onPress={() => call.join(null)} style={{ color: "#fff", fontWeight: "800", backgroundColor: "rgba(0,0,0,0.25)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: "hidden" }}>
            Leave
          </Text>
        </Pressable>
      )}
    </>
  );
}
