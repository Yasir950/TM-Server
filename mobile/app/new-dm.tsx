import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import PeoplePicker from "@/components/PeoplePicker";
import { Button, C } from "@/components/ui";

// 1:1, self or group DM (up to 9 people including you)
export default function NewDM() {
  const { uid, reload } = useChat();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function start() {
    const { data, error } = await supabase.rpc("get_or_create_dm", { p_user_ids: picked.length ? picked : [uid] });
    if (error) return setError(error.message);
    await reload();
    router.replace(`/c/${data}`);
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 12, gap: 10 }}>
      <PeoplePicker exclude={[uid]} picked={picked} setPicked={setPicked} max={8} />
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
      <Button title={picked.length ? "Go" : "Message yourself"} onPress={start} />
    </View>
  );
}
