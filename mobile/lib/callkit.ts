import { AppState, Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";
import VoipPushNotification from "react-native-voip-push-notification";
import notifee, { AndroidCategory, AndroidForegroundServiceType, AndroidImportance, AndroidVisibility, EventType, type Event } from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { supabase } from "./supabase";

// The phone's own incoming-call screen, for rings that arrive while the app is closed or the phone is locked.
// iOS: PushKit VoIP push → CallKit (reported natively in AppDelegate, see plugins/withVoip.js; the channel id is the call UUID).
// Android: data-only push → background task → full-screen notification with Answer/Decline (notifee).
// Loaded from index.js before the app, so it also runs headless when a push wakes the app.

type Ring = { channel: string; from?: string; caller?: string; where?: string; kind?: string; expires?: number };
// answered: the person picked up; otherwise they tapped the ring and should see Answer/Decline in the app
export type SystemAnswer = { channel: string; from?: string; answered: boolean };

let pendingAnswer: SystemAnswer | null = null;
const answerListeners = new Set<(a: SystemAnswer) => void>();
const hangupListeners = new Set<(channel: string) => void>();

function emitAnswer(a: SystemAnswer) {
  if (answerListeners.size) answerListeners.forEach((l) => l(a));
  else pendingAnswer = a;
}
// The call provider listens once it's up; an answer from a cold start waits for it
export function onSystemAnswer(cb: (a: SystemAnswer) => void) {
  answerListeners.add(cb);
  if (pendingAnswer) {
    const a = pendingAnswer;
    pendingAnswer = null;
    cb(a);
  }
  return () => {
    answerListeners.delete(cb);
  };
}
// Hung up from the system call screen (iOS lock screen, CarPlay, headset)
export function onSystemHangup(cb: (channel: string) => void) {
  hangupListeners.add(cb);
  return () => {
    hangupListeners.delete(cb);
  };
}

// Declining needs no running app: the decline goes over Realtime's REST broadcast, the handled ring over an RPC
async function declineRing(channel: string, from?: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const uid = data.session.user.id;
  if (from) await supabase.channel("huddles").send({ type: "broadcast", event: "decline", payload: { to: from, from: uid, channelId: channel } });
  await supabase.channel("huddles").send({ type: "broadcast", event: "ring-handled", payload: { to: uid, channelId: channel } });
  await supabase.rpc("push_ring_handled", { p_channel: channel, p_answered: false });
}

// iOS: CallKit ---------------------------------------------------------------------------------

// Calls CallKit is showing or running, by channel id, with the ring they came from
const systemCalls = new Map<string, Ring & { answered?: boolean }>();
// Calls this app ended itself, so their endCall event isn't taken for the person hanging up
const endingHere = new Set<string>();
let voipToken: string | null = null;
let onVoipToken: ((t: string) => void) | null = null;

export function setVoipTokenHandler(fn: (t: string) => void) {
  onVoipToken = fn;
  if (voipToken) fn(voipToken);
  if (Platform.OS === "ios") VoipPushNotification.registerVoipToken();
}

if (Platform.OS === "ios") {
  RNCallKeep.setup({
    ios: { appName: "Workchime", supportsVideo: true, maximumCallGroups: "1", maximumCallsPerCallGroup: "1", includesCallsInRecents: false },
    android: { alertTitle: "", alertDescription: "", cancelButton: "", okButton: "", additionalPermissions: [] },
  }).catch(() => {});

  const displayed = (uuid: string, payload?: Record<string, unknown>) => {
    const channel = uuid.toLowerCase();
    if (payload?.kind && payload.kind !== "call") return;
    systemCalls.set(channel, { channel, from: payload?.from as string | undefined, caller: payload?.caller as string | undefined });
  };
  const answered = (uuid: string) => {
    const channel = uuid.toLowerCase();
    const c = systemCalls.get(channel);
    if (c) c.answered = true;
    emitAnswer({ channel, from: c?.from, answered: true });
  };
  const ended = (uuid: string) => {
    const channel = uuid.toLowerCase();
    const c = systemCalls.get(channel);
    systemCalls.delete(channel);
    if (endingHere.delete(channel) || !c) return;
    if (c.answered) hangupListeners.forEach((l) => l(channel));
    else declineRing(channel, c.from);
  };

  RNCallKeep.addEventListener("didDisplayIncomingCall", ({ callUUID, payload }) => displayed(callUUID, payload as Record<string, unknown>));
  RNCallKeep.addEventListener("answerCall", ({ callUUID }) => answered(callUUID));
  RNCallKeep.addEventListener("endCall", ({ callUUID }) => ended(callUUID));
  // Events from before JS loaded (a VoIP push that launched the app)
  RNCallKeep.addEventListener("didLoadWithEvents", (events) => {
    for (const e of events ?? []) {
      const d = e.data as { callUUID?: string; payload?: Record<string, unknown> };
      if (!d?.callUUID) continue;
      if (e.name === "RNCallKeepDidDisplayIncomingCall") displayed(d.callUUID, d.payload);
      else if (e.name === "RNCallKeepPerformAnswerCallAction") answered(d.callUUID);
      else if (e.name === "RNCallKeepPerformEndCallAction") ended(d.callUUID);
    }
  });

  const gotToken = (t: string) => {
    voipToken = t;
    onVoipToken?.(t);
  };
  VoipPushNotification.addEventListener("register", gotToken);
  VoipPushNotification.addEventListener("didLoadWithEvents", (events) => {
    for (const e of events ?? []) if (e.name === VoipPushNotification.RNVoipPushRemoteNotificationsRegisteredEvent) gotToken(e.data as string);
  });
}

// Android: full-screen incoming call -------------------------------------------------------------

const callNotification = (channel: string) => `call:${channel}`;

async function showIncomingCall(r: Ring) {
  await notifee.createChannel({ id: "incoming-calls", name: "Incoming calls", importance: AndroidImportance.HIGH, visibility: AndroidVisibility.PUBLIC, vibration: true, sound: "default" });
  await notifee.displayNotification({
    id: callNotification(r.channel),
    title: `${r.caller ?? "Someone"} is calling`,
    body: r.where ? `in ${r.where}` : "Meet",
    data: { channel: r.channel, from: r.from ?? "" },
    android: {
      channelId: "incoming-calls",
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      ongoing: true,
      loopSound: true,
      autoCancel: false,
      timeoutAfter: Math.max(1000, (r.expires ?? Date.now() + 30_000) - Date.now()),
      // Over the lock screen, like a phone call
      fullScreenAction: { id: "default", launchActivity: "default" },
      pressAction: { id: "default", launchActivity: "default" },
      actions: [
        { title: "Decline", pressAction: { id: "decline" } },
        { title: "Answer", pressAction: { id: "answer", launchActivity: "default" } },
      ],
    },
  });
}

const cancelIncomingCall = (channel: string) => notifee.cancelNotification(callNotification(channel)).catch(() => {});

async function onNotifee({ type, detail }: Event) {
  const d = detail.notification?.data as { channel?: string; from?: string } | undefined;
  if (!d?.channel || !detail.notification?.id?.startsWith("call:")) return;
  const from = d.from || undefined;
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "decline") {
    await cancelIncomingCall(d.channel);
    await declineRing(d.channel, from);
  } else if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "answer") {
    await cancelIncomingCall(d.channel);
    emitAnswer({ channel: d.channel, from, answered: true });
  } else if (type === EventType.PRESS) {
    await cancelIncomingCall(d.channel);
    emitAnswer({ channel: d.channel, from, answered: false });
  }
}

