import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase, displayName, meetingEnd, meetingLive, type Meeting } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { useNow } from "@/lib/useNow";
import { dayLabel, timeOf } from "@/lib/format";
import { Avatar, C, Empty, Label } from "@/components/ui";

function dayOf(iso: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Date(iso).toDateString() === tomorrow.toDateString() ? "Tomorrow" : dayLabel(iso);
}

// Port of MeetingsView (src/components/chat/Meetings.tsx)
export default function Meetings() {
  const { uid, meetings } = useChat();
  const now = useNow(15_000);
  const mine = meetings.filter((m) => m.meeting_invitees.some((i) => i.user_id === uid));
  const current = mine.filter((m) => meetingEnd(m) > now && !m.cancelled_at);
  const past = mine.filter((m) => meetingEnd(m) <= now || m.cancelled_at).reverse();
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push("/schedule")} hitSlop={10}>
              <Text style={{ color: "#fff", fontSize: 26 }}>＋</Text>
            </Pressable>
          ),
        }}
      />
      {mine.length === 0 && <Empty icon="📅" text="No meetings yet. Schedule one and everyone invited is called in when it starts." />}
      {current.map((m) => (
        <MeetingCard key={m.id} m={m} now={now} />
      ))}
      {past.length > 0 && <Label>Past and cancelled</Label>}
      {past.map((m) => (
        <MeetingCard key={m.id} m={m} now={now} />
      ))}
    </ScrollView>
  );
}

function MeetingCard({ m, now }: { m: Meeting; now: number }) {
  const { uid, profiles, reloadMeetings } = useChat();
  const live = meetingLive(m, now);
  const over = now >= meetingEnd(m);
  const mine = m.meeting_invitees.find((i) => i.user_id === uid);
  const organizer = m.created_by === uid;
  const where = m.channels?.kind === "dm" ? "Direct call" : `#${m.channels?.name ?? "channel"}`;
  const going = m.meeting_invitees.filter((i) => i.response !== "declined");
  const start = new Date(m.starts_at);

  const respond = async (response: "accepted" | "declined") => {
    const { error } = await supabase.rpc("respond_meeting", { p_id: m.id, p_response: response });
    if (error) Alert.alert("Couldn't respond", error.message);
    else reloadMeetings();
  };
  const cancel = () =>
    Alert.alert(`Cancel “${m.title}”?`, "Everyone invited will be told.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel meeting",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.rpc("cancel_meeting", { p_id: m.id });
          if (error) Alert.alert("Couldn't cancel", error.message);
          else reloadMeetings();
        },
      },
    ]);

  return (
    <View style={{ flexDirection: "row", gap: 12, borderWidth: 1, borderColor: live ? C.green : C.line, borderRadius: 14, padding: 12, opacity: over || m.cancelled_at ? 0.6 : 1 }}>
      <View style={{ width: 48, alignItems: "center", backgroundColor: "#f4f4f4", borderRadius: 10, paddingVertical: 4 }}>
        <Text style={{ fontSize: 11, color: C.muted, fontWeight: "700" }}>{start.toLocaleDateString([], { month: "short" }).toUpperCase()}</Text>
        <Text style={{ fontSize: 20, fontWeight: "800" }}>{start.getDate()}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[{ fontWeight: "700", fontSize: 15 }, !!m.cancelled_at && { textDecorationLine: "line-through" }]}>
          {m.title} {live && <Text style={{ color: C.green }}>● Live</Text>}
          {m.cancelled_at && <Text style={{ color: C.muted, fontWeight: "400" }}> Cancelled</Text>}
        </Text>
        <Text style={{ color: C.muted }}>
          {dayOf(m.starts_at)} · {timeOf(m.starts_at)}–{timeOf(new Date(meetingEnd(m)).toISOString())} · {where}
        </Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>Organized by {organizer ? "you" : displayName(profiles[m.created_by])}</Text>
        {!!m.description && (
          <Text numberOfLines={3} style={{ marginTop: 4 }}>
            {m.description}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
          {m.meeting_invitees.slice(0, 8).map((i) => (
            <View key={i.user_id} style={{ opacity: i.response === "declined" ? 0.35 : 1 }}>
              <Avatar p={profiles[i.user_id]} size={22} />
            </View>
          ))}
          <Text style={{ color: C.muted, fontSize: 12, marginLeft: 4 }}>{going.length} going</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {live && (
            <Pressable onPress={() => router.push(`/call/${m.channel_id}`)} style={{ backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 }}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>🎧 Join</Text>
            </Pressable>
          )}
          {!over &&
            !m.cancelled_at &&
            mine &&
            !organizer &&
            (["accepted", "declined"] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => respond(r)}
                style={{ borderWidth: 1, borderColor: mine.response === r ? (r === "accepted" ? C.green : "#444") : C.line, backgroundColor: mine.response === r ? (r === "accepted" ? C.green : "#444") : "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: mine.response === r ? "#fff" : C.text, fontWeight: "600" }}>{r === "accepted" ? "Going" : "Decline"}</Text>
              </Pressable>
            ))}
          {!over && !m.cancelled_at && organizer && (
            <Text onPress={cancel} style={{ color: C.red, paddingVertical: 6 }}>
              Cancel meeting
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
