import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase, type Task } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { overdue, useLiveTasks, writableProjects } from "@/lib/tasks";
import TaskRow from "@/components/TaskRow";
import { C, Empty, Label, Segmented } from "@/components/ui";

type Scope = "assigned" | "reported";

// Port of MyTasksView: tasks assigned to or reported by the user across their projects
export default function MyTasks() {
  const { uid, me, company, projects } = useChat();
  const [scope, setScope] = useState<Scope>("assigned");
  const [showDone, setShowDone] = useState(false);
  const idKey = projects.map((p) => p.id).join(",");
  const column = scope === "assigned" ? "assignee_id" : "reporter_id";
  const [tasks, setTasks] = useLiveTasks(
    () =>
      supabase
        .from("tasks")
        .select("*")
        .eq(column, uid)
        .in("project_id", idKey ? idKey.split(",") : ["00000000-0000-0000-0000-000000000000"])
        .order("updated_at", { ascending: false })
        .limit(500),
    // Unfiltered: a task reassigned away from this user must drop out too
    undefined,
    [column, uid, idKey, company?.id],
  );
  const byId = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const open = (tasks ?? []).filter((t) => t.status !== "done");
  const done = (tasks ?? []).filter((t) => t.status === "done");
  const late = open.filter(overdue);

  const update = async (id: string, patch: Partial<Task>) => {
    setTasks((ts) => ts?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? ts);
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) alert(error.message);
  };
  const row = (t: Task) => <TaskRow key={t.id} task={t} project={byId[t.project_id]} onStatus={(s) => update(t.id, { status: s })} />;

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      {writableProjects(me, projects).length > 0 && (
        <Stack.Screen
          options={{
            headerRight: () => (
              <Pressable onPress={() => router.push("/new-task")} hitSlop={10}>
                <Text style={{ color: "#fff", fontSize: 26 }}>＋</Text>
              </Pressable>
            ),
          }}
        />
      )}
      <Segmented
        tabs={[
          ["assigned", "Assigned to me"],
          ["reported", "Reported by me"],
        ]}
        value={scope}
        onChange={setScope}
      />
      <View style={{ paddingHorizontal: 12, gap: 8 }}>
        <Text style={{ color: C.muted }}>
          {open.length} open{late.length ? ` · ${late.length} overdue` : ""}
        </Text>
        {tasks && !open.length && <Empty icon="check-square" text={scope === "assigned" ? "Nothing assigned to you. Nice." : "You haven't reported any open tasks."} />}
        {open.map(row)}
        {done.length > 0 && (
          <Pressable onPress={() => setShowDone(!showDone)}>
            <Label>
              {showDone ? "▾" : "▸"} Done ({done.length})
            </Label>
          </Pressable>
        )}
        {showDone && done.map(row)}
      </View>
    </ScrollView>
  );
}
