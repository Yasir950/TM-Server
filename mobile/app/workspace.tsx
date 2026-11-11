import { ScrollView } from "react-native";
import { router } from "expo-router";
import { WorkspaceForm } from "@/components/WorkspaceForm";
import { C } from "@/components/ui";

export default function Workspace() {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <WorkspaceForm onDone={() => router.back()} />
    </ScrollView>
  );
}
