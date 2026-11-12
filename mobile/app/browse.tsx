import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase, type Channel } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { C, Empty, field } from "@/components/ui";
import { Icon, channelIcon } from "@/components/Icon";

type Row = Channel & { channel_members: { count: number }[] };

// Every public channel in the workspace (and private ones the user is in); tapping joins and opens it
export default function Browse() {
  const { me, memberships, reload } = useChat();
  const [all, setAll] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("channels")
      .select("*, channel_members(count)")
      .neq("kind", "dm")
      .eq("archived", false)
      .eq("company_id", me.current_company_id)
      .order("name")
      .then(({ data }) => setAll((data as Row[]) ?? []));
  }, [me.current_company_id]);

  async function open(c: Channel) {
    if (!memberships[c.id]) {
      const { error } = await supabase.from("channel_members").insert({ channel_id: c.id, user_id: me.id });
      if (error) return alert(error.message);
      await reload();
    }
    router.replace(`/c/${c.id}`);
  }

  const list = (all ?? []).filter((c) => `${c.name} ${c.topic}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 12, gap: 8 }}>
      <TextInput style={field} placeholder="Search channels" value={q} onChangeText={setQ} autoCapitalize="none" />
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={all ? <Empty icon="hash" text="No channels match." /> : null}
        renderItem={({ item: c }) => (
          <Pressable onPress={() => open(c)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={channelIcon(c.kind)} size={15} color={C.text} />
              <Text style={{ fontSize: 16, fontWeight: "700" }}>{c.name}</Text>
            </View>
            <Text style={{ color: C.muted, marginTop: 2 }} numberOfLines={1}>
              {memberships[c.id] ? "✓ Joined · " : ""}
              {c.channel_members[0]?.count ?? 0} members{c.topic ? ` · ${c.topic}` : ""}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
