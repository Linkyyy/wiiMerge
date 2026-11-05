// The WebView2 host exposes only dialogs and browser File objects. Comparison
// requests go to an authenticated, per-window loopback service, never the web.
if (!window.wiiMerge && window.chrome?.webview) {
  const pending = new Map();
  let sequence = 0;
  const native = (method, args = {}, objects) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try {
        if (objects) {
          if (!window.chrome.webview.postMessageWithAdditionalObjects)
            throw new Error("当前 WebView2 不支持拖放，请通过选择按钮打开文件");
          window.chrome.webview.postMessageWithAdditionalObjects(
            { id, method, args },
            objects,
          );
        } else window.chrome.webview.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  window.chrome.webview.addEventListener("message", ({ data }) => {
    if (data.type === "window-state") {
      document.documentElement.classList.toggle(
        "window-maximized",
        data.maximized,
      );
      return;
    }
    const operation = pending.get(data.id);
    if (!operation) return;
    pending.delete(data.id);
    if (data.error) operation.reject(new Error(data.error));
    else operation.resolve(data.result);
  });
  const api = async (method, value = {}) => {
    const response = await fetch(`/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "本地服务请求失败");
    return data;
  };
  const progress = new EventSource("/api/progress"),
    listeners = new Set();
  progress.onmessage = (event) => {
    for (const callback of listeners) callback(JSON.parse(event.data));
  };
  window.addEventListener("beforeunload", () => progress.close());
  window.wiiMerge = {
    platform: "win32",
    runtime: "webview2",
    choosePath: (kind) => native("choosePath", { kind }),
    droppedPath: (file) => native("droppedPath", {}, [file]),
    droppedPaths: (files) => native("droppedPaths", {}, [...files]),
    windowAction: (action) => native("windowAction", { action }),
    setDirty: (value) => native("setDirty", { value }),
    openDiff: (value) => native("openDiff", value),
    adoptFile: (reportId, itemKey, from) =>
      native("adoptFile", { reportId, itemKey, from }),
    getReport: (id) => api("report", { id }),
    openDocument: (reportId, itemKey) =>
      api("open-document", { reportId, itemKey }),
    previewDocument: (id, left, right) =>
      api("preview-document", { id, left, right }),
    saveDocument: (id, side, saveAs = false) =>
      native("saveDocument", { id, side, saveAs }),
    compare: (request) => api("compare", request),
    cancel: () => api("cancel"),
    exportReport: (id, format) => native("exportReport", { id, format }),
    loadRules: () => api("load-rules"),
    saveRules: (rules) => api("save-rules", rules),
    importRules: () => native("importRules"),
    exportRules: (rules) => native("exportRules", { rules }),
    onProgress: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
