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

let window, activeWorker, lastReport, workspace;
const windowDirty = new Map();
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
      !BrowserWindow.fromWebContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("不允许的调用来源");
    return handler(...args, event);
  });
}

async function setupIPC() {
  const { validateRules, DEFAULT_RULES } = await import("../core/rules.mjs");
  const rulesPath = path.join(app.getPath("userData"), "rules.json");
  const { Workspace } = await import("../core/workspace.mjs");
  workspace = new Workspace(execute, app.getPath("userData"), (report) => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send("progress", { reportUpdated: report });
  });
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
    return workspace.add(result, request);
  });
  handle("adopt-file", async ({ reportId, itemKey, from }, event) => {
    const item = workspace
      .session(reportId)
      .report.items.find((i) => i.key === itemKey);
    if (!item) throw new Error("条目不存在");
    const to = from === "left" ? "右侧" : "左侧";
    if (
      dialog.showMessageBoxSync(BrowserWindow.fromWebContents(event.sender), {
        type: "warning",
        message: `整体替换${to}文件：${item.path}？将保留备份。`,
        buttons: ["取消", "替换"],
        defaultId: 0,
      }) === 0
    )
      return null;
    return workspace.adoptFile(reportId, itemKey, from);
  });
  handle("get-report", (id) => workspace.getReport(id));
  handle("open-document", ({ reportId, itemKey }) =>
    workspace.open(reportId, itemKey),
  );
  handle("preview-document", ({ id, left, right }) =>
    workspace.preview(id, left, right),
  );
  handle("save-document", async ({ id, side, saveAs }, event) => {
    const info = workspace.describe(workspace.document(id));
    let target;
    if (saveAs || !info.sides[side]?.writable) {
      const chosen = await dialog.showSaveDialog(
        BrowserWindow.fromWebContents(event.sender),
        { defaultPath: "merged.txt" },
      );
      if (chosen.canceled) return null;
      target = chosen.filePath;
    }
    return workspace.save(id, side, target);
  });
  handle("dropped-paths", async (paths) => {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 2)
      throw new Error("一次拖入一个或两个路径");
    const results = [];
    for (const filename of paths) {
      const absolute = path.resolve(filename),
        stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error("请选择普通文件或文件夹");
      allowedPaths.add(absolute);
      results.push({
        path: absolute,
        kind: stat.isDirectory() ? "folder" : "file",
      });
    }
    return results;
  });
  handle("window-action", (action, event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (action === "minimize") target.minimize();
    else if (action === "maximize")
      target.isMaximized() ? target.unmaximize() : target.maximize();
    else if (action === "close") target.close();
    return true;
  });
  handle("set-dirty", (value, event) => {
    windowDirty.set(event.sender.id, !!value);
    return true;
  });
  handle("open-diff", async ({ reportId, itemKey }) => {
    workspace.getReport(reportId);
    await createWindow({
      view: "diff",
      report: reportId,
      ...(itemKey ? { item: itemKey } : {}),
    });
    return true;
  });
  handle("cancel", () => {
    activeWorker?.terminate();
    return true;
  });
  handle("export-report", async ({ id, format }) => {
    if (!["html", "xlsx"].includes(format)) throw new Error("不支持的导出格式");
    const exportReport = workspace.getReport(id);
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
      report: exportReport,
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

async function createWindow(query = {}) {
  const created = new BrowserWindow({
    frame: false,
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
  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  created.webContents.on("will-navigate", (event) => event.preventDefault());
  const contentsId = created.webContents.id;
  created.wiimergeReportId = query.report;
  created.on("closed", () => {
    windowDirty.delete(contentsId);
    if (
      query.report &&
      !BrowserWindow.getAllWindows().some(
        (w) => w.wiimergeReportId === query.report,
      )
    )
      workspace.release(query.report);
    if (created === window) {
      for (const child of BrowserWindow.getAllWindows())
        if (child !== created) child.close();
      activeWorker?.terminate();
      window = null;
    }
  });
  if (!query.view) window = created;
  created.on("close", (event) => {
    const affected =
      created === window ? BrowserWindow.getAllWindows() : [created];
    if (
      !created.wiimergeDiscardClosing &&
      affected.some((w) => windowDirty.get(w.webContents.id)) &&
      dialog.showMessageBoxSync(created, {
        type: "warning",
        message: "存在未保存的合并内容，仍要关闭吗？",
        buttons: ["取消", "关闭"],
        defaultId: 0,
      }) === 0
    ) {
      event.preventDefault();
      return;
    }
    if (created === window)
      for (const child of affected) child.wiimergeDiscardClosing = true;
  });
  if (development)
    await created.loadURL(
      "http://127.0.0.1:5173/?" + new URLSearchParams(query),
    );
  else await created.loadFile(path.join(root, "dist/index.html"), { query });
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
