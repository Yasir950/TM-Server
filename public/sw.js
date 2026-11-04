// Workchime service worker: shows Web Push notifications while the app is closed or in the background,
// and routes clicks back into the app. Pushes come from push_to() in
// supabase/migrations/20261103000000_push_notifications.sql via /api/push/send.

const ICON = "/asset/AppIcon.svg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The app lives at /app; the rest of the origin is the public site
const APP = "/app";
const appWindows = async () =>
  (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((w) => new URL(w.url).pathname.startsWith(APP));
// Push payloads from older servers link to /?…
const toApp = (url) => (url || APP).replace(/^\/(?=\?|$)/, APP);

self.addEventListener("push", (event) => {
  let d;
  try {
    d = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    (async () => {
      if (d.kind === "cancel") return cancel(d);
      // A focused app window already shows its own toast or incoming-call dialog
      if ((await appWindows()).some((w) => w.focused)) return;
      if (d.kind === "call") return ring(d);
      // Same tag as the open app's own notification, so the two replace each other instead of doubling up
      await self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: d.icon || ICON, badge: ICON, data: { url: d.url } });
    })(),
  );
});

// Rings until answered or the call's 30 seconds run out, then turns into a missed call
async function ring(d) {
  const missed = () =>
    self.registration.showNotification(`Missed call from ${d.caller}`, { body: d.where, tag: d.tag, icon: d.icon || ICON, badge: ICON, data: { url: `${APP}?c=${d.channel}` } });
  if (Date.now() >= d.expires) return missed();
  await self.registration.showNotification(d.title, {
    body: d.body,
    tag: d.tag,
    icon: d.icon || ICON,
    badge: ICON,
    requireInteraction: true,
    renotify: true,
    vibrate: [500, 250, 500, 250, 500, 250, 500],
    actions: [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ],
    data: { url: `${APP}?ring=${d.channel}&from=${d.from}&where=${encodeURIComponent(d.where)}`, expires: d.expires },
  });
  await sleep(Math.max(0, d.expires - Date.now()));
  const [still] = await self.registration.getNotifications({ tag: d.tag });
  if (still?.data?.expires === d.expires) {
    still.close();
    await missed();
  }
}

// The caller hung up before anyone answered: stop ringing and leave a missed call
async function cancel(d) {
  const ringing = (await self.registration.getNotifications({ tag: d.tag })).filter((n) => n.data?.expires);
  ringing.forEach((n) => n.close());
  if ((await appWindows()).some((w) => w.focused)) return;
  await self.registration.showNotification(`Missed call from ${d.caller}`, { body: d.where, tag: d.tag, icon: d.icon || ICON, badge: ICON, data: { url: `${APP}?c=${d.channel}` } });
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  n.close();
  if (event.action === "decline") return;
  // A call answered after it stopped ringing just opens the conversation
  const target = toApp(n.data?.url);
  const url = n.data?.expires && Date.now() > n.data.expires ? target.replace(/^\/app\?ring=([^&]+).*/, `${APP}?c=$1`) : target;
  event.waitUntil(
    (async () => {
      const [win] = await appWindows();
      if (!win) return self.clients.openWindow(url);
      await win.focus();
      win.postMessage({ type: "open", url });
    })(),
  );
});
