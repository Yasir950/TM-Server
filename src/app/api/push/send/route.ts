import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import { plainText } from "@/lib/format";

// Called by push_to() in the database over pg_net, never by browsers:
// POST {"subscriptions": [...], "payload": {...}} with X-Push-Secret matching PUSH_SECRET
export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return Response.json({ error: "vapid_not_configured" }, { status: 503 });

  const { subscriptions, payload } = (await req.json().catch(() => ({}))) as {
    subscriptions?: PushSubscription[];
    payload?: { kind: "message" | "call" | "cancel"; body?: string; attachments?: number; [k: string]: unknown };
  };
  if (!subscriptions?.length || !payload) return Response.json({ sent: 0 });

  // Message bodies arrive as raw mrkdwn; send the same one-line preview the app shows
  if (payload.kind === "message") {
    payload.body = plainText(payload.body ?? "").slice(0, 140) || (payload.attachments ? "Sent an attachment" : "");
    delete payload.attachments;
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@workchime.app", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const call = payload.kind === "call" || payload.kind === "cancel";
  const data = JSON.stringify(payload);
  const gone: string[] = [];
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification(s, data, { TTL: call ? 30 : 86400, urgency: call ? "high" : "normal" }).catch((e) => {
        // The browser unsubscribed or the subscription expired
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.endpoint);
        throw e;
      }),
    ),
  );

  if (gone.length) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await supabase.rpc("drop_push_subscriptions", { p_secret: secret, p_endpoints: gone });
  }
  return Response.json({ sent: results.filter((r) => r.status === "fulfilled").length, dropped: gone.length });
}
