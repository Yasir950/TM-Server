import { useEffect, useState } from "react";
import { FlatList } from "react-native";
import { router } from "expo-router";
import { supabase, type Message } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import ResultCard from "@/components/ResultCard";
import { C, Empty } from "@/components/ui";

// Threads the user started, replied to or was mentioned in, with unread reply counts
export default function Threads() {
  const { threadUnread } = useChat();
  const [threads, setThreads] = useState<Message[] | null>(null);
  // Refetch when a followed thread gets a new reply so counts and order stay current
  const unreadKey = Object.entries(threadUnread)
    .map(([id, t]) => `${id}:${t.unread}`)
    .join();
  useEffect(() => {
    supabase.rpc("my_threads").then(({ data }) => setThreads((data as Message[]) ?? []));
  }, [unreadKey]);
  return (
    <FlatList
      style={{ backgroundColor: C.bg }}
      data={threads ?? []}
      keyExtractor={(m) => m.id}
      ListEmptyComponent={threads ? <Empty icon="💬" text="No threads yet. Reply to a message to start one." /> : null}
      renderItem={({ item }) => <ResultCard m={{ ...item, parent_id: null }} label={`${item.reply_count} ${item.reply_count === 1 ? "reply" : "replies"} · `} count={threadUnread[item.id]?.unread} onPress={() => router.push(`/t/${item.id}?c=${item.channel_id}`)} />}
    />
  );
}
