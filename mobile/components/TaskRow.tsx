import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { Project, Task, TaskStatus } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { STATUSES, dueLabel, overdue, priorityOf, statusColor, statusLabel, typeOf } from "@/lib/tasks";
import Choice from "./Choice";
import { Avatar, C } from "./ui";

// A task in a board column, list or My tasks; the status chip moves it
export default function TaskRow({ task, project, onStatus }: { task: Task; project?: Project; onStatus?: (s: TaskStatus) => void }) {
  const { profiles } = useChat();
  const [bg, fg] = statusColor[task.status];
  return (
    <Pressable onPress={() => router.push(`/task/${task.id}`)} style={({ pressed }) => [{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 8, backgroundColor: pressed ? "#f8f8f8" : "#fff" }]}>
      <Text style={[{ fontSize: 15 }, task.status === "done" && { color: C.muted, textDecorationLine: "line-through" }]}>{task.title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text>{typeOf(task.type).icon}</Text>
        <Text style={{ color: C.muted, fontSize: 12, fontWeight: "600" }}>
          {project ? `${project.key}-${task.number}` : `#${task.number}`}
        </Text>
        <Text style={{ fontSize: 12 }}>{priorityOf(task.priority).icon}</Text>
        {task.labels.slice(0, 2).map((l) => (
          <Text key={l} style={{ fontSize: 11, backgroundColor: "#f1f1f1", borderRadius: 4, paddingHorizontal: 5, overflow: "hidden" }}>
            {l}
          </Text>
        ))}
        {task.due_date && <Text style={{ fontSize: 12, color: overdue(task) ? C.red : C.muted }}>📅 {dueLabel(task.due_date)}</Text>}
        <View style={{ flex: 1 }} />
        {onStatus ? (
          <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Choice compact value={task.status} options={STATUSES.map(([value, label]) => ({ value, label }))} onChange={onStatus} />
          </View>
        ) : (
          <Text style={{ backgroundColor: bg, color: fg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, overflow: "hidden" }}>{statusLabel[task.status]}</Text>
        )}
        {task.assignee_id && <Avatar p={profiles[task.assignee_id]} size={22} />}
      </View>
    </Pressable>
  );
}
