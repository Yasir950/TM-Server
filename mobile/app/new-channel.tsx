import { useState } from "react";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { slug } from "@/lib/format";
import { Button, C, Label, field } from "@/components/ui";

export default function NewChannel() {
  const { reload } = useChat();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [priv, setPriv] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    const { data, error } = await supabase.rpc("create_channel", { p_name: slug(name), p_kind: priv ? "private" : "public", p_topic: topic });
    if (error) return setError(error.message.includes("channels_name_key") ? "That name is already taken." : error.message);
    await reload();
    router.replace(`/c/${data}`);
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View>
        <Label>Name</Label>
        <TextInput style={field} placeholder="e.g. plan-budget" autoCapitalize="none" value={name} onChangeText={setName} />
        {!!name && <Text style={{ color: C.muted, marginTop: 4 }}>#{slug(name)}</Text>}
      </View>
      <View>
        <Label>Topic (optional)</Label>
        <TextInput style={field} placeholder="What's it about?" value={topic} onChangeText={setTopic} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>Make private</Text>
          <Text style={{ color: C.muted }}>Only invited people can find and join it</Text>
        </View>
        <Switch value={priv} onValueChange={setPriv} />
      </View>
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
      <Button title="Create channel" disabled={!slug(name)} onPress={create} />
    </ScrollView>
  );
}
