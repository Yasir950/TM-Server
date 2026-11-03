// Lets the web app bring the window out of the tray (src/lib/push.ts)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workchime", {
  show: () => ipcRenderer.send("show"),
  ring: () => ipcRenderer.send("ring"),
});
