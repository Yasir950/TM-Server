import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase, activeStatus } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import EmojiPicker from "@/components/EmojiPicker";
import { Button, C, GhostButton, Label, Segmented, field } from "@/components/ui";
import { Icon } from "@/components/Icon";

// Same presets and clear-after choices as StatusModal (src/components/chat/Views.tsx)
const PRESETS: [string, string, number | null][] = [
  ["📅", "In a meeting", 1],
  ["🚌", "Commuting", 0.5],
  ["🤒", "Out sick", 24],
  ["🌴", "Vacationing", null],
  ["🏠", "Working remotely", 8],
];
type Clear = "never" | "0.5" | "1" | "4" | "today";
const CLEAR: [Clear, string][] = [
  ["never", "Never"],
  ["0.5", "30m"],
  ["1", "1h"],
  ["4", "4h"],
  ["today", "Today"],
];

export default function Status() {
  const { me } = useChat();
  const current = activeStatus(me);
  const [emoji, setEmoji] = useState(current?.emoji ?? "");
  const [text, setText] = useState(current?.text ?? "");
  const [clear, setClear] = useState<Clear>("never");
  const [picker, setPicker] = useState(false);

  async function save(reset = false) {
    let expires: string | null = null;
    if (clear === "today") {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      expires = d.toISOString();
    } else if (clear !== "never") expires = new Date(Date.now() + Number(clear) * 3600_000).toISOString();
    await supabase
      .from("profiles")
      .update(reset ? { status_emoji: "", status_text: "", status_expires_at: null } : { status_emoji: emoji, status_text: text.trim(), status_expires_at: expires })
      .eq("id", me.id);
    router.back();
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => setPicker(true)} style={[field, { width: 50, alignItems: "center" }]}>
          {emoji ? <Text style={{ fontSize: 20 }}>{emoji}</Text> : <Icon name="smile" size={20} />}
        </Pressable>
        <TextInput style={[field, { flex: 1 }]} placeholder="What's your status?" maxLength={100} value={text} onChangeText={setText} autoFocus />
      </View>
      {!text &&
        PRESETS.map(([e, t, h]) => (
          <Pressable
            key={t}
            onPress={() => {
              setEmoji(e);
              setText(t);
              setClear(h === null ? "never" : h === 0.5 ? "0.5" : h === 1 ? "1" : h === 24 ? "today" : "4");
            }}
            style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
          >
            <Text style={{ fontSize: 20 }}>{e}</Text>
            <Text style={{ flex: 1, fontSize: 16 }}>{t}</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>{h === null ? "Don't clear" : h < 1 ? `${h * 60} min` : `${h} h`}</Text>
          </Pressable>
        ))}
      <View>
        <Label>Clear after</Label>
        <Segmented tabs={CLEAR} value={clear} onChange={setClear} />
      </View>
      <Button title="Save" onPress={() => save()} />
      {current && <GhostButton title="Clear status" onPress={() => save(true)} />}
      <EmojiPicker visible={picker} onClose={() => setPicker(false)} onPick={setEmoji} />
    </ScrollView>
  );
}
