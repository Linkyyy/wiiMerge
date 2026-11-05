import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { zip } from "../tests/helpers.mjs";
if (process.platform === "win32") {
  await import("./smoke-webview2.mjs");
  process.exit(0);
}
const root = path.resolve(import.meta.dirname, ".."),
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-native-v2-")),
  token = randomBytes(32).toString("hex");
const left = path.join(tmp, "before"),
  right = path.join(tmp, "after");
await fs.mkdir(left);
await fs.mkdir(right);
await fs.writeFile(
  path.join(left, "app.war"),
  await zip({ "lib/app.jar": await zip({ "app.txt": "before" }) }),
);
await fs.writeFile(
  path.join(right, "app.war"),
  await zip({ "lib/app.jar": await zip({ "app.txt": "after" }) }),
);
let child,
  browser,
  ready,
  context,
  selected = [],
  exportPath = path.join(tmp, "report.html");
const windows = [];
async function post(route, value) {
  const r = await fetch(ready.origin + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-WiiMerge-Native": token },
    body: JSON.stringify(value),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
try {
  child = spawn(
    process.execPath,
    [path.join(root, ".native-build/app/server.cjs")],
    {
      env: {
        ...process.env,
        WIIMERGE_NATIVE_TOKEN: token,
        WIIMERGE_DATA_DIR: path.join(tmp, "profile"),
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const lines = createInterface({ input: child.stdout });
  ready = await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Service startup timeout")),
      10000,
    );
    lines.once("line", (line) => {
      clearTimeout(t);
      resolve(JSON.parse(line));
    });
  });
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.exposeFunction("nativeTestRPC", async (req) => {
    const a = req.args;
    if (req.method === "windowAction" || req.method === "setDirty") return true;
    if (req.method === "choosePath")
      return (await post("/native/authorize", { path: selected.shift() })).path;
    if (req.method === "droppedPaths") {
      const paths = selected.splice(0);
      return Promise.all(
        paths.map((p) => post("/native/authorize", { path: p })),
      );
    }
    if (req.method === "openDiff") {
      const page = await context.newPage();
      windows.push(page);
      await page.goto(
        ready.launchURL +
          "?" +
          new URLSearchParams({
            view: "diff",
            report: a.reportId,
            ...(a.itemKey ? { item: a.itemKey } : {}),
          }),
      );
      return true;
    }
    if (req.method === "exportReport")
      return post("/native/export-report", {
        id: a.id,
        format: a.format,
        path: exportPath,
      });
    if (req.method === "saveDocument")
      return post("/native/save-document", {
        id: a.id,
        side: a.side,
        ...(a.saveAs ? { path: exportPath } : {}),
      });
    if (req.method === "adoptFile") return post("/native/adopt-file", a);
    throw new Error("Unsupported test method " + req.method);
  });
  await context.addInitScript(() => {
    const listeners = new Set();
    const send = (req) =>
      window
        .nativeTestRPC(req)
        .then((result) => {
          for (const fn of listeners) fn({ data: { id: req.id, result } });
        })
        .catch((error) => {
          for (const fn of listeners)
            fn({ data: { id: req.id, error: error.message } });
        });
    window.chrome.webview = {
      postMessage: send,
      postMessageWithAdditionalObjects: send,
      addEventListener: (_, fn) => listeners.add(fn),
      removeEventListener: (_, fn) => listeners.delete(fn),
    };
  });
  const page = await context.newPage();
  await page.goto(ready.launchURL);
  await page.locator(".mode-tabs").waitFor();
  selected = [left, right];
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([""], "before"));
    transfer.items.add(new File([""], "after"));
    document.querySelector(".app-shell").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
  await expect(page.getByRole("tab", { name: "文件夹比较" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "左侧路径" })).toHaveValue(
    left,
  );
  await expect(page.getByRole("textbox", { name: "右侧路径" })).toHaveValue(
    right,
  );
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.locator(".comparison-overview").waitFor();
  await page.getByRole("button", { name: "打开独立差分窗口" }).click();
  await expect.poll(() => windows.length).toBe(1);
  const diff = windows[0];
  await diff.locator(".nav-tree-row").filter({ hasText: "app.war" }).dblclick();
  await expect(diff.locator(".document-tabs>div")).toHaveCount(2);
  await diff.getByRole("button", { name: "打开差分", exact: true }).click();
  await diff.locator(".merge-table").waitFor();
  await expect(diff.locator(".merge-table")).toContainText("before");
  await expect(diff.locator(".merge-table")).toContainText("after");
  await diff.getByRole("button", { name: "使用左边", exact: true }).click();
  await expect(diff.locator(".editor-equal")).toBeVisible();
  await diff.getByRole("button", { name: "HTML 报告", exact: true }).click();
  await expect(diff.getByRole("status")).toContainText("已导出");
  const html = await fs.readFile(exportPath, "utf8");
  if (
    !html.includes("差分一览") ||
    !html.includes("未保存") ||
    !html.includes("app.txt")
  )
    throw new Error("Draft export incomplete");
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await diff.screenshot({
    path: path.join(root, "artifacts/native-tabs-merge.png"),
  });
  console.log(
    "PASS: dual-folder drop, separate native view, archive Tabs, staged hunk merge and complete draft report",
  );
} finally {
  await browser?.close();
  child?.stdin?.end();
  if (child && child.exitCode === null)
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill();
        resolve();
      }, 5000).unref();
    });
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
