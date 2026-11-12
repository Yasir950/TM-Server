import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { supabase, displayName, WEB_URL, type Project, type Task, type TaskActivity, type TaskComment, type TaskStatus } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { PRIORITIES, STATUSES, TYPES, canManage, dateValue, dueLabel, priorityOf, statusLabel, typeOf, when } from "@/lib/tasks";
import Choice from "@/components/Choice";
import WhenPicker from "@/components/WhenPicker";
import { Avatar, C, Empty, GhostButton, Label, Segmented, field } from "@/components/ui";
import { Icon } from "@/components/Icon";

type TaskWithProject = Task & { projects: Project | null };

// Port of TaskDialog (src/components/chat/Projects.tsx)
export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, profiles, notifications, markNotificationsRead } = useChat();
  const [task, setTask] = useState<TaskWithProject | null | undefined>(undefined);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");

  // Opening a task reads its notifications, however it was opened
  const unreadHere = notifications.filter((n) => n.task_id === id && !n.read_at).map((n) => n.id).join(",");
  useEffect(() => {
    if (unreadHere) markNotificationsRead(unreadHere.split(","));
  }, [unreadHere, markNotificationsRead]);

  useEffect(() => {
    const loadTask = () =>
      supabase
        .from("tasks")
        .select("*, projects(*, project_members(*))")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          setTask((data as TaskWithProject) ?? null);
          if (data) {
            setTitle(data.title);
            setDescription(data.description);
          }
        });
    const loadComments = () =>
      supabase
        .from("task_comments")
        .select("*")
        .eq("task_id", id)
        .order("created_at")
        .then(({ data }) => setComments((data as TaskComment[]) ?? []));
    const loadActivity = () =>
      supabase
        .from("task_activity")
        .select("*")
        .eq("task_id", id)
        .order("created_at", { ascending: false })
        .then(({ data }) => setActivity((data as TaskActivity[]) ?? []));
    loadTask();
    loadComments();
    loadActivity();
    const ch = supabase
      .channel(`task:${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks", filter: `id=eq.${id}` }, () => loadTask())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, ({ old }) => (old as Task).id === id && setTask(null))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${id}` }, () => loadComments())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_activity", filter: `task_id=eq.${id}` }, () => loadActivity())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  if (task === undefined) return null;
  const project = task?.projects;
  if (!task || !project) return <Empty icon="layers" text="This task was deleted, or you're not in its project." />;

  const key = `${project.key}-${task.number}`;
  const manage = canManage(me, project);
  const canDelete = manage || task.reporter_id === me.id;

  const save = async (patch: Partial<Task>) => {
    setTask((t) => (t ? { ...t, ...patch } : t));
    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) Alert.alert("Couldn't save", error.message);
  };
  const remove = () =>
    Alert.alert(`Delete ${key}?`, "Its comments and history are deleted too.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("tasks").delete().eq("id", task.id);
          if (error) Alert.alert("Couldn't delete", error.message);
          else router.back();
        },
      },
    ]);
  const addLabel = () => {
    const l = label.trim().toLowerCase().replace(/\s+/g, "-");
    if (l && !task.labels.includes(l)) save({ labels: [...task.labels, l] });
    setLabel("");
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: key,
          headerRight: () => (
            <Pressable onPress={() => Clipboard.setStringAsync(`${WEB_URL}/app?task=${task.id}`)} hitSlop={10}>
              <Text style={{ color: "#fff" }}>Copy link</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={{ color: C.blue }} onPress={() => router.push(`/project/${project.id}`)}>
        {project.name}
      </Text>
      <TextInput
        style={[field, { fontSize: 18, fontWeight: "700" }]}
        multiline
        value={title}
        onChangeText={setTitle}
        onBlur={() => title.trim() && title.trim() !== task.title && save({ title: title.trim() })}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Label>Status</Label>
          <Choice value={task.status} options={STATUSES.map(([value, l]) => ({ value, label: l }))} onChange={(s: TaskStatus) => save({ status: s })} />
        </View>
        <View style={{ flex: 1 }}>
          <Label>Priority</Label>
          <Choice value={task.priority} options={PRIORITIES.map((p) => ({ value: p.id, label: p.label, icon: <Icon name={p.icon} size={16} color={p.color} /> }))} onChange={(p) => save({ priority: p })} />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Label>Type</Label>
          <Choice value={task.type} options={TYPES.map((t) => ({ value: t.id, label: t.label, icon: <Icon name={t.icon} size={16} color={t.color} /> }))} onChange={(t) => save({ type: t })} />
        </View>
        <View style={{ flex: 1 }}>
          <Label>Estimate (points)</Label>
          <TextInput
            style={field}
            keyboardType="decimal-pad"
            defaultValue={task.estimate?.toString() ?? ""}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text.trim();
              save({ estimate: v === "" ? null : Math.max(0, Number(v) || 0) });
            }}
          />
        </View>
      </View>
      <View>
        <Label>Assignee</Label>
        <Choice
          value={task.assignee_id ?? ""}
          options={[{ value: "", label: "Unassigned" }, ...project.project_members.map((m) => ({ value: m.user_id, label: displayName(profiles[m.user_id]) }))]}
          onChange={(a) => save({ assignee_id: a || null })}
        />
      </View>
      <View>
        <Label>Due date</Label>
        {task.due_date ? (
          <View style={{ gap: 6 }}>
            <WhenPicker mode="date" value={new Date(`${task.due_date}T00:00`)} onChange={(d) => save({ due_date: dateValue(d) })} />
            <Text style={{ color: C.muted }} onPress={() => save({ due_date: null })}>
              Remove due date ({dueLabel(task.due_date)})
            </Text>
          </View>
        ) : (
          <GhostButton title="Add due date" onPress={() => save({ due_date: dateValue(new Date(Date.now() + 7 * 86400_000)) })} />
        )}
      </View>
      <View>
        <Label>Labels</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {task.labels.map((l) => (
            <Pressable key={l} onPress={() => save({ labels: task.labels.filter((x) => x !== l) })} style={{ backgroundColor: "#f1f1f1", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text>{l} ✕</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={field} placeholder="Add a label" value={label} onChangeText={setLabel} onSubmitEditing={addLabel} autoCapitalize="none" />
      </View>
      <View>
        <Label>Description</Label>
        <TextInput
          style={[field, { minHeight: 100, textAlignVertical: "top" }]}
          multiline
          placeholder="Add a description"
          value={description}
          onChangeText={setDescription}
          onBlur={() => description !== task.description && save({ description })}
        />
      </View>
      <Text style={{ color: C.muted, fontSize: 12 }}>
        Reported by {task.reporter_id ? displayName(profiles[task.reporter_id]) : "someone"} · created {when(task.created_at)} · updated {when(task.updated_at)}
      </Text>
      {canDelete && <GhostButton title={`Delete ${key}`} danger onPress={remove} />}

      <Segmented
        tabs={[
          ["comments", `Comments ${comments.length || ""}`],
          ["history", "History"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "comments" ? <Comments taskId={task.id} comments={comments} canModerate={manage} /> : <History activity={activity} />}
    </ScrollView>
  );
}

function Comments({ taskId, comments, canModerate }: { taskId: string; comments: TaskComment[]; canModerate: boolean }) {
  const { me, profiles } = useChat();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  async function post() {
    if (!body.trim()) return;
    const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body: body.trim() });
    if (error) return Alert.alert("Couldn't comment", error.message);
    setBody("");
  }
  const saveEdit = async () => {
    if (!editing?.body.trim()) return;
    const { error } = await supabase.from("task_comments").update({ body: editing.body.trim() }).eq("id", editing.id);
    if (error) Alert.alert("Couldn't save", error.message);
    setEditing(null);
  };
  const remove = (cid: string) =>
    Alert.alert("Delete this comment?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => supabase.from("task_comments").delete().eq("id", cid).then() },
    ]);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <Avatar p={me} size={30} />
        <TextInput style={[field, { flex: 1 }]} multiline placeholder="Add a comment" value={body} onChangeText={setBody} />
        <Text style={{ color: C.blue, fontWeight: "700", padding: 8 }} onPress={post}>
          Post
        </Text>
      </View>
      {comments.map((c) => (
        <View key={c.id} style={{ flexDirection: "row", gap: 8 }}>
          <Avatar p={profiles[c.user_id]} size={30} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text>
              <Text style={{ fontWeight: "700" }}>{displayName(profiles[c.user_id])}</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>
                {"  "}
                {when(c.created_at)}
                {c.edited_at ? " (edited)" : ""}
              </Text>
            </Text>
            {editing?.id === c.id ? (
              <>
                <TextInput style={field} multiline value={editing.body} onChangeText={(b) => setEditing({ id: c.id, body: b })} />
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Text style={{ color: C.blue, fontWeight: "600" }} onPress={saveEdit}>
                    Save
                  </Text>
                  <Text style={{ color: C.muted }} onPress={() => setEditing(null)}>
                    Cancel
                  </Text>
                </View>
              </>
            ) : (
              <Text>{c.body}</Text>
            )}
            {editing?.id !== c.id && (c.user_id === me.id || canModerate) && (
              <View style={{ flexDirection: "row", gap: 16 }}>
                {c.user_id === me.id && (
                  <Text style={{ color: C.muted, fontSize: 12 }} onPress={() => setEditing({ id: c.id, body: c.body })}>
                    Edit
                  </Text>
                )}
                <Text style={{ color: C.muted, fontSize: 12 }} onPress={() => remove(c.id)}>
                  Delete
                </Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function History({ activity }: { activity: TaskActivity[] }) {
  const { profiles } = useChat();
  const show = (field: string, v: string | null) => {
    if (v === null || v === "") return "none";
    if (field === "assignee") return displayName(profiles[v]);
    if (field === "status") return statusLabel[v as TaskStatus] ?? v;
    if (field === "priority") return priorityOf(v as Task["priority"])?.label ?? v;
    if (field === "type") return typeOf(v as Task["type"])?.label ?? v;
    if (field === "due_date") return dueLabel(v);
    return v;
  };
  const names: Record<string, string> = { status: "status", priority: "priority", type: "type", assignee: "assignee", title: "summary", due_date: "due date" };
  if (!activity.length) return <Text style={{ color: C.muted }}>No changes yet.</Text>;
  return (
    <View style={{ gap: 12 }}>
      {activity.map((a) => (
        <View key={a.id} style={{ flexDirection: "row", gap: 8 }}>
          <Avatar p={a.user_id ? profiles[a.user_id] : undefined} size={24} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#555" }}>
              <Text style={{ fontWeight: "700", color: C.text }}>{a.user_id ? displayName(profiles[a.user_id]) : "Someone"}</Text>{" "}
              {a.field === "created" ? (
                "created the task"
              ) : (
                <>
                  changed the {names[a.field] ?? a.field} from <Text style={{ fontWeight: "600", color: C.text }}>{show(a.field, a.old_value)}</Text> to{" "}
                  <Text style={{ fontWeight: "600", color: C.text }}>{show(a.field, a.new_value)}</Text>
                </>
              )}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>{when(a.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
