import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase, type AppNotification, type Message } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import ResultCard, { ago } from "@/components/ResultCard";
import { Avatar, C, Empty } from "@/components/ui";
import { Icon } from "@/components/Icon";

// Mentions and task notifications in one timeline, newest first (port of ActivityList in src/components/chat/Chat.tsx)
export default function Activity() {
  const { uid, profiles, memberships, unread, threadUnread, notifications, markNotificationsRead } = useChat();
  const [items, setItems] = useState<Message[] | null>(null);
  // Refetch when a new mention arrives
  const mentionKey = Object.values(unread).reduce((n, u) => n + u.mentions, 0) + Object.values(threadUnread).reduce((n, t) => n + t.mentions, 0);

  useEffect(() => {
    supabase
      .from("messages")
      .select("*")
      .is("deleted_at", null)
      .neq("user_id", uid)
      .or(`mentions.cs.{${uid}},body.ilike.%@channel%,body.ilike.%@here%`)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setItems((data as Message[]) ?? []));
  }, [uid, mentionKey]);

  type Row = { at: string; m: Message | null; n: AppNotification | null };
  const feed: Row[] | null = items
    ? [...items.filter((m) => memberships[m.channel_id]).map((m) => ({ at: m.created_at, m, n: null })), ...notifications.map((n) => ({ at: n.created_at, m: null, n }))].sort((a, b) =>
        b.at.localeCompare(a.at),
      )
    : null;
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <FlatList
        style={{ backgroundColor: C.bg }}
        data={feed ?? []}
        keyExtractor={(r) => r.m?.id ?? r.n!.id}
        ListHeaderComponent={
          unreadCount > 0 ? (
            <Text onPress={() => markNotificationsRead()} style={{ color: C.blue, fontWeight: "600", textAlign: "right", padding: 12 }}>
              Mark all read
            </Text>
          ) : null
        }
        ListEmptyComponent={feed ? <Empty icon="bell" text="Nothing yet. Mentions and tasks assigned to you show up here." /> : null}
        renderItem={({ item: { m, n } }) =>
          m ? (
            <ResultCard m={m} label={m.parent_id ? "Thread in " : "Mention in "} />
          ) : (
            <Pressable
              onPress={() => {
                markNotificationsRead([n!.id]);
                if (n!.task_id) router.push(`/task/${n!.task_id}`);
              }}
              style={{ flexDirection: "row", gap: 10, padding: 14, borderBottomWidth: 1, borderColor: C.line, backgroundColor: n!.read_at ? C.bg : "#eef6fb" }}
            >
              <Avatar p={n!.actor_id ? profiles[n!.actor_id] : undefined} size={36} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name="check-square" size={12} />
                  <Text style={{ color: C.muted, fontSize: 12 }}>Task assigned to you · {ago(n!.created_at)}</Text>
                </View>
                <Text style={{ fontWeight: n!.read_at ? "600" : "800" }}>{n!.title}</Text>
                <Text numberOfLines={2}>{n!.body}</Text>
              </View>
            </Pressable>
          )
        }
      />
  );
}
