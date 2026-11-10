// The incoming-call window (ring.html): who is calling, and Answer or Decline back to the app
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ring", {
  info: () => ipcRenderer.invoke("ring-info"),
  answer: () => ipcRenderer.send("ring-action", "answer"),
  decline: () => ipcRenderer.send("ring-action", "decline"),
});
