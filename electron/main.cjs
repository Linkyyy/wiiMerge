const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
} = require("electron");
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

let window, activeWorker, lastReport;
const allowedPaths = new Set();
const root = path.resolve(__dirname, "..");
const development = !app.isPackaged && process.env.WIIMERGE_DEV === "1";
const workerURL = new URL("../core/worker.mjs", pathToFileURL(__filename));

function execute(data, timeout = 120000) {
  if (activeWorker) return Promise.reject(new Error("已有任务正在运行"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerURL, {
      workerData: data,
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    activeWorker = worker;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeWorker === worker) activeWorker = null;
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(new Error("任务超过 120 秒，已停止。请缩小范围或简化规则。")),
      timeout,
    );
    worker.on("message", (message) => {
      if (message.type === "progress" && window && !window.isDestroyed())
        window.webContents.send("progress", message.value);
      if (message.type === "result") finish(null, message.value);
      if (message.type === "error") finish(new Error(message.message));
    });
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!settled)
        finish(new Error(code === 1 ? "任务已取消" : "后台比较进程意外退出"));
    });
  });
}

function handle(name, handler) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      !window ||
      event.sender.id !== window.webContents.id ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("不允许的调用来源");
    return handler(...args);
  });
}

async function setupIPC() {
  const { validateRules, DEFAULT_RULES } = await import("../core/rules.mjs");
  const rulesPath = path.join(app.getPath("userData"), "rules.json");
  handle("choose-path", async (kind) => {
    if (!["file", "folder"].includes(kind)) throw new Error("无效的选择类型");
    const selected = await dialog.showOpenDialog(window, {
      title: kind === "folder" ? "选择比较文件夹" : "选择比较文件",
      properties: [kind === "folder" ? "openDirectory" : "openFile"],
    });
    if (selected.canceled) return null;
    const filename = path.resolve(selected.filePaths[0]);
    allowedPaths.add(filename);
    return filename;
  });
  handle("dropped-path", async (filename) => {
    if (typeof filename !== "string" || !path.isAbsolute(filename))
      throw new Error("无效的拖放路径");
    const absolute = path.resolve(filename),
      stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error("请选择普通文件或文件夹");
    allowedPaths.add(absolute);
    return { path: absolute, kind: stat.isDirectory() ? "folder" : "file" };
  });
  handle("compare", async (request) => {
    if (!request || typeof request !== "object")
      throw new Error("无效的比较请求");
    if (request.mode !== "text")
      for (const side of ["left", "right"]) {
        if (
          typeof request[side] !== "string" ||
          !allowedPaths.has(path.resolve(request[side]))
        )
          throw new Error("请通过选择按钮或拖放授权读取路径");
      }
    request.rules = validateRules(request.rules);
    const result = await execute({ action: "compare", request });
    lastReport = result;
    return result;
  });
  handle("cancel", () => {
    activeWorker?.terminate();
    return true;
  });
  handle("export-report", async ({ id, format }) => {
    if (!["html", "xlsx"].includes(format)) throw new Error("不支持的导出格式");
    if (!lastReport || lastReport.id !== id)
      throw new Error("请先完成一次比较");
    const selected = await dialog.showSaveDialog(window, {
      title: "导出比较报告",
      defaultPath: `wiiMerge-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [
        {
          name: format === "html" ? "HTML 报告" : "Excel 工作簿",
          extensions: [format],
        },
      ],
    });
    if (selected.canceled) return null;
    const content = await execute({
      action: "export",
      report: lastReport,
      format,
    });
    await fs.writeFile(
      selected.filePath,
      typeof content === "string" ? content : Buffer.from(content),
    );
    return selected.filePath;
  });
  handle("load-rules", async () => {
    try {
      return validateRules(JSON.parse(await fs.readFile(rulesPath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(DEFAULT_RULES);
      throw new Error(`已保存规则读取失败：${error.message}`);
    }
  });
  handle("save-rules", async (input) => {
    const rules = validateRules(input);
    await fs.mkdir(path.dirname(rulesPath), { recursive: true });
    const tmp = rulesPath + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(rules, null, 2), { mode: 0o600 });
    await fs.rename(tmp, rulesPath);
    return rules;
  });
  handle("import-rules", async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: "导入比较规则",
      properties: ["openFile"],
      filters: [{ name: "JSON 规则", extensions: ["json"] }],
    });
    if (selected.canceled) return null;
    const stat = await fs.stat(selected.filePaths[0]);
    if (stat.size > 65536) throw new Error("规则文件不能超过 64 KiB");
    return validateRules(
      JSON.parse(await fs.readFile(selected.filePaths[0], "utf8")),
    );
  });
  handle("export-rules", async (input) => {
    const rules = validateRules(input);
    const selected = await dialog.showSaveDialog(window, {
      title: "导出比较规则",
      defaultPath: "wiiMerge-rules.json",
      filters: [{ name: "JSON 规则", extensions: ["json"] }],
    });
    if (selected.canceled) return null;
    await fs.writeFile(selected.filePath, JSON.stringify(rules, null, 2), {
      mode: 0o600,
    });
    return selected.filePath;
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1050,
    minHeight: 720,
    backgroundColor: "#f6f8fc",
    icon: path.join(root, "build/icon.png"),
    title: "wiiMerge",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    activeWorker?.terminate();
    window = null;
  });
  if (development) await window.loadURL("http://127.0.0.1:5173");
  else await window.loadFile(path.join(root, "dist/index.html"));
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "编辑",
          submenu: [
            { role: "undo", label: "撤销" },
            { role: "redo", label: "重做" },
            { type: "separator" },
            { role: "cut", label: "剪切" },
            { role: "copy", label: "复制" },
            { role: "paste", label: "粘贴" },
            { role: "selectAll", label: "全选" },
          ],
        },
        {
          label: "视图",
          submenu: [
            { role: "resetZoom", label: "实际大小" },
            { role: "zoomIn", label: "放大" },
            { role: "zoomOut", label: "缩小" },
            { role: "togglefullscreen", label: "全屏" },
          ],
        },
      ]),
    );
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            development
              ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:5173"
              : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'",
          ],
        },
      }),
    );
    await setupIPC();
    await createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
