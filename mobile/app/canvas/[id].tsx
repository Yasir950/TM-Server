import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { supabase, displayName } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { timeOf } from "@/lib/format";
import Body from "@/components/Body";
import { C } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Row = { channel_id: string; body: string; updated_by: string | null; updated_at: string };
const TASK = /^(\s*)- \[( |x)\] (.*)$/i;

// Port of Canvas: a shared markdown doc per channel; "- [ ] task" lines are a checklist anyone can tick
export default function Canvas() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, profiles } = useChat();
  const [row, setRow] = useState<Row | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    supabase
      .from("canvases")
      .select("*")
      .eq("channel_id", id)
      .maybeSingle()
      .then(({ data }) => setRow(data ?? { channel_id: id, body: "", updated_by: null, updated_at: "" }));
    const ch = supabase
      .channel(`canvas:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "canvases", filter: `channel_id=eq.${id}` }, ({ new: r }) => setRow(r as Row))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  const save = async (body: string) => {
    const { data, error } = await supabase.from("canvases").upsert({ channel_id: id, body, updated_at: new Date().toISOString(), updated_by: me.id }).select().single();
    setError(error ? error.message : "");
    if (data) setRow(data);
  };
  const edit = (body: string) => {
    setDraft(body);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(body), 800);
  };
  const toggle = (i: number) => {
    if (!row) return;
    const lines = row.body.split("\n");
    lines[i] = lines[i].replace(TASK, (_, ind, x, t) => `${ind}- [${x.trim() ? " " : "x"}] ${t}`);
    save(lines.join("\n"));
  };

  const lines = row?.body.split("\n") ?? [];
  const tasks = lines.filter((l) => TASK.test(l));
  const done = tasks.filter((l) => /\[x\]/i.test(l)).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: tasks.length ? `Canvas · ${done}/${tasks.length} done` : "Canvas",
          headerRight: () => (
            <Pressable onPress={() => (draft === null ? setDraft(row?.body ?? "") : (clearTimeout(timer.current), save(draft), setDraft(null)))} hitSlop={10}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{draft === null ? "Edit" : "Done"}</Text>
            </Pressable>
          ),
        }}
      />
      {draft !== null ? (
        <TextInput
          autoFocus
          multiline
          style={{ flex: 1, padding: 16, fontFamily: "monospace", fontSize: 14, textAlignVertical: "top" }}
          placeholder={"# Project notes\n\n- [ ] A task\n- [x] A finished task"}
          value={draft}
          onChangeText={edit}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
          {!row?.body.trim() && <Text style={{ color: C.muted }}>Empty canvas. Tap Edit to add notes, links and checklists for this channel.</Text>}
          {lines.map((l, i) => {
            const t = TASK.exec(l);
            if (t)
              return (
                <Pressable key={i} onPress={() => toggle(i)} style={{ flexDirection: "row", gap: 8, paddingLeft: t[1].length * 8 }}>
                  <Icon name={t[2].trim() ? "check-square" : "square"} size={18} color={t[2].trim() ? C.green : "#aaa"} />
                  <View style={{ flex: 1, opacity: t[2].trim() ? 0.5 : 1 }}>
                    <Body text={t[3]} />
                  </View>
                </Pressable>
              );
            const h = /^(#{1,3}) (.*)$/.exec(l);
            if (h)
              return (
                <Text key={i} style={{ fontWeight: "800", fontSize: [22, 19, 16][h[1].length - 1], marginTop: 6 }}>
                  {h[2]}
                </Text>
              );
            return l.trim() ? <Body key={i} text={l} /> : <View key={i} style={{ height: 8 }} />;
          })}
        </ScrollView>
      )}
      <Text style={{ padding: 12, color: error ? C.red : C.muted, fontSize: 12, borderTopWidth: 1, borderColor: C.line }}>
        {error || (row?.updated_by ? `Last edited by ${displayName(profiles[row.updated_by])} · ${timeOf(row.updated_at)}` : "Markdown · “- [ ] ” makes a checklist item")}
      </Text>
    </View>
  );
}
