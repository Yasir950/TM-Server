import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { supabase, displayName, fmtBytes, WEB_URL, type Membership, type Message } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { slug, timeOf } from "@/lib/format";
import PeoplePicker from "@/components/PeoplePicker";
import { Avatar, Button, C, Empty, GhostButton, Label, Segmented, field } from "@/components/ui";

type Tab = "about" | "members" | "pinned" | "files" | "integrations";
type Webhook = { id: string; name: string; token: string; created_by: string };

// Port of ChannelDetails (src/components/chat/Modals.tsx)
export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uid, channels, memberships, profiles, online, reload, updateMembership, channelTitle } = useChat();
  const channel = channels[id];
  const [tab, setTab] = useState<Tab>("about");
  const [members, setMembers] = useState<string[]>([]);
  const [name, setName] = useState(channel?.name ?? "");
  const [topic, setTopic] = useState(channel?.topic ?? "");
  const [adding, setAdding] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", id)
      .then(({ data }) => setMembers((data ?? []).map((r) => r.user_id)));
  }, [id]);

  if (!channel) return null;
  const mem = memberships[id];
  const isDM = channel.kind === "dm";

  async function saveAbout() {
    setError("");
    const patch: Record<string, string> = {};
    if (topic !== channel.topic) patch.topic = topic;
    if (!isDM && slug(name) && slug(name) !== channel.name) patch.name = slug(name);
    if (!Object.keys(patch).length) return;
    const { error } = await supabase.from("channels").update(patch).eq("id", id);
    if (error) setError(error.message.includes("channels_name_key") ? "That name is already taken." : error.message);
  }
  async function addPeople() {
    if (adding?.length) {
      const { error } = await supabase.from("channel_members").insert(adding.map((user_id) => ({ channel_id: id, user_id })));
      if (error) return Alert.alert("Couldn't add", error.message);
      setMembers([...members, ...adding]);
    }
    setAdding(null);
  }
  const leave = () =>
    Alert.alert(`Leave #${channel.name}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          await supabase.from("channel_members").delete().match({ channel_id: id, user_id: uid });
          await reload();
          router.dismissAll();
        },
      },
    ]);
  const archive = () =>
    Alert.alert(channel.archived ? `Unarchive #${channel.name}?` : `Archive #${channel.name}?`, channel.archived ? undefined : "Its history stays readable but nobody can post.", [
      { text: "Cancel", style: "cancel" },
      { text: channel.archived ? "Unarchive" : "Archive", onPress: () => supabase.from("channels").update({ archived: !channel.archived }).eq("id", id).then(() => reload()) },
    ]);
  async function convert() {
    if (!slug(newName)) return;
    const { error } = await supabase.rpc("convert_dm_to_channel", { p_id: id, p_name: slug(newName) });
    if (error) return setError(error.message.includes("channels_name_key") ? "That name is already taken." : error.message);
    setNewName("");
    await reload();
  }

  const tabs: [Tab, string][] = [
    ["about", "About"],
    ["members", `Members ${members.length || ""}`],
    ["pinned", "Pinned"],
    ["files", "Files"],
  ];
  if (!isDM) tabs.push(["integrations", "Hooks"]);

  if (adding)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 12, gap: 10 }}>
        <Stack.Screen options={{ title: "Add people" }} />
        <PeoplePicker exclude={members} picked={adding} setPicked={setAdding} />
        <Button title="Add" disabled={!adding.length} onPress={addPeople} />
        <GhostButton title="Cancel" onPress={() => setAdding(null)} />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: isDM ? channelTitle(channel) : `${channel.kind === "private" ? "🔒" : "#"} ${channel.name}` }} />
      <Segmented tabs={tabs} value={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 16 }} keyboardShouldPersistTaps="handled">
        {tab === "about" && (
          <>
            {!isDM && (
              <View>
                <Label>Channel name</Label>
                <TextInput style={field} value={name} onChangeText={setName} onBlur={saveAbout} autoCapitalize="none" />
              </View>
            )}
            {!isDM && (
              <View>
                <Label>Topic</Label>
                <TextInput style={field} value={topic} onChangeText={setTopic} onBlur={saveAbout} placeholder="Add a topic" />
              </View>
            )}
            <View>
              <Label>Notifications</Label>
              <Segmented
                tabs={[
                  ["default", "Default"],
                  ["all", "All"],
                  ["mentions", "Mentions"],
                  ["nothing", "Off"],
                ]}
                value={mem?.notify ?? "default"}
                onChange={(n: Membership["notify"]) => updateMembership(id, { notify: n })}
              />
              <Text style={{ color: C.muted, fontSize: 12 }}>Default: every message in DMs, only mentions in channels.</Text>
            </View>
            {!!error && <Text style={{ color: C.red }}>{error}</Text>}
            {!isDM && <GhostButton title="📝 Canvas" onPress={() => router.push(`/canvas/${id}`)} />}
            <GhostButton title="📅 Schedule a meeting" onPress={() => router.push(`/schedule?c=${id}`)} />
            {mem && <GhostButton title={mem.starred ? "★ Unstar" : "☆ Star"} onPress={() => updateMembership(id, { starred: !mem.starred })} />}
            {mem && <GhostButton title={mem.muted ? "🔔 Unmute" : "🔕 Mute"} onPress={() => updateMembership(id, { muted: !mem.muted })} />}
            {isDM && members.length > 2 && (
              <View style={{ gap: 8 }}>
                <Label>Convert to private channel</Label>
                <TextInput style={field} placeholder="New channel name" autoCapitalize="none" value={newName} onChangeText={setNewName} />
                <GhostButton title="Convert" onPress={convert} />
              </View>
            )}
            {!isDM && <GhostButton title={channel.archived ? "Unarchive" : "🗄️ Archive"} onPress={archive} />}
            {!isDM && mem && <GhostButton title="Leave channel" danger onPress={leave} />}
          </>
        )}
        {tab === "members" && (
          <>
            {channel.kind !== "dm" && (
              <Pressable onPress={() => setAdding([])}>
                <Text style={{ color: C.blue, fontWeight: "700" }}>+ Add people</Text>
              </Pressable>
            )}
            {members.map((m) => (
              <Pressable key={m} onPress={() => router.push(`/member/${m}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar p={profiles[m]} size={32} online={online.has(m)} />
                <Text style={{ fontSize: 16 }}>
                  {displayName(profiles[m])}
                  {m === uid && <Text style={{ color: C.muted }}> (you)</Text>}
                </Text>
              </Pressable>
            ))}
          </>
        )}
        {tab === "pinned" && <Pinned channelId={id} />}
        {tab === "files" && <Files channelId={id} />}
        {tab === "integrations" && <Webhooks channelId={id} />}
      </ScrollView>
    </View>
  );
}

function Pinned({ channelId }: { channelId: string }) {
  const { profiles } = useChat();
  const [pins, setPins] = useState<Message[] | null>(null);
  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .not("pinned_at", "is", null)
      .is("deleted_at", null)
      .order("pinned_at", { ascending: false })
      .then(({ data }) => setPins((data as Message[]) ?? []));
  }, [channelId]);
  if (pins && !pins.length) return <Empty icon="📌" text="No pinned messages yet. Long-press a message → Pin." />;
  return (
    <>
      {pins?.map((m) => (
        <Pressable key={m.id} onPress={() => router.push(`/c/${channelId}?m=${m.id}`)} style={{ backgroundColor: "#f6f6f6", borderRadius: 10, padding: 12 }}>
          <Text style={{ color: C.muted, fontSize: 12 }}>
            {m.bot_name ?? displayName(profiles[m.user_id])} · {timeOf(m.created_at)}
          </Text>
          <Text numberOfLines={3}>{m.body || "📎 Attachment"}</Text>
        </Pressable>
      ))}
    </>
  );
}

function Files({ channelId }: { channelId: string }) {
  const { profiles } = useChat();
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .neq("attachments", "[]")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setMsgs((data as Message[]) ?? []));
  }, [channelId]);
  const files = (msgs ?? []).flatMap((m) => m.attachments.map((a) => ({ a, m })));
  if (msgs && !files.length) return <Empty icon="📁" text="No files shared here yet." />;
  return (
    <>
      {files.map(({ a, m }) => (
        <Pressable key={a.path} onPress={() => router.push(`/c/${channelId}?m=${m.id}`)} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "#e8f5fa", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 10, fontWeight: "800", color: C.blue }}>{a.name.split(".").pop()?.slice(0, 4).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontWeight: "600" }}>
              {a.name}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {a.size ? fmtBytes(a.size) : ""} · {displayName(profiles[m.user_id])}
            </Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}

// Incoming webhooks: anything that POSTs to the URL posts into the channel
function Webhooks({ channelId }: { channelId: string }) {
  const { profiles } = useChat();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [name, setName] = useState("");
  const url = (h: Webhook) => `${WEB_URL}/api/webhooks/${h.token}`;

  useEffect(() => {
    supabase
      .from("channel_webhooks")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at")
      .then(({ data }) => setHooks((data as Webhook[]) ?? []));
  }, [channelId]);

  async function add() {
    const { data, error } = await supabase.from("channel_webhooks").insert({ channel_id: channelId, name: name.trim() }).select().single();
    if (error) return Alert.alert("Couldn't add webhook", error.message);
    setHooks([...hooks, data as Webhook]);
    setName("");
  }
  const remove = (h: Webhook) =>
    Alert.alert("Delete this webhook?", "Anything using its URL will stop posting.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await supabase.from("channel_webhooks").delete().eq("id", h.id);
          setHooks(hooks.filter((x) => x.id !== h.id));
        },
      },
    ]);

  return (
    <>
      <Text style={{ color: C.muted }}>POST JSON like {'{"text": "Hello"}'} to a webhook URL to post here.</Text>
      {hooks.map((h) => (
        <View key={h.id} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, gap: 6 }}>
          <Text style={{ fontWeight: "700" }}>{h.name}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
            {url(h)} · by {displayName(profiles[h.created_by])}
          </Text>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <Text style={{ color: C.blue, fontWeight: "600" }} onPress={() => Clipboard.setStringAsync(url(h))}>
              Copy URL
            </Text>
            <Text style={{ color: C.red, fontWeight: "600" }} onPress={() => remove(h)}>
              Delete
            </Text>
          </View>
        </View>
      ))}
      <TextInput style={field} placeholder="Webhook name, e.g. GitHub" value={name} onChangeText={setName} />
      <Button title="Add webhook" disabled={!name.trim()} onPress={add} />
    </>
  );
}
