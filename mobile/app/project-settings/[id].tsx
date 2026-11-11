import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase, displayName, isAdmin } from "@/lib/supabase";
import { useChat } from "@/lib/store";
import { canManage } from "@/lib/tasks";
import Choice from "@/components/Choice";
import PeoplePicker from "@/components/PeoplePicker";
import { Avatar, Button, C, GhostButton, Label, Segmented, field } from "@/components/ui";

// Port of ProjectSettings: the project's people for everyone in it, details for its admins
export default function ProjectSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, profiles, projects, reloadProjects } = useChat();
  const project = projects.find((p) => p.id === id);
  const [tab, setTab] = useState<"people" | "details">("people");
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [lead, setLead] = useState(project?.lead_id ?? "");
  const [adding, setAdding] = useState<string[] | null>(null);
  const [confirmKey, setConfirmKey] = useState("");
  const [error, setError] = useState("");
  if (!project) return null;
  const manage = canManage(me, project);
  const memberIds = project.project_members.map((m) => m.user_id);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError("");
    const { error } = await fn();
    if (error) setError(error.message);
    await reloadProjects();
    return !error;
  };
  const removePerson = (user_id: string) => {
    const self = user_id === me.id;
    Alert.alert(self ? `Leave ${project.name}?` : `Remove ${displayName(profiles[user_id])}?`, self ? undefined : "Their open tasks here become unassigned.", [
      { text: "Cancel", style: "cancel" },
      {
        text: self ? "Leave" : "Remove",
        style: "destructive",
        onPress: async () => {
          if ((await run(() => supabase.rpc("remove_project_member", { p_project: project.id, p_user: user_id }))) && self && !isAdmin(me)) router.dismissAll();
        },
      },
    ]);
  };
  const destroy = async () => {
    if (confirmKey.trim().toUpperCase() !== project.key) return setError(`Type ${project.key} to confirm.`);
    if (await run(() => supabase.from("projects").delete().eq("id", project.id))) router.dismissAll();
  };

  if (adding)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 12, gap: 10 }}>
        <PeoplePicker exclude={memberIds} picked={adding} setPicked={setAdding} />
        <Button
          title="Add to project"
          disabled={!adding.length}
          onPress={async () => (await run(() => supabase.from("project_members").insert(adding.map((user_id) => ({ project_id: project.id, user_id }))))) && setAdding(null)}
        />
        <GhostButton title="Cancel" onPress={() => setAdding(null)} />
      </View>
    );

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {manage && (
        <Segmented
          tabs={[
            ["people", "People"],
            ["details", "Details"],
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      <View style={{ padding: 16, paddingTop: manage ? 0 : 16, gap: 12 }}>
        {!!error && <Text style={{ color: C.red }}>{error}</Text>}
        {tab === "people" && (
          <>
            {manage && <GhostButton title="+ Add people" onPress={() => setAdding([])} />}
            {project.project_members.map((m) => (
              <View key={m.user_id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar p={profiles[m.user_id]} size={32} />
                <Text style={{ flex: 1, fontSize: 16 }}>
                  {displayName(profiles[m.user_id])}
                  {m.user_id === project.lead_id && <Text style={{ color: C.muted }}> · Lead</Text>}
                </Text>
                {manage ? (
                  <Choice
                    compact
                    value={m.role}
                    options={[
                      { value: "member", label: "Member" },
                      { value: "admin", label: "Admin" },
                    ]}
                    onChange={(role) => run(() => supabase.from("project_members").update({ role }).match({ project_id: project.id, user_id: m.user_id }))}
                  />
                ) : (
                  <Text style={{ color: C.muted }}>{m.role === "admin" ? "Admin" : "Member"}</Text>
                )}
                {(manage || m.user_id === me.id) && (
                  <Pressable onPress={() => removePerson(m.user_id)} hitSlop={8}>
                    <Text style={{ color: C.red }}>{m.user_id === me.id ? "Leave" : "✕"}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}
        {tab === "details" && manage && (
          <>
            <View>
              <Label>Name</Label>
              <TextInput style={field} maxLength={80} value={name} onChangeText={setName} />
            </View>
            <View>
              <Label>Description</Label>
              <TextInput style={[field, { minHeight: 80, textAlignVertical: "top" }]} multiline maxLength={2000} value={description} onChangeText={setDescription} />
            </View>
            <View>
              <Label>Lead</Label>
              <Choice value={lead} options={[{ value: "", label: "No lead" }, ...memberIds.map((u) => ({ value: u, label: displayName(profiles[u]) }))]} onChange={setLead} />
            </View>
            <Button
              title="Save"
              disabled={!name.trim()}
              onPress={() => run(() => supabase.from("projects").update({ name: name.trim(), description: description.trim(), lead_id: lead || null }).eq("id", project.id))}
            />
            <GhostButton title={project.archived ? "Unarchive project" : "Archive project"} onPress={() => run(() => supabase.from("projects").update({ archived: !project.archived }).eq("id", project.id))} />
            <Label>Delete project</Label>
            <Text style={{ color: C.muted }}>This deletes {project.name} and all its tasks for everyone. Type {project.key} to confirm.</Text>
            <TextInput style={field} autoCapitalize="characters" value={confirmKey} onChangeText={setConfirmKey} placeholder={project.key} />
            <GhostButton title="Delete project" danger onPress={destroy} />
          </>
        )}
      </View>
    </ScrollView>
  );
}
