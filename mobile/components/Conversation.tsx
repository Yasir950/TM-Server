import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { router } from "expo-router";
import { supabase, displayName, meetingEnd, meetingLive, type Reaction } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { useMessages } from "@/lib/useMessages";
import { useNow } from "@/lib/useNow";
import { dayLabel, timeOf } from "@/lib/format";
import MessageRow from "./MessageRow";
import Composer from "./Composer";
import { C } from "./ui";

// A channel's messages (parentId null) or one thread, with a composer. focusId scrolls to that message.
export default function Conversation({ channelId, parentId, focusId }: { channelId: string; parentId: string | null; focusId?: string }) {
  const { uid, me, profiles, memberships, setOpen, markRead, markThreadRead } = useChat();
  const { messages, reactions, upsert, loading, loadOlder, toggleReaction } = useMessages(channelId, parentId);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const typingChan = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTyped = useRef(0);
  const list = useRef<FlatList>(null);
  const headerHeight = useHeaderHeight();
  // Read cursor when the conversation opened, for the "New" divider
  const [readAt] = useState(() => memberships[channelId]?.last_read_at ?? "");

  // While a conversation is on screen its messages count as read
  useEffect(() => {
    if (parentId) return markThreadRead(parentId);
    setOpen(channelId);
    markRead(channelId);
    return () => setOpen(null);
  }, [channelId, parentId, setOpen, markRead, markThreadRead, messages.length]);

  // Typing indicators: the same broadcast room the web app uses
  useEffect(() => {
    const ch = supabase.channel(`typing:${channelId}`);
    ch.on("broadcast", { event: "typing" }, ({ payload }) => payload.user !== uid && setTyping((t) => ({ ...t, [payload.user]: Date.now() }))).subscribe();
    typingChan.current = ch;
    const t = setInterval(() => setTyping((all) => Object.fromEntries(Object.entries(all).filter(([, at]) => Date.now() - at < 4000))), 1000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [channelId, uid]);

  const onTyping = useCallback(() => {
    if (Date.now() - lastTyped.current < 2000) return;
    lastTyped.current = Date.now();
    typingChan.current?.send({ type: "broadcast", event: "typing", payload: { user: me.id } });
  }, [me.id]);

  // A message from someone ends their typing state
  const newest = messages[0];
  useEffect(() => {
    if (newest) setTyping((t) => (t[newest.user_id] ? Object.fromEntries(Object.entries(t).filter(([id]) => id !== newest.user_id)) : t));
  }, [newest]);

  const byMessage = useMemo(() => {
    const m: Record<string, Reaction[]> = {};
    for (const r of reactions) (m[r.message_id] ??= []).push(r);
    return m;
  }, [reactions]);

  // Jump to a linked message once it's loaded
  useEffect(() => {
    const i = focusId ? messages.findIndex((x) => x.id === focusId) : -1;
    if (i >= 0) setTimeout(() => list.current?.scrollToIndex({ index: i, viewPosition: 0.5, animated: true }), 300);
  }, [focusId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;
  const typers = Object.keys(typing).map((id) => displayName(profiles[id]));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      {!parentId && <MeetingBanner channelId={channelId} />}
      <FlatList
        ref={list}
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.3}
        onScrollToIndexFailed={({ index }) => setTimeout(() => list.current?.scrollToIndex({ index, animated: false }), 500)}
        ListEmptyComponent={<Text style={s.empty}>No messages yet. Say hello 👋</Text>}
        renderItem={({ item, index }) => {
          const older = messages[index + 1];
          const newDay = !older || dayLabel(older.created_at) !== dayLabel(item.created_at);
          const isNew = !parentId && readAt && item.created_at > readAt && (!older || older.created_at <= readAt) && item.user_id !== uid;
          // Consecutive messages from one person within 5 minutes share a header
          const grouped = !newDay && !isNew && older.user_id === item.user_id && !older.bot_name && !item.bot_name && Date.parse(item.created_at) - Date.parse(older.created_at) < 300_000;
          return (
            <View style={item.id === focusId && s.focus}>
              {newDay && <Text style={s.day}>{dayLabel(item.created_at)}</Text>}
              {isNew && (
                <View style={s.newRow}>
                  <View style={s.newLine} />
                  <Text style={s.newText}>New</Text>
                </View>
              )}
              <MessageRow msg={item} grouped={grouped} inThread={!!parentId} reactions={byMessage[item.id] ?? []} onReact={(e) => toggleReaction(item, e, uid)} />
              {parentId && item.id === parentId && messages.length > 1 && (
                <Text style={s.replyCount}>
                  {messages.length - 1} {messages.length === 2 ? "reply" : "replies"}
                </Text>
              )}
            </View>
          );
        }}
      />
      <Text style={s.typing}>{typers.length ? `${typers.join(", ")} ${typers.length > 1 ? "are" : "is"} typing…` : " "}</Text>
      <Composer channelId={channelId} parentId={parentId} onSent={upsert} onTyping={onTyping} />
    </KeyboardAvoidingView>
  );
}

// Strip at the top while one of this conversation's meetings is live or starts within 15 minutes
function MeetingBanner({ channelId }: { channelId: string }) {
  const { meetings } = useChat();
  const now = useNow(15_000);
  const m = meetings.find((x) => x.channel_id === channelId && !x.cancelled_at && Date.parse(x.starts_at) - 15 * 60_000 <= now && now < meetingEnd(x));
  if (!m) return null;
  const live = meetingLive(m, now);
  return (
    <View style={s.banner}>
      <Text style={{ flex: 1 }} numberOfLines={1}>
        📅 <Text style={{ fontWeight: "700" }}>{m.title}</Text>
        {live ? ` is happening now · until ${timeOf(new Date(meetingEnd(m)).toISOString())}` : ` starts at ${timeOf(m.starts_at)}`}
      </Text>
      {live && (
        <Text onPress={() => router.push(`/call/${channelId}`)} style={s.join}>
          Join
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#e8f5fa", paddingHorizontal: 14, paddingVertical: 8 },
  join: { backgroundColor: C.blue, color: "#fff", fontWeight: "700", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  day: { textAlign: "center", color: C.muted, fontSize: 12, fontWeight: "600", marginVertical: 10 },
  empty: { textAlign: "center", color: C.muted, padding: 30, transform: [{ scaleY: -1 }] },
  typing: { fontSize: 12, color: C.muted, paddingHorizontal: 14, height: 16 },
  focus: { backgroundColor: "#fff8e1" },
  newRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, marginTop: 8 },
  newLine: { flex: 1, height: 1, backgroundColor: C.red },
  newText: { color: C.red, fontSize: 12, fontWeight: "700", marginLeft: 6 },
  replyCount: { color: C.muted, fontSize: 12, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line },
});
