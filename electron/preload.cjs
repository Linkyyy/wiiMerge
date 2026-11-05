const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("wiiMerge", {
  platform: process.platform,
  choosePath: (kind) => ipcRenderer.invoke("choose-path", kind),
  droppedPath: (file) =>
    ipcRenderer.invoke("dropped-path", webUtils.getPathForFile(file)),
  compare: (request) => ipcRenderer.invoke("compare", request),
  cancel: () => ipcRenderer.invoke("cancel"),
  exportReport: (id, format) =>
    ipcRenderer.invoke("export-report", { id, format }),
  loadRules: () => ipcRenderer.invoke("load-rules"),
  saveRules: (rules) => ipcRenderer.invoke("save-rules", rules),
  importRules: () => ipcRenderer.invoke("import-rules"),
  exportRules: (rules) => ipcRenderer.invoke("export-rules", rules),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
});
