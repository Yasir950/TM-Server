import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useChat } from "@/lib/store";
import { displayName } from "@/lib/supabase";
import { Avatar, C, field } from "./ui";
import { Icon } from "./Icon";

// Search and tick people in the workspace (new DM, add to channel, meeting invitees, project members)
export default function PeoplePicker({ exclude = [], picked, setPicked, max }: { exclude?: string[]; picked: string[]; setPicked: (ids: string[]) => void; max?: number }) {
  const { profiles, online } = useChat();
  const [q, setQ] = useState("");
  const list = Object.values(profiles)
    .filter((p) => !exclude.includes(p.id) && `${p.full_name} ${p.username}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : max && picked.length >= max ? picked : [...picked, id]);
  return (
    <View style={{ flex: 1, gap: 8 }}>
      <TextInput style={field} placeholder="Search people" value={q} onChangeText={setQ} autoCapitalize="none" />
      {picked.length > 0 && <Text style={{ color: C.muted }}>{picked.map((id) => displayName(profiles[id])).join(", ")}</Text>}
      <ScrollView keyboardShouldPersistTaps="handled">
        {list.map((p) => (
          <Pressable key={p.id} onPress={() => toggle(p.id)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
            <Avatar p={p} size={32} online={online.has(p.id)} />
            <Text style={{ flex: 1, fontSize: 16 }}>
              {displayName(p)} <Text style={{ color: C.muted }}>@{p.username}</Text>
            </Text>
            <Icon name={picked.includes(p.id) ? "check-square" : "square"} size={20} color={picked.includes(p.id) ? C.blue : "#ccc"} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
