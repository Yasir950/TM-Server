import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import { plainText } from "@/lib/format";
import { sendVoip, voipConfigured } from "@/lib/apns";

type Payload = { kind: "message" | "call" | "cancel" | "handled"; title?: string; body?: string; attachments?: number; url?: string; [k: string]: unknown };

// Called by push_to() in the database over pg_net, never by browsers:
// POST {"subscriptions": [...], "devices": [{token, platform, device}], "payload": {...}} with X-Push-Secret matching PUSH_SECRET
export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) return Response.json({ error: "forbidden" }, { status: 403 });

  const { subscriptions = [], devices: raw = [], payload } = (await req.json().catch(() => ({}))) as {
    subscriptions?: PushSubscription[];
    devices?: (string | Device)[];
    payload?: Payload;
  };
  // Rows from before device_tokens had a platform arrive as bare Expo tokens
  const devices = raw.map((d): Device => (typeof d === "string" ? { token: d, platform: "android", device: null } : d));
  if ((!subscriptions.length && !devices.length) || !payload) return Response.json({ sent: 0 });

  // The database builds app links as /?…; the app lives at /app
  if (typeof payload.url === "string") payload.url = payload.url.replace(/^\/(?=\?|$)/, "/app");

  // Message bodies arrive as raw mrkdwn; send the same one-line preview the app shows
  if (payload.kind === "message") {
    payload.body = plainText(payload.body ?? "").slice(0, 140) || (payload.attachments ? "Sent an attachment" : "");
    delete payload.attachments;
  }

  const supabase = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  // iPhones with a VoIP token ring through CallKit, so they get no ordinary push about the call as well
  const ringKinds = payload.kind === "call" || payload.kind === "cancel" || payload.kind === "handled";
  const voip = voipConfigured() ? devices.filter((d) => d.platform === "ios_voip") : [];
  const voipDevices = new Set(voip.map((d) => d.device).filter(Boolean));
  const expo = devices.filter((d) => d.platform !== "ios_voip" && !(ringKinds && d.platform === "ios" && d.device && voipDevices.has(d.device)));

  const [web, mobile, apple] = await Promise.all([
    sendWeb(subscriptions, payload),
    sendExpo(expo, payload),
    ringKinds && voip.length
      ? sendVoip(
          voip.map((d) => d.token),
          // The channel id doubles as the CallKit call's UUID
          { kind: payload.kind, uuid: payload.channel, channel: payload.channel, from: payload.from, caller: payload.caller ?? "Workchime", where: payload.where, expires: payload.expires },
        )
      : { sent: 0, gone: [] as string[] },
  ]);
  const goneDevices = [...mobile.gone, ...apple.gone];
  if (web.gone.length) await supabase().rpc("drop_push_subscriptions", { p_secret: secret, p_endpoints: web.gone });
  if (goneDevices.length) await supabase().rpc("drop_device_tokens", { p_secret: secret, p_tokens: goneDevices });
  return Response.json({ sent: web.sent + mobile.sent + apple.sent, dropped: web.gone.length + goneDevices.length });
}

type Device = { token: string; platform: "ios" | "android" | "ios_voip"; device: string | null };

async function sendWeb(subscriptions: PushSubscription[], payload: Payload) {
  const gone: string[] = [];
  if (!subscriptions.length || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return { sent: 0, gone };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@workchime.app", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const call = payload.kind === "call" || payload.kind === "cancel";
  const data = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification(s, data, { TTL: call ? 30 : 86400, urgency: call ? "high" : "normal" }).catch((e) => {
        // The browser unsubscribed or the subscription expired
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.endpoint);
        throw e;
      }),
    ),
  );
  return { sent: results.filter((r) => r.status === "fulfilled").length, gone };
}

// The mobile app (mobile/) through Expo's push service, which forwards to APNs and FCM.
// Android gets calls (and their cancel/handled) as data-only messages: the app's background task
// (mobile/lib/callkit.ts) shows its own full-screen incoming-call screen and takes it down again.
// iPhones without a VoIP token get an ordinary notification for a call; cancel/handled are skipped for them.
async function sendExpo(devices: Device[], payload: Payload) {
  const gone: string[] = [];
  const ring = payload.kind === "call" || payload.kind === "cancel" || payload.kind === "handled";
  const targets = devices.filter((d) => !ring || payload.kind === "call" || d.platform === "android");
  if (!targets.length) return { sent: 0, gone };
  const data = { url: payload.url, kind: payload.kind, channel: payload.channel, from: payload.from, caller: payload.caller, where: payload.where, expires: payload.expires, tag: payload.tag };
  const messages = targets.map(({ token: to, platform }) =>
    ring && platform === "android"
      ? { to, data, priority: "high", ttl: 30, _contentAvailable: true }
      : {
          to,
          title: payload.title,
          body: payload.body,
          sound: "default",
          priority: ring ? "high" : "default",
          ttl: ring ? 30 : 86400,
          channelId: ring ? "calls" : "messages",
          data,
        },
  );
  let sent = 0;
  // Expo accepts up to 100 messages per request
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN && { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }) },
      body: JSON.stringify(batch),
    }).catch(() => null);
    const tickets = ((await res?.json().catch(() => null))?.data ?? []) as { status: string; details?: { error?: string } }[];
    tickets.forEach((t, j) => {
      if (t.status === "ok") sent++;
      else if (t.details?.error === "DeviceNotRegistered") gone.push(batch[j].to);
    });
  }
  return { sent, gone };
}
