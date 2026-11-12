import { useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase, displayName, type Message } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import ResultCard from "@/components/ResultCard";
import { Avatar, C, Empty, field } from "@/components/ui";

const FILTERS = ["has:link", "has:file", "has:pin", "is:thread"];

// Jump to a conversation or person, and full-text message search with the web app's modifiers:
// from:@name in:#channel before:/after:/on:YYYY-MM-DD has:link has:file has:pin is:thread
export default function Search() {
  const { profiles, channels, memberships, channelTitle } = useChat();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);

  useEffect(() => {
    if (!submitted.trim()) return setResults(null);
    let live = true;
    (async () => {
      let text = submitted;
      let q = supabase.from("messages").select("*").is("deleted_at", null);
      const take = (re: RegExp) => {
        const m = text.match(re);
        if (m) text = text.replace(m[0], " ");
        return m?.[1];
      };
      const none = "00000000-0000-0000-0000-000000000000";
      const from = take(/\bfrom:@?([\w.-]+)/i);
      if (from) q = q.eq("user_id", Object.values(profiles).find((x) => x.username.toLowerCase() === from.toLowerCase())?.id ?? none);
      const inCh = take(/\bin:#?([\w-]+)/i);
      if (inCh) q = q.eq("channel_id", Object.values(channels).find((x) => x.name?.toLowerCase() === inCh.toLowerCase())?.id ?? none);
      const nextDay = (d: string) => new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10);
      const before = take(/\bbefore:(\d{4}-\d{2}-\d{2})\b/i);
      if (before) q = q.lt("created_at", before);
      const after = take(/\bafter:(\d{4}-\d{2}-\d{2})\b/i);
      if (after) q = q.gte("created_at", nextDay(after));
      const on = take(/\bon:(\d{4}-\d{2}-\d{2})\b/i);
      if (on) q = q.gte("created_at", on).lt("created_at", nextDay(on));
      if (take(/\bhas:file\b()/i) !== undefined) q = q.neq("attachments", "[]");
      if (take(/\bhas:link\b()/i) !== undefined) q = q.ilike("body", "%http%");
      if (take(/\bhas:pin\b()/i) !== undefined) q = q.not("pinned_at", "is", null);
      if (take(/\bis:thread\b()/i) !== undefined) q = q.not("parent_id", "is", null);
      text = text.trim();
      if (text) q = q.textSearch("fts", text, { type: "websearch", config: "simple" });
      const { data } = await q.order("created_at", { ascending: false }).limit(50);
      if (live) setResults((data as Message[]) ?? []);
    })();
    return () => {
      live = false;
    };
  }, [submitted, profiles, channels]);

  const toggle = (f: string) => {
    const words = query.split(/\s+/).filter(Boolean);
    const next = words.includes(f) ? words.filter((w) => w !== f).join(" ") : [...words, f].join(" ");
    setQuery(next);
    setSubmitted(next);
  };

  // Quick jump while typing, before searching messages
  const ql = query.toLowerCase().trim();
  const jump =
    ql && !/:/.test(ql) && query !== submitted
      ? [
          ...Object.values(channels)
            .filter((c) => memberships[c.id] && channelTitle(c).toLowerCase().includes(ql))
            .slice(0, 5)
            .map((c) => ({ key: c.id, label: c.kind === "dm" ? channelTitle(c) : `#${c.name}`, go: () => router.replace(`/c/${c.id}`), p: undefined })),
          ...Object.values(profiles)
            .filter((p) => `${p.full_name} ${p.username}`.toLowerCase().includes(ql))
            .slice(0, 5)
            .map((p) => ({ key: p.id, label: displayName(p), go: () => router.replace(`/member/${p.id}`), p })),
        ]
      : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 12, gap: 8 }}>
        <TextInput style={field} autoFocus placeholder="Search messages, channels and people" value={query} onChangeText={setQuery} onSubmitEditing={() => setSubmitted(query)} returnKeyType="search" autoCapitalize="none" />
        <ScrollView horizontal contentContainerStyle={{ gap: 6 }} showsHorizontalScrollIndicator={false}>
          {FILTERS.map((f) => {
            const on = query.split(/\s+/).includes(f);
            return (
              <Pressable key={f} onPress={() => toggle(f)} style={{ borderWidth: 1, borderColor: on ? C.blue : C.line, backgroundColor: on ? "#e8f5fa" : "#fff", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontFamily: "monospace", fontSize: 12, color: on ? C.blue : C.muted }}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={{ color: C.muted, fontSize: 11 }}>Also: from:@name in:#channel before:/after:/on:YYYY-MM-DD</Text>
      </View>
      {jump.length > 0 ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          {jump.map((j) => (
            <Pressable key={j.key} onPress={j.go} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
              {j.p ? <Avatar p={j.p} size={28} /> : <Text style={{ width: 28, textAlign: "center", color: C.muted }}>#</Text>}
              <Text style={{ fontSize: 16 }}>{j.label}</Text>
            </Pressable>
          ))}
          <Text onPress={() => setSubmitted(query)} style={{ color: C.blue, padding: 16, fontWeight: "600" }}>
            Search messages for “{query}”
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={results ? <Text style={{ color: C.muted, paddingHorizontal: 16 }}>{`${results.length}${results.length === 50 ? "+" : ""} messages`}</Text> : null}
          ListEmptyComponent={results ? <Empty icon="search" text="No messages matched. Try fewer words, or modifiers like from:@name, in:#channel, has:link." /> : null}
          renderItem={({ item }) => <ResultCard m={item} />}
        />
      )}
    </View>
  );
}
