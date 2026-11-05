const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("wiiMerge", {
  platform: process.platform,
  windowAction: (action) => ipcRenderer.invoke("window-action", action),
  setDirty: (value) => ipcRenderer.invoke("set-dirty", value),
  openDiff: (value) => ipcRenderer.invoke("open-diff", value),
  getReport: (id) => ipcRenderer.invoke("get-report", id),
  adoptFile: (reportId, itemKey, from) =>
    ipcRenderer.invoke("adopt-file", { reportId, itemKey, from }),
  openDocument: (reportId, itemKey) =>
    ipcRenderer.invoke("open-document", { reportId, itemKey }),
  previewDocument: (id, left, right) =>
    ipcRenderer.invoke("preview-document", { id, left, right }),
  saveDocument: (id, side, saveAs) =>
    ipcRenderer.invoke("save-document", { id, side, saveAs }),
  droppedPaths: (files) =>
    ipcRenderer.invoke(
      "dropped-paths",
      [...files].map((file) => webUtils.getPathForFile(file)),
    ),
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
