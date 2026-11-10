// The screen-share picker (picker.html): reads the screens and windows, and answers with the one chosen (or null)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  sources: () => ipcRenderer.invoke("picker-sources"),
  choose: (id) => ipcRenderer.send("picker-choice", id),
});