// Data-only pushes (calls and their cancel/handled), also while the app is closed
const CALL_TASK = "workchime-call-push";
function parsePush(data: unknown): Ring | null {
  const x = data as { data?: unknown; body?: unknown; notification?: { data?: unknown } } | undefined;
  const raw = (x?.data as { body?: unknown } | undefined)?.body ?? x?.data ?? x?.notification?.data ?? x?.body;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return o && typeof o === "object" && "channel" in o ? (o as Ring) : null;
  } catch {
    return null;
  }
}

if (Platform.OS === "android") {
  TaskManager.defineTask(CALL_TASK, async ({ data, error }) => {
    if (error) return;
    const r = parsePush(data);
    if (!r?.channel) return;
    if (r.kind === "call") {
      // An open app rings in-app over Realtime instead
      if (AppState.currentState === "active" || (r.expires && Date.now() > r.expires)) return;
      await showIncomingCall(r);
    } else if (r.kind === "cancel" || r.kind === "handled") await cancelIncomingCall(r.channel);
  });
  Notifications.registerTaskAsync(CALL_TASK).catch(() => {});
  notifee.onBackgroundEvent(onNotifee);
  notifee.onForegroundEvent(onNotifee);
  // Opened from the call screen or its Answer button from a cold start
  notifee.getInitialNotification().then((n) => {
    const d = n?.notification.data as { channel?: string; from?: string } | undefined;
    if (!d?.channel || !n?.notification.id?.startsWith("call:")) return;
    cancelIncomingCall(d.channel);
    emitAnswer({ channel: d.channel, from: d.from || undefined, answered: n.pressAction.id === "answer" });
  });
  // Screen sharing needs a running foreground service (see startShareService)
  notifee.registerForegroundService(() => new Promise(() => {}));
}

// Shared by both platforms ---------------------------------------------------------------------------

export const systemRinging = (channel: string) => Platform.OS === "ios" && !!systemCalls.get(channel) && !systemCalls.get(channel)!.answered;

// Answered in the app while the system screen also rang: CallKit takes the call over (and its audio session)
export function answerSystemCall(channel: string) {
  if (Platform.OS === "ios" && systemCalls.has(channel) && !systemCalls.get(channel)!.answered) {
    systemCalls.get(channel)!.answered = true;
    RNCallKeep.answerIncomingCall(channel.toUpperCase());
  }
  if (Platform.OS === "android") cancelIncomingCall(channel);
}

// The ring stopped (answered elsewhere, declined, cancelled) or the call ended in the app
export function endSystemCall(channel: string) {
  if (Platform.OS === "android") return void cancelIncomingCall(channel);
  if (!systemCalls.has(channel)) return;
  endingHere.add(channel);
  systemCalls.delete(channel);
  RNCallKeep.endCall(channel.toUpperCase());
}

// Android: MediaProjection only runs inside a foreground service of that type
export async function startShareService() {
  if (Platform.OS !== "android") return;
  await notifee.createChannel({ id: "screen-share", name: "Screen sharing", importance: AndroidImportance.LOW });
  await notifee.displayNotification({
    id: "screen-share",
    title: "Sharing your screen",
    body: "Everyone in the Meet can see your screen",
    android: { channelId: "screen-share", asForegroundService: true, ongoing: true, foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION] },
  });
}
export const stopShareService = () => {
  if (Platform.OS === "android") notifee.stopForegroundService().catch(() => {});
};
