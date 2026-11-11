import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { suggestKey } from "@/lib/tasks";
import PeoplePicker from "@/components/PeoplePicker";
import { Button, C, Label, field } from "@/components/ui";

export default function NewProject() {
  const { uid, reloadProjects } = useChat();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownKey = keyEdited ? key : suggestKey(name);

  async function submit() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("create_project", { p_name: name.trim(), p_key: shownKey, p_description: description.trim(), p_members: people });
    if (error) {
      setError(error.message);
      return setBusy(false);
    }
    await reloadProjects();
    router.replace(`/project/${data}`);
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Label>Name</Label>
          <TextInput style={field} maxLength={80} placeholder="e.g. Website relaunch" value={name} onChangeText={setName} />
        </View>
        <View style={{ width: 100 }}>
          <Label>Key</Label>
          <TextInput
            style={field}
            maxLength={10}
            autoCapitalize="characters"
            value={shownKey}
            onChangeText={(v) => {
              setKeyEdited(true);
              setKey(v.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            }}
          />
        </View>
      </View>
      <Text style={{ color: C.muted, fontSize: 12 }}>Tasks get keys like {shownKey || "KEY"}-1.</Text>
      <TextInput style={[field, { minHeight: 70, textAlignVertical: "top" }]} multiline maxLength={2000} placeholder="Description (optional)" value={description} onChangeText={setDescription} />
      <Label>People</Label>
      <View style={{ height: 280 }}>
        <PeoplePicker exclude={[uid]} picked={people} setPicked={setPeople} />
      </View>
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
      <Button title={busy ? "Creating…" : "Create project"} disabled={busy || !name.trim() || !shownKey} onPress={submit} />
    </ScrollView>
  );
}
