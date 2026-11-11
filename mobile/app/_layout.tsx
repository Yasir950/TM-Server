import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import * as Linking from "expo-linking";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { ChatProvider, useChat } from "@/lib/store";
import { enablePush, routeFor } from "@/lib/push";
import { CallProvider } from "@/lib/calls";
import CallOverlays from "@/components/CallOverlays";
import SignIn from "@/components/SignIn";
import { C } from "@/components/ui";

const Loading = () => (
  <View style={{ flex: 1, justifyContent: "center" }}>
    <ActivityIndicator color={C.brand} />
  </View>
);

export default function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Loading />;
  if (!session) return <SignIn />;
  return (
    <ChatProvider key={session.user.id} uid={session.user.id} fallback={<Loading />}>
      <CallProvider>
      <StatusBar style="light" />
      <Signals />
      <Stack screenOptions={{ headerStyle: { backgroundColor: C.brand }, headerTintColor: "#fff", headerBackTitle: "Back" }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="c/[id]" />
        <Stack.Screen name="t/[id]" options={{ title: "Thread" }} />
        <Stack.Screen name="details/[id]" options={{ title: "Details" }} />
        <Stack.Screen name="member/[id]" options={{ title: "Profile" }} />
        <Stack.Screen name="browse" options={{ title: "Browse channels" }} />
        <Stack.Screen name="new-channel" options={{ title: "Create a channel", presentation: "modal" }} />
        <Stack.Screen name="new-dm" options={{ title: "New message", presentation: "modal" }} />
        <Stack.Screen name="search" options={{ title: "Search" }} />
        <Stack.Screen name="saved" options={{ title: "Saved" }} />
        <Stack.Screen name="threads" options={{ title: "Threads" }} />
        <Stack.Screen name="status" options={{ title: "Set a status", presentation: "modal" }} />
        <Stack.Screen name="profile" options={{ title: "Edit profile" }} />
        <Stack.Screen name="reminders" options={{ title: "Reminders" }} />
        <Stack.Screen name="meetings" options={{ title: "Meetings" }} />
        <Stack.Screen name="schedule" options={{ title: "Schedule a meeting", presentation: "modal" }} />
        <Stack.Screen name="projects" options={{ title: "Projects" }} />
        <Stack.Screen name="new-project" options={{ title: "Create a project", presentation: "modal" }} />
        <Stack.Screen name="project/[id]" options={{ title: "Project" }} />
        <Stack.Screen name="project-settings/[id]" options={{ title: "Project settings" }} />
        <Stack.Screen name="new-task" options={{ title: "Create a task", presentation: "modal" }} />
        <Stack.Screen name="task/[id]" options={{ title: "Task" }} />
        <Stack.Screen name="tasks" options={{ title: "My tasks" }} />
        <Stack.Screen name="call/[id]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="workspace" options={{ title: "Add a company", presentation: "modal" }} />
        <Stack.Screen name="company" options={{ title: "Company" }} />
        <Stack.Screen name="invite" options={{ title: "Invite people", presentation: "modal" }} />
        <Stack.Screen name="admin" options={{ title: "Admin" }} />
        <Stack.Screen name="super-admin" options={{ title: "Super admin" }} />
        <Stack.Screen name="canvas/[id]" options={{ title: "Canvas" }} />
      </Stack>
      <CallOverlays />
      </CallProvider>
    </ChatProvider>
  );
}

// Registers for push once signed in, and opens the conversation a tapped notification points at
function Signals() {
  const { uid, reload } = useChat();
  const last = Notifications.useLastNotificationResponse();
  const url = Linking.useURL();

  // Invite links opened in the app (workchime://app?invite=…) join the company right away
  useEffect(() => {
    const token = url && new URLSearchParams(url.split("?")[1] ?? "").get("invite");
    if (!token) return;
    supabase.rpc("accept_invite", { p_token: token }).then(({ error }) => {
      if (error) Alert.alert("Couldn't join", error.message);
      else reload();
    });
  }, [url, reload]);

  useEffect(() => {
    enablePush();
  }, [uid]);

  useEffect(() => {
    const data = (last?.notification.request.content.data ?? {}) as { url?: string; kind?: string; channel?: string; from?: string; expires?: number };
    // An incoming-call push opens the ring screen while the ring is still live; later it's just the conversation
    if (data.kind === "call" && data.channel) {
      if (!data.expires || Date.now() < data.expires) router.push(`/call/${data.channel}?from=${data.from ?? ""}`);
      else router.push(`/c/${data.channel}`);
      return;
    }
    const to = routeFor(data.url);
    if (to) router.push(to);
  }, [last]);

  return null;
}
