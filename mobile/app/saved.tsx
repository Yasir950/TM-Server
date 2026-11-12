import { useEffect, useState } from "react";
import { FlatList } from "react-native";
import { supabase, type Message } from "@/lib/supabase";
import { useSavedIds } from "@/lib/saved";
import ResultCard from "@/components/ResultCard";
import { C, Empty } from "@/components/ui";

export default function Saved() {
  const savedIds = useSavedIds();
  const [items, setItems] = useState<Message[] | null>(null);
  useEffect(() => {
    supabase
      .from("saved_items")
      .select("created_at, messages(*)")
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems(((data ?? []) as unknown as { messages: Message }[]).map((r) => r.messages).filter(Boolean)));
  }, []);
  // Unsaving from a message's menu removes it here right away
  const shown = items?.filter((m) => savedIds?.has(m.id) ?? true);
  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      data={shown ?? []}
      keyExtractor={(m) => m.id}
      ListEmptyComponent={shown ? <Empty icon="bookmark" text="Nothing saved yet. Long-press a message → Save for later." /> : null}
      renderItem={({ item }) => <ResultCard m={item} />}
    />
  );
}
