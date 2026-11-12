import { useEffect, useRef, useState } from "react";
import { FlatList, NativeModules, Platform, Pressable, StyleSheet, Text, View, findNodeHandle } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { RTCView, ScreenCapturePickerView } from "react-native-webrtc";
import { displayName } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { REACTIONS, useCall, type Person } from "@/lib/calls";
import { useNow } from "@/lib/useNow";
import PeoplePicker from "@/components/PeoplePicker";
import { Avatar, Button, C } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// The call screen. Opening it joins the call, unless it came from a ring (?from=), which shows Answer/Decline first.
export default function CallScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { profiles } = useChat();
  const call = useCall();
  const [inviting, setInviting] = useState<string[] | null>(null);
  const [reacting, setReacting] = useState(false);
  const now = useNow(1000);
  const inCall = call.huddle === id;
  const picker = useRef(null);
  const showPicker = () => NativeModules.ScreenCapturePickerViewManager?.show(findNodeHandle(picker.current));

  useEffect(() => {
    if (inCall) return;
    if (from) call.setRing({ channelId: id, from, title: call.callName(id) });
    else call.join(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inCall)
    return (
      <View style={[s.dark, { justifyContent: "center", alignItems: "center", gap: 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {from && <Avatar p={profiles[from]} size={96} />}
        <Text style={s.title}>{from ? `${displayName(profiles[from])} is calling` : "Joining…"}</Text>
        <Text style={s.sub}>{call.callName(id)}</Text>
        {from && (
          <View style={{ flexDirection: "row", gap: 40, marginTop: 30 }}>
            <Round color={C.red} icon="phone-off" label="Decline" onPress={() => (call.dismissRing(true), router.back())} />
            <Round color={C.green} icon="phone" label="Answer" onPress={() => call.join(id)} />
          </View>
        )}
      </View>
    );

  if (inviting)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 12, gap: 10 }}>
        <Stack.Screen options={{ title: "Invite to the call", headerShown: true }} />
        <PeoplePicker exclude={call.people.map((p) => p.user)} picked={inviting} setPicked={setInviting} />
        <Button title="Ring them" disabled={!inviting.length} onPress={() => (call.invite(inviting), setInviting(null))} />
      </View>
    );

  const others = call.people.filter((p) => !p.self);
  return (
    <View style={s.dark}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* iOS: the system broadcast picker, opened by the Share button (see showPicker) */}
      {Platform.OS === "ios" && <ScreenCapturePickerView ref={picker} />}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Icon name="chevron-down" size={26} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.title}>{call.callName(id)}</Text>
          <Text style={s.sub}>{call.connectedAt ? clock((now - call.connectedAt) / 1000) : others.length ? "Connecting…" : "Calling…"}</Text>
        </View>
        <Pressable onPress={() => setInviting([])} hitSlop={10}>
          <Icon name="user-plus" size={22} color="#fff" />
        </Pressable>
      </View>
      {!!call.notice && <Text style={s.notice}>{call.notice}</Text>}
      {!!call.error && <Text style={s.notice}>{call.error}</Text>}
      <FlatList
        data={call.people}
        keyExtractor={(p) => p.key || "me"}
        numColumns={call.people.length > 2 ? 2 : 1}
        key={call.people.length > 2 ? "grid" : "stack"}
        contentContainerStyle={{ padding: 8, gap: 8, flexGrow: 1 }}
        columnWrapperStyle={call.people.length > 2 ? { gap: 8 } : undefined}
        renderItem={({ item }) => <Tile person={item} tall={call.people.length <= 2} />}
      />
      {reacting && (
        <View style={s.reactions}>
          {REACTIONS.map((e) => (
            <Pressable key={e} onPress={() => (call.react(e), setReacting(false))}>
              <Text style={{ fontSize: 30 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={s.controls}>
        <Round color={call.me.muted ? "#fff" : "#333"} dark={call.me.muted} icon={call.me.muted ? "mic-off" : "mic"} label={call.me.muted ? "Unmute" : "Mute"} onPress={() => call.toggle("muted")} />
        <Round color={call.me.camera ? "#fff" : "#333"} dark={call.me.camera} icon={call.me.camera ? "video" : "video-off"} label={call.me.camera ? "Stop video" : "Video"} onPress={() => call.toggle("camera")} />
        {call.me.camera && <Round color="#333" icon="refresh-cw" label="Flip" onPress={call.flipCamera} />}
        <Round color={call.speaker ? "#fff" : "#333"} dark={call.speaker} icon="volume-2" label="Speaker" onPress={() => call.setSpeaker(!call.speaker)} />
        <Round color={call.me.sharing ? "#fff" : "#333"} dark={call.me.sharing} icon="monitor" label={call.me.sharing ? "Stop share" : "Share"} onPress={() => call.shareScreen(showPicker)} />
        <Round color={call.me.hand ? "#fff" : "#333"} dark={call.me.hand} icon="hand" label="Hand" onPress={() => call.toggle("hand")} />
        <Round color="#333" icon="smile" label="React" onPress={() => setReacting(!reacting)} />
        <Round color={C.red} icon="phone-off" label="Leave" onPress={() => (call.join(null), router.back())} />
      </View>
    </View>
  );
}

// A person: their camera, the screen they share (from desktop/web), or their avatar
function Tile({ person, tall }: { person: Person; tall: boolean }) {
  const { profiles } = useChat();
  // Your own shared screen isn't mirrored back to you (it would show the call screen inside itself)
  const screen = person.state.sharing && !person.self ? person.streams[1] : null;
  const camera = person.state.camera ? person.streams[2] : null;
  const video = screen ?? camera;
  return (
    <View style={[s.tile, tall ? { flex: 1, minHeight: 220 } : { flex: 1, aspectRatio: 3 / 4 }]}>
      {video ? (
        <RTCView streamURL={video.toURL()} style={StyleSheet.absoluteFill} objectFit={screen ? "contain" : "cover"} mirror={person.self && !screen} />
      ) : (
        <Avatar p={profiles[person.user]} size={tall ? 96 : 64} />
      )}
      {!!person.reaction && <Text style={s.reaction}>{person.reaction}</Text>}
      <View style={s.name}>
        {person.state.hand && <Icon name="hand" size={13} color="#fff" />}
        {person.state.muted && <Icon name="mic-off" size={13} color="#fff" />}
        <Text style={{ color: "#fff", fontWeight: "600" }}>
          {person.self ? "You" : displayName(profiles[person.user])}
          {person.state.sharing ? " · sharing screen" : ""}
        </Text>
      </View>
    </View>
  );
}

const Round = ({ color, icon, label, onPress, dark }: { color: string; icon: IconName; label: string; onPress: () => void; dark?: boolean }) => (
  <Pressable onPress={onPress} style={{ alignItems: "center", gap: 4, width: 56 }}>
    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={22} color={dark ? "#000" : "#fff"} />
    </View>
    <Text style={{ color: "#ccc", fontSize: 11 }}>{label}</Text>
  </Pressable>
);

const s = StyleSheet.create({
  dark: { flex: 1, backgroundColor: "#111", paddingTop: 50 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  sub: { color: "#aaa", fontSize: 13 },
  notice: { color: "#fff", backgroundColor: "#333", textAlign: "center", padding: 8, marginHorizontal: 16, borderRadius: 8 },
  tile: { backgroundColor: "#222", borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  name: { position: "absolute", left: 10, bottom: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  reaction: { position: "absolute", top: 10, right: 12, fontSize: 36 },
  reactions: { flexDirection: "row", justifyContent: "space-around", padding: 10, backgroundColor: "#222", marginHorizontal: 12, borderRadius: 14 },
  controls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, paddingVertical: 16, paddingBottom: 36 },
});
