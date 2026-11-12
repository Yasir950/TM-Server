import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { supabase, type Reminder } from "@/lib/supabase";
import { dayLabel, timeOf } from "@/lib/format";
import WhenPicker from "@/components/WhenPicker";
import { Button, C, Empty, Label, field } from "@/components/ui";
import { Icon } from "@/components/Icon";

// Reminders: the database delivers them as a message from the app (fire_reminders), also via /remind in any conversation
export default function Reminders() {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [text, setText] = useState("");
  const [at, setAt] = useState(() => new Date(Date.now() + 3600_000));

  const load = () =>
    supabase
      .from("reminders")
      .select("*")
      .order("remind_at")
      .then(({ data }) => setItems((data as Reminder[]) ?? []));
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  async function add() {
    const { error } = await supabase.from("reminders").insert({ text: text.trim(), remind_at: at.toISOString() });
    if (error) return alert(error.message);
    setText("");
    load();
  }
  const remove = async (id: string) => {
    setItems((r) => r?.filter((x) => x.id !== id) ?? null);
    await supabase.from("reminders").delete().eq("id", id);
  };

  const upcoming = items?.filter((r) => !r.done_at) ?? [];
  const done = items?.filter((r) => r.done_at).reverse() ?? [];
  const row = (r: Reminder) => (
    <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12 }}>
      <Icon name={r.done_at ? "check-circle" : "clock"} size={20} color={r.done_at ? C.green : C.muted} />
      <View style={{ flex: 1 }}>
        <Text style={[{ fontSize: 15 }, !!r.done_at && { color: C.muted, textDecorationLine: "line-through" }]}>{r.text}</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>
          {dayLabel(r.remind_at)} {timeOf(r.remind_at)}
        </Text>
      </View>
      <Pressable onPress={() => remove(r.id)} hitSlop={8}>
        <Text style={{ color: C.red }}>Delete</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
      <Label>New reminder</Label>
      <TextInput style={field} placeholder="Remind me to…" value={text} onChangeText={setText} />
      <WhenPicker value={at} onChange={setAt} />
      <Button title="Add reminder" disabled={!text.trim()} onPress={add} />
      <Text style={{ color: C.muted, fontSize: 12 }}>Or type /remind me in 20m &lt;text&gt; in any conversation.</Text>
      {items?.length === 0 && <Empty icon="clock" text="No reminders yet." />}
      {upcoming.map(row)}
      {done.length > 0 && <Label>Completed</Label>}
      {done.map(row)}
    </ScrollView>
  );
}
