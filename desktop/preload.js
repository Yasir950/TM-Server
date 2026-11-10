// Lets the web app bring the window out of the tray (src/lib/push.ts) and sign in through the browser (src/components/Auth.tsx)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workchime", {
  show: () => ipcRenderer.send("show"),
  // Incoming call: a window of its own in the middle of the screen (see showRing in main.js)
  ring: (info) => ipcRenderer.send("ring", info),
  ringEnd: () => ipcRenderer.send("ring-end"),
  onRingAction: (cb) => {
    const listener = (_e, action) => cb(action);
    ipcRenderer.on("ring-action", listener);
    return () => ipcRenderer.removeListener("ring-action", listener);
  },
  signIn: () => ipcRenderer.send("sign-in"),
  takeAuth: () => ipcRenderer.invoke("take-auth"),
  // Unread badge on the taskbar/dock icon (src/components/chat/Chat.tsx): a number for DMs and mentions, a dot for
  // other unread channels. Windows shows it as an overlay image, drawn here because the main process has no canvas.
  badge: (count, dot) => ipcRenderer.send("badge", { count, dot, icon: count || dot ? overlay(count) : null }),
  // A sign-in token arrived; returns an unsubscribe function
  onAuth: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("auth", listener);
    return () => ipcRenderer.removeListener("auth", listener);
  },
});

// Red circle with the count (9+ past nine), or a smaller plain dot
function overlay(count) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "#e01e5a";
  g.beginPath();
  g.arc(16, 16, count ? 16 : 10, 0, Math.PI * 2);
  g.fill();
  if (count) {
    const text = count > 9 ? "9+" : String(count);
    g.fillStyle = "#fff";
    g.font = `bold ${text.length > 1 ? 17 : 21}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 16, 17);
  }
  return c.toDataURL("image/png");
}
