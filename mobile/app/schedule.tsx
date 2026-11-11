import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase, displayName } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import WhenPicker from "@/components/WhenPicker";
import { Avatar, Button, C, Label, Segmented, field } from "@/components/ui";

const DURATIONS: [string, string][] = [
  ["15", "15m"],
  ["30", "30m"],
  ["45", "45m"],
  ["60", "1h"],
  ["90", "1.5h"],
  ["120", "2h"],
];

// The next half hour at least 15 minutes away
function nextSlot() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

// The start as the organizer sees it, with their time zone so others can convert
const whenLabel = (d: Date) => d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

// Port of ScheduleMeeting (src/components/chat/Meetings.tsx); ?c= preselects the conversation
export default function Schedule() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  const { uid, profiles, channels, memberships, dmMembers, channelTitle, reload, reloadMeetings } = useChat();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [at, setAt] = useState(nextSlot);
  const [duration, setDuration] = useState("30");
  // A conversation id, or "dm" for a new call with just the people invited
  const [where, setWhere] = useState(c ?? "dm");
  const [invitees, setInvitees] = useState<string[]>(() => (c && channels[c]?.kind === "dm" ? (dmMembers[c] ?? []).filter((id) => id !== uid) : []));
  const [channelMembers, setChannelMembers] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [pickWhere, setPickWhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const target = where === "dm" ? undefined : channels[where];
  useEffect(() => {
    if (!target || target.kind === "dm") return;
    supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", target.id)
      .then(({ data }) => setChannelMembers(new Set((data ?? []).map((r) => r.user_id))));
  }, [target]);

  // Who can be invited: anyone for a new call, the members of a DM or private channel, any non-guest for a public channel
  const eligible = (id: string) =>
    id !== uid && (!target || (target.kind === "dm" ? (dmMembers[target.id] ?? []).includes(id) : channelMembers.has(id) || (target.kind === "public" && profiles[id]?.role !== "guest")));
  const chosen = invitees.filter(eligible);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? Object.values(profiles)
        .filter((p) => eligible(p.id) && !chosen.includes(p.id) && `${displayName(p)} ${p.username}`.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];
  const everyone = target && target.kind !== "public" ? (target.kind === "dm" ? (dmMembers[target.id] ?? []) : [...channelMembers]).filter((id) => id !== uid) : [];
  const places = Object.values(channels)
    .filter((x) => memberships[x.id] && !x.archived)
    .sort((a, b) => Number(a.kind === "dm") - Number(b.kind === "dm") || channelTitle(a).localeCompare(channelTitle(b)));
  const placeName = (id: string) => (id === "dm" ? "New Meet with the people invited" : channels[id]?.kind === "dm" ? channelTitle(channels[id]) : `#${channels[id]?.name}`);

  async function submit() {
    setError("");
    if (at.getTime() < Date.now() - 60_000) return setError("Pick a start time in the future");
    if (!chosen.length) return setError("Invite at least one person");
    setBusy(true);
    try {
      let channel = where;
      if (where === "dm") {
        const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: chosen });
        if (error) throw error;
        channel = data;
        await reload();
      }
      const { error } = await supabase.rpc("schedule_meeting", {
        p_channel: channel,
        p_title: title.trim(),
        p_starts_at: at.toISOString(),
        p_duration: Number(duration),
        p_invitees: chosen,
        p_description: description.trim(),
        p_when_label: `${whenLabel(at)} (${duration} min)`,
      });
      if (error) throw error;
      await reloadMeetings();
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <TextInput style={field} autoFocus maxLength={200} placeholder="Meeting title" value={title} onChangeText={setTitle} />
      <WhenPicker value={at} onChange={setAt} />
      <Segmented tabs={DURATIONS} value={duration} onChange={setDuration} />
      <View>
        <Label>Where</Label>
        <Pressable onPress={() => setPickWhere(!pickWhere)} style={field}>
          <Text>{placeName(where)} ▾</Text>
        </Pressable>
        {pickWhere &&
          ["dm", ...places.map((x) => x.id)].map((id) => (
            <Pressable
              key={id}
              onPress={() => {
                setWhere(id);
                setPickWhere(false);
              }}
              style={{ paddingVertical: 8, paddingHorizontal: 4 }}
            >
              <Text style={{ fontWeight: id === where ? "800" : "400" }}>{placeName(id)}</Text>
            </Pressable>
          ))}
      </View>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row" }}>
          <Label>Invite</Label>
          <View style={{ flex: 1 }} />
          {everyone.length > 0 && chosen.length < everyone.length && (
            <Text style={{ color: C.blue, fontWeight: "600" }} onPress={() => setInvitees(everyone)}>
              Invite everyone here
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {chosen.map((id) => (
            <Pressable key={id} onPress={() => setInvitees(invitees.filter((x) => x !== id))} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingRight: 8 }}>
              <Avatar p={profiles[id]} size={22} />
              <Text>{displayName(profiles[id])} ✕</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={field} placeholder="Add people by name" value={q} onChangeText={setQ} />
        {matches.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => {
              setInvitees([...invitees, p.id]);
              setQ("");
            }}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}
          >
            <Avatar p={p} size={24} />
            <Text style={{ flex: 1 }}>{displayName(p)}</Text>
            <Text style={{ color: C.muted }}>@{p.username}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={[field, { minHeight: 80, textAlignVertical: "top" }]} multiline maxLength={2000} placeholder="Agenda or notes (optional)" value={description} onChangeText={setDescription} />
      <Text style={{ color: C.muted, fontSize: 12 }}>At the start time everyone invited is called in automatically.</Text>
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
      <Button title={busy ? "Scheduling…" : "Schedule"} disabled={busy || !title.trim()} onPress={submit} />
    </ScrollView>
  );
}
