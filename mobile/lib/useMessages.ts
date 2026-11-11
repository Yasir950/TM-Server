import { useCallback, useEffect, useState } from "react";
import { supabase, type Message, type Reaction } from "./supabase";

const PAGE = 50;
const same = (a: Reaction, b: Reaction) => a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji;

// Port of src/components/chat/useMessages.ts: a channel's top-level messages (parentId null) or one thread, live via Realtime.
// Newest first, for an inverted FlatList.
export function useMessages(channelId: string, parentId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const upsert = useCallback((m: Message) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [m, ...list].sort((a, b) => b.created_at.localeCompare(a.created_at))));
  }, []);

  const fetchPage = useCallback(
    async (before?: string) => {
      let q = supabase.from("messages").select("*").eq("channel_id", channelId);
      if (parentId) q = q.or(`id.eq.${parentId},parent_id.eq.${parentId}`).order("created_at", { ascending: false });
      else {
        q = q.or("parent_id.is.null,also_in_channel.eq.true").order("created_at", { ascending: false }).limit(PAGE);
        if (before) q = q.lt("created_at", before);
      }
      const page = ((await q).data ?? []) as Message[];
      if (!parentId) setHasMore(page.length === PAGE);
      if (page.length) {
        const { data: rx } = await supabase.from("reactions").select("*").in("message_id", page.map((m) => m.id));
        setReactions((r) => [...r, ...((rx ?? []) as Reaction[])]);
      }
      return page;
    },
    [channelId, parentId],
  );

  useEffect(() => {
    fetchPage().then((page) => {
      setMessages(page);
      setLoading(false);
    });
    const belongs = (m: Message) => (parentId ? m.id === parentId || m.parent_id === parentId : !m.parent_id || m.also_in_channel);
    const onMsg = ({ new: m }: { new: object }) => belongs(m as Message) && upsert(m as Message);
    const rt = supabase
      .channel(`msgs:${channelId}:${parentId ?? "root"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, onMsg)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, onMsg)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions", filter: `channel_id=eq.${channelId}` }, ({ new: r }) =>
        setReactions((list) => [...list.filter((x) => !same(x, r as Reaction)), r as Reaction]),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions" }, ({ old: r }) => setReactions((list) => list.filter((x) => !same(x, r as Reaction))))
      .subscribe();
    return () => {
      supabase.removeChannel(rt);
    };
  }, [channelId, parentId, fetchPage, upsert]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || !messages.length) return;
    const page = await fetchPage(messages[messages.length - 1].created_at);
    setMessages((list) => [...list, ...page]);
  }, [hasMore, messages, fetchPage]);

  const toggleReaction = useCallback(
    async (msg: Message, emoji: string, me: string) => {
      const r: Reaction = { message_id: msg.id, user_id: me, emoji, channel_id: msg.channel_id };
      if (reactions.some((x) => same(x, r))) {
        setReactions((list) => list.filter((x) => !same(x, r)));
        await supabase.from("reactions").delete().match({ message_id: msg.id, user_id: me, emoji });
      } else {
        setReactions((list) => [...list, r]);
        await supabase.from("reactions").insert(r);
      }
    },
    [reactions],
  );

  return { messages, reactions, upsert, loading, loadOlder, toggleReaction };
}
