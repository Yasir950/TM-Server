"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase, type Message, type Reaction } from "@/lib/supabase";

const PAGE = 50;

// Loads a channel's top-level messages (parentId null) or one thread (parent + replies), kept live via Realtime
export function useMessages(channelId: string, parentId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const upsert = useCallback((m: Message) => {
    setMessages((list) => {
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) return list.map((x) => (x.id === m.id ? m : x));
      return [...list, m].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  const fetchPage = useCallback(
    async (before?: string) => {
      let q = supabase.from("messages").select("*").eq("channel_id", channelId);
      if (parentId) q = q.or(`id.eq.${parentId},parent_id.eq.${parentId}`).order("created_at");
      else {
        q = q.or("parent_id.is.null,also_in_channel.eq.true").order("created_at", { ascending: false }).limit(PAGE);
        if (before) q = q.lt("created_at", before);
      }
      const { data } = await q;
      const page = ((data ?? []) as Message[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
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
    // State is set after the async fetch resolves, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage().then((page) => {
      setMessages(page);
      setLoading(false);
    });

    const belongs = (m: Message) => (parentId ? m.id === parentId || m.parent_id === parentId : !m.parent_id || m.also_in_channel);
    const rt = supabase
      .channel(`msgs:${channelId}:${parentId ?? "root"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, ({ new: m }) => {
        if (belongs(m as Message)) upsert(m as Message);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, ({ new: m }) => {
        if (belongs(m as Message)) upsert(m as Message);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions", filter: `channel_id=eq.${channelId}` }, ({ new: r }) =>
        setReactions((list) => [...list.filter((x) => !same(x, r as Reaction)), r as Reaction]),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions" }, ({ old: r }) =>
        setReactions((list) => list.filter((x) => !same(x, r as Reaction))),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(rt);
    };
  }, [channelId, parentId, fetchPage, upsert]);

  const loadOlder = useCallback(async () => {
    if (!messages.length) return;
    const page = await fetchPage(messages[0].created_at);
    setMessages((list) => [...page, ...list]);
  }, [messages, fetchPage]);

  return { messages, reactions, setReactions, upsert, hasMore, loading, loadOlder };
}

// Saved message ids, shared by every message row and the Saved view
let saved: Set<string> | null = null;
const savedListeners = new Set<() => void>();
const emitSaved = () => savedListeners.forEach((l) => l());

function subscribeSaved(l: () => void) {
  savedListeners.add(l);
  if (!saved) {
    saved = new Set();
    supabase.from("saved_items").select("message_id").then(({ data }) => {
      saved = new Set((data ?? []).map((r) => r.message_id));
      emitSaved();
    });
  }
  return () => savedListeners.delete(l);
}

export const useSavedIds = () => useSyncExternalStore(subscribeSaved, () => saved, () => null);

export async function toggleSaved(messageId: string) {
  const next = new Set(saved);
  const has = next.has(messageId);
  if (has) next.delete(messageId);
  else next.add(messageId);
  saved = next;
  emitSaved();
  if (has) await supabase.from("saved_items").delete().eq("message_id", messageId);
  else await supabase.from("saved_items").insert({ message_id: messageId });
}

const same = (a: Reaction, b: Reaction) => a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji;

export async function toggleReaction(
  msg: Message,
  emoji: string,
  me: string,
  reactions: Reaction[],
  setReactions: React.Dispatch<React.SetStateAction<Reaction[]>>,
) {
  const r: Reaction = { message_id: msg.id, user_id: me, emoji, channel_id: msg.channel_id };
  if (reactions.some((x) => same(x, r))) {
    setReactions((list) => list.filter((x) => !same(x, r)));
    await supabase.from("reactions").delete().match({ message_id: msg.id, user_id: me, emoji });
  } else {
    setReactions((list) => [...list, r]);
    await supabase.from("reactions").insert(r);
  }
}
