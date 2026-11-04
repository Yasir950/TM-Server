// Lets the web app bring the window out of the tray (src/lib/push.ts) and sign in through the browser (src/components/Auth.tsx)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workchime", {
  show: () => ipcRenderer.send("show"),
  ring: () => ipcRenderer.send("ring"),
  signIn: () => ipcRenderer.send("sign-in"),
  takeAuth: () => ipcRenderer.invoke("take-auth"),
  // A sign-in token arrived; returns an unsubscribe function
  onAuth: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("auth", listener);
    return () => ipcRenderer.removeListener("auth", listener);
  },
});
