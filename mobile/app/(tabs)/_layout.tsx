import { ActionSheetIOS, Alert, Platform, Pressable, Text } from "react-native";
import { Tabs, router } from "expo-router";
import { useChat } from "@/lib/store";
import { C } from "@/components/ui";

const NEW: [string, string][] = [
  ["New message", "/new-dm"],
  ["Create a channel", "/new-channel"],
  ["Browse channels", "/browse"],
];
function newMenu() {
  if (Platform.OS === "ios")
    ActionSheetIOS.showActionSheetWithOptions({ options: [...NEW.map(([t]) => t), "Cancel"], cancelButtonIndex: NEW.length }, (i) => NEW[i] && router.push(NEW[i][1]));
  else Alert.alert("New", undefined, [...NEW.map(([text, to]) => ({ text, onPress: () => router.push(to) })), { text: "Cancel", style: "cancel" as const }]);
}

const icon = (glyph: string) => ({ color }: { color: string }) => <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;

export default function TabsLayout() {
  const { unread, threadUnread, channels, memberships, company, notifications } = useChat();
  const activity =
    Object.entries(unread).reduce((n, [id, u]) => n + (memberships[id]?.muted || channels[id]?.kind === "dm" ? 0 : u.mentions), 0) +
    Object.values(threadUnread).reduce((n, t) => n + t.mentions, 0) +
    notifications.filter((x) => !x.read_at).length;
  const dmUnread = Object.entries(unread).filter(([id, u]) => channels[id]?.kind === "dm" && u.unread && !memberships[id]?.muted).length;
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: C.brand }, headerTintColor: "#fff", tabBarActiveTintColor: C.brand }}>
      <Tabs.Screen
        name="index"
        options={{
          title: company?.name ?? "Home",
          tabBarLabel: "Home",
          tabBarIcon: icon("⌂"),
          headerRight: () => (
            <Pressable onPress={newMenu} hitSlop={10} style={{ marginRight: 16 }}>
              <Text style={{ color: "#fff", fontSize: 26 }}>＋</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="dms" options={{ title: "Direct messages", tabBarLabel: "DMs", tabBarIcon: icon("✉"), tabBarBadge: dmUnread || undefined }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: icon("🔔"), tabBarBadge: activity || undefined }} />
      <Tabs.Screen name="you" options={{ title: "You", tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
