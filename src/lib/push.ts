import { supabase } from "./supabase";

// Web Push lets public/sw.js show messages and calls while the app is closed. The desktop app has no push
// service; it stays running in the tray instead and exposes this bridge (desktop/preload.js).
declare global {
  interface Window {
    workchime?: {
      show: () => void;
      ring: () => void;
      // Browser sign-in (components/Auth.tsx DesktopSignIn); absent in desktop builds before 1.1.0
      signIn?: () => void;
      takeAuth?: () => Promise<string | null>;
      onAuth?: (cb: () => void) => () => void;
      // Taskbar/dock unread badge (components/chat/Chat.tsx Rail); absent in desktop builds before 1.2.0
      badge?: (count: number, dot: boolean) => void;
    };
  }
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const pushSupported = () => !!VAPID && "serviceWorker" in navigator && "PushManager" in window && !window.workchime;

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && new Uint8Array(a).every((x, i) => x === b[i]) && a.byteLength === b.length;

// Subscribes this browser for the signed-in user. Safe to call on every load; does nothing until notifications are allowed.
export async function enablePush() {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    const key = fromBase64Url(VAPID!);
    let sub = await reg.pushManager.getSubscription();
    // Subscribed under an older VAPID key: the server can no longer reach it
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const { endpoint, keys } = sub.toJSON();
    await supabase.rpc("save_push_subscription", { p_endpoint: endpoint, p_p256dh: keys!.p256dh, p_auth: keys!.auth });
  } catch {}
}

// Stops pushes for this user on this browser, then signs out
export async function signOut() {
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
    if (sub) await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
  } catch {}
  await supabase.auth.signOut();
}

// Brings the app forward from a notification click, including out of the desktop tray
export function focusApp() {
  window.workchime?.show();
  window.focus();
}
