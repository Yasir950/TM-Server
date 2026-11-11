import { useState } from "react";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase, displayName, type TaskPriority, type TaskStatus, type TaskType } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { PRIORITIES, TYPES, dateValue, writableProjects } from "@/lib/tasks";
import Choice from "@/components/Choice";
import WhenPicker from "@/components/WhenPicker";
import { Button, C, GhostButton, Label, field } from "@/components/ui";

// Port of CreateTask; ?p= project, ?s= status column
export default function NewTask() {
  const params = useLocalSearchParams<{ p?: string; s?: TaskStatus }>();
  const { me, profiles, projects } = useChat();
  const writable = writableProjects(me, projects);
  const [pid, setPid] = useState(params.p ?? writable[0]?.id ?? "");
  const project = projects.find((p) => p.id === pid);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("task");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState<Date | null>(null);
  const [description, setDescription] = useState("");
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inProject = (id: string) => !!project?.project_members.some((m) => m.user_id === id);

  async function submit() {
    if (!project) return setError("Pick a project");
    setBusy(true);
    setError("");
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: project.id,
        title: title.trim(),
        type,
        priority,
        status: params.s ?? "todo",
        assignee_id: assignee && inProject(assignee) ? assignee : null,
        due_date: due ? dateValue(due) : null,
        description: description.trim(),
      })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    if (another) {
      setTitle("");
      setDescription("");
    } else router.replace(`/task/${data.id}`);
  }

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View>
        <Label>Project</Label>
        <Choice value={pid} options={writable.map((p) => ({ value: p.id, label: `${p.name} (${p.key})` }))} onChange={setPid} placeholder="Pick a project" />
      </View>
      <TextInput style={field} autoFocus maxLength={300} placeholder="Summary" value={title} onChangeText={setTitle} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Label>Type</Label>
          <Choice value={type} options={TYPES.map((t) => ({ value: t.id, label: `${t.icon} ${t.label}` }))} onChange={setType} />
        </View>
        <View style={{ flex: 1 }}>
          <Label>Priority</Label>
          <Choice value={priority} options={PRIORITIES.map((p) => ({ value: p.id, label: `${p.icon} ${p.label}` }))} onChange={setPriority} />
        </View>
      </View>
      <View>
        <Label>Assignee</Label>
        <Choice
          value={assignee}
          options={[{ value: "", label: "Unassigned" }, ...(project?.project_members ?? []).map((m) => ({ value: m.user_id, label: displayName(profiles[m.user_id]) }))]}
          onChange={setAssignee}
        />
      </View>
      <View>
        <Label>Due date</Label>
        {due ? (
          <View style={{ gap: 6 }}>
            <WhenPicker mode="date" value={due} onChange={setDue} />
            <Text style={{ color: C.muted }} onPress={() => setDue(null)}>
              Remove due date
            </Text>
          </View>
        ) : (
          <GhostButton title="Add due date" onPress={() => setDue(new Date(Date.now() + 7 * 86400_000))} />
        )}
      </View>
      <TextInput style={[field, { minHeight: 90, textAlignVertical: "top" }]} multiline placeholder="Description (optional)" value={description} onChangeText={setDescription} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text>Create another</Text>
        <Switch value={another} onValueChange={setAnother} />
      </View>
      {!!error && <Text style={{ color: C.red }}>{error}</Text>}
      <Button title={busy ? "Creating…" : "Create task"} disabled={busy || !title.trim() || !project} onPress={submit} />
    </ScrollView>
  );
}
