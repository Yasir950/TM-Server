import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase, type Task, type TaskStatus, type TaskType } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { STATUSES, TYPES, canManage, useLiveTasks } from "@/lib/tasks";
import TaskRow from "@/components/TaskRow";
import { Avatar, C, Empty, Segmented, field } from "@/components/ui";

// A project's board: one status column at a time (tabs with counts), search and filters
export default function ProjectBoard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uid, me, profiles, projects } = useChat();
  const project = projects.find((p) => p.id === id);
  const [tasks, setTasks] = useLiveTasks(() => supabase.from("tasks").select("*").eq("project_id", id).order("position"), `project_id=eq.${id}`, [id]);
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [type, setType] = useState<TaskType | "">("");
  if (!project) return <Empty icon="📋" text="This project was deleted, or you're not in it." />;

  const inProject = project.project_members.some((m) => m.user_id === uid);
  const canAdd = !project.archived && (inProject || canManage(me, project));
  const needle = q.trim().toLowerCase();
  const shown = (tasks ?? []).filter(
    (t) =>
      (!needle || `${project.key}-${t.number} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(needle)) &&
      (!people.length || people.includes(t.assignee_id ?? "none")) &&
      (!type || t.type === type),
  );
  const column = shown.filter((t) => t.status === status);

  // Optimistic: the card moves at once and the database catches up
  const update = async (taskId: string, patch: Partial<Task>) => {
    setTasks((ts) => ts?.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) ?? ts);
    const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
    if (error) alert(error.message);
  };
  const toggle = (pid: string) => setPeople(people.includes(pid) ? people.filter((x) => x !== pid) : [...people, pid]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: project.name,
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 18 }}>
              {canAdd && (
                <Pressable onPress={() => router.push(`/new-task?p=${id}&s=${status}`)} hitSlop={10}>
                  <Text style={{ color: "#fff", fontSize: 24 }}>＋</Text>
                </Pressable>
              )}
              <Pressable onPress={() => router.push(`/project-settings/${id}`)} hitSlop={10}>
                <Text style={{ color: "#fff", fontSize: 20 }}>⚙︎</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
        <TextInput style={field} placeholder="Search this board" value={q} onChangeText={setQ} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
          {project.project_members.map((m) => (
            <Pressable key={m.user_id} onPress={() => toggle(m.user_id)} style={{ opacity: !people.length || people.includes(m.user_id) ? 1 : 0.35 }}>
              <Avatar p={profiles[m.user_id]} size={30} />
            </Pressable>
          ))}
          <Pressable onPress={() => toggle("none")} style={{ borderWidth: 1, borderColor: people.includes("none") ? C.blue : C.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontSize: 12 }}>Unassigned</Text>
          </Pressable>
          {TYPES.map((t) => (
            <Pressable key={t.id} onPress={() => setType(type === t.id ? "" : t.id)} style={{ borderWidth: 1, borderColor: type === t.id ? C.blue : C.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ fontSize: 12 }}>
                {t.icon} {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Segmented tabs={STATUSES.map(([s, label]) => [s, `${label} ${shown.filter((t) => t.status === s).length}`])} value={status} onChange={setStatus} />
      <FlatList
        data={column}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 8 }}
        ListEmptyComponent={tasks ? <Empty icon="🗂" text={canAdd ? "Nothing here. Tap ＋ to add a task." : "Nothing here."} /> : null}
        renderItem={({ item }) => <TaskRow task={item} project={project} onStatus={(s) => update(item.id, { status: s, position: Date.now() / 1000 })} />}
      />
    </View>
  );
}
