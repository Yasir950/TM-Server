import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { supabase } from "./supabase";
import { setVoipTokenHandler } from "./callkit";
import { resetSaved } from "./saved";

// Shown while the app is open too; the in-app list already updates, so no sound then
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let token: string | null = null;
let voip: string | null = null;

// One id per installation, so the server can tell this iPhone's VoIP and Expo tokens belong together
async function installationId() {
  let id = await AsyncStorage.getItem("tm:device");
  if (!id) await AsyncStorage.setItem("tm:device", (id = randomUUID()));
  return id;
}

// Asks once, then registers this device's Expo push token for the signed-in user (supabase/migrations/*_mobile_push.sql)
// and, on iPhone, its PushKit VoIP token for lock-screen calls (*_voip_push.sql)
export async function enablePush() {
  if (!Device.isDevice) return;
  const device = await installationId();
  if (Platform.OS === "ios")
    setVoipTokenHandler((t) => {
      voip = t;
      supabase.rpc("save_device_token", { p_token: t, p_platform: "ios_voip", p_device: device }).then();
    });
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("messages", { name: "Messages", importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationChannelAsync("calls", { name: "Calls", importance: Notifications.AndroidImportance.MAX });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await supabase.rpc("save_device_token", { p_token: token, p_platform: Platform.OS, p_device: device });
  } catch {}
}

// Stops pushes to this device for this user, then signs out
export async function signOut() {
  for (const t of [token, voip]) if (t) await supabase.rpc("delete_device_token", { p_token: t }).then(() => {}, () => {});
  token = null;
  voip = null;
  resetSaved();
  await supabase.auth.signOut();
}

// Push links look like /app?c=<channel>&m=<message>[&t=<thread>]; returns the screen to open
export function routeFor(url?: string): string | null {
  const q = new URLSearchParams((url ?? "").split("?")[1] ?? "");
  const task = q.get("task");
  if (task) return `/task/${task}`;
  const ring = q.get("ring");
  if (ring) return `/call/${ring}?from=${q.get("from") ?? ""}`;
  const c = q.get("c");
  if (!c) return null;
  const t = q.get("t");
  const m = q.get("m");
  return t ? `/t/${t}?c=${c}` : m ? `/c/${c}?m=${m}` : `/c/${c}`;
}
