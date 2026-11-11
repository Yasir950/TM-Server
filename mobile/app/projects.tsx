import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase, displayName, type Project } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { C, Empty, Label } from "@/components/ui";

// Port of ProjectList (src/components/chat/Projects.tsx)
export default function Projects() {
  const { uid, me, profiles, projects } = useChat();
  const [counts, setCounts] = useState<Record<string, { open: number; done: number; mine: number }>>({});
  const ids = projects.map((p) => p.id).join(",");

  useEffect(() => {
    if (!ids) return;
    supabase
      .from("tasks")
      .select("project_id,status,assignee_id")
      .in("project_id", ids.split(","))
      .then(({ data }) => {
        const next: Record<string, { open: number; done: number; mine: number }> = {};
        for (const t of data ?? []) {
          const c = (next[t.project_id] ??= { open: 0, done: 0, mine: 0 });
          if (t.status === "done") c.done++;
          else {
            c.open++;
            if (t.assignee_id === uid) c.mine++;
          }
        }
        setCounts(next);
      });
  }, [ids, uid]);

  const card = (p: Project) => {
    const c = counts[p.id] ?? { open: 0, done: 0, mine: 0 };
    const total = c.open + c.done;
    return (
      <Pressable key={p.id} onPress={() => router.push(`/project/${p.id}`)} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, gap: 6, opacity: p.archived ? 0.6 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{p.key.slice(0, 4)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 16 }}>{p.name}</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {p.key} · {p.project_members.length} people{p.lead_id ? ` · Lead ${displayName(profiles[p.lead_id])}` : ""}
            </Text>
          </View>
        </View>
        {!!p.description && (
          <Text numberOfLines={2} style={{ color: C.muted }}>
            {p.description}
          </Text>
        )}
        <View style={{ height: 6, backgroundColor: "#eee", borderRadius: 3, overflow: "hidden" }}>
          <View style={{ height: 6, width: `${total ? (c.done / total) * 100 : 0}%`, backgroundColor: C.green }} />
        </View>
        <Text style={{ color: C.muted, fontSize: 12 }}>
          {c.open} open · {c.done} done{c.mine ? ` · ${c.mine} assigned to you` : ""}
        </Text>
      </Pressable>
    );
  };

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      {me.role !== "guest" && (
        <Stack.Screen
          options={{
            headerRight: () => (
              <Pressable onPress={() => router.push("/new-project")} hitSlop={10}>
                <Text style={{ color: "#fff", fontSize: 26 }}>＋</Text>
              </Pressable>
            ),
          }}
        />
      )}
      {!projects.length && <Empty icon="📋" text="No projects yet. Create one to track work on a board." />}
      {active.map(card)}
      {archived.length > 0 && <Label>Archived</Label>}
      {archived.map(card)}
    </ScrollView>
  );
}
