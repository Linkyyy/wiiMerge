import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import ExcelJS from "exceljs";
import { zip, workbook } from "../tests/helpers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".native-build");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-webview2-"));
const fixtureFile = path.join(tmp, "dialogs.json");
const artifacts = path.join(root, "artifacts");
await fs.mkdir(artifacts, { recursive: true });
await fs.writeFile(fixtureFile, "{}");
let browser, child, ready, nativeToken, page;
const errors = [];
const windows = process.platform === "win32";

async function post(route, input) {
  const response = await fetch(ready.origin + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WiiMerge-Native": nativeToken,
    },
    body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}
async function configure(key, filename) {
  await fs.writeFile(fixtureFile, JSON.stringify({ [key]: filename }));
}
try {
  if (windows) {
    const socket = net.createServer();
    // Stay below Windows' ephemeral port range so the engine's listen(0)
    // cannot reuse the released debugging port before WebView2 starts.
    await new Promise((resolve) =>
      socket.listen(
        9222 + Math.floor(Math.random() * 1000),
        "127.0.0.1",
        resolve,
      ),
    );
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    child = spawn(
      path.join(output, "wiiMerge.exe"),
      [
        `--smoke-fixtures=${fixtureFile}`,
        `--profile=${path.join(tmp, "profile")}`,
      ],
      {
        env: {
          ...process.env,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        },
        stdio: "ignore",
      },
    );
    const deadline = Date.now() + 45000;
    let connected = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) {
          connected = true;
          break;
        }
      } catch {}
      if (child.exitCode !== null)
        throw new Error(`WebView2 host exited: ${child.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!connected)
      throw new Error("WebView2 debugging endpoint did not start");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const targetDeadline = Date.now() + 20000;
    while (!page && Date.now() < targetDeadline) {
      page = browser.contexts()[0]?.pages()[0];
      if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!page) throw new Error("WebView2 did not create a page");
  } else {
    nativeToken = randomBytes(32).toString("hex");
    child = spawn(process.execPath, [path.join(output, "app/server.cjs")], {
      env: {
        ...process.env,
        WIIMERGE_NATIVE_TOKEN: nativeToken,
        WIIMERGE_DATA_DIR: path.join(tmp, "profile"),
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const lines = createInterface({ input: child.stdout });
    ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Service did not start")),
        15000,
      );
      lines.once("line", (line) => {
        clearTimeout(timeout);
        resolve(JSON.parse(line));
      });
      child.once("exit", (code) =>
        reject(new Error(`Service exited: ${code}`)),
      );
    });
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    await context.exposeFunction("nativeTestRPC", async (request) => {
      const args = request.args,
        selected = JSON.parse(await fs.readFile(fixtureFile, "utf8"));
      if (request.method === "choosePath")
        return (await post("/native/authorize", { path: selected.open })).path;
      if (request.method === "exportReport")
        return post("/native/export-report", { ...args, path: selected.save });
      if (request.method === "importRules")
        return post("/native/import-rules", { path: selected.open });
      if (request.method === "exportRules")
        return post("/native/export-rules", { ...args, path: selected.save });
      throw new Error("Unsupported test dialog");
    });
    await context.addInitScript(() => {
      const listeners = new Set();
      window.chrome.webview = {
        addEventListener: (_name, callback) => listeners.add(callback),
        postMessage: (request) =>
          window
            .nativeTestRPC(request)
            .then((result) => {
              for (const fn of listeners)
                fn({ data: { id: request.id, result } });
            })
            .catch((error) => {
              for (const fn of listeners)
                fn({ data: { id: request.id, error: error.message } });
            }),
      };
    });
    page = await context.newPage();
    await page.goto(ready.launchURL);
  }
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("heading", { name: "让每一处差异，都清晰可见。" })
    .waitFor();
  await page.getByRole("button", { name: "用一段示例体验文本比较" }).click();
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await expect(page.locator(".text-diff tr.changed")).toHaveCount(3);
  console.log(
    "PASS: native bridge, HTTP worker comparison and character-level UI",
  );

  await page.getByRole("button", { name: "比较规则", exact: true }).click();
  await page.getByRole("dialog").getByPlaceholder("例如 A 或 A,B").fill("A");
  await page.getByRole("button", { name: "保存规则" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("输入或规则已更改，请重新比较")).toBeVisible();

  const a = path.join(tmp, "a.xlsx"),
    b = path.join(tmp, "b.xlsx");
  await fs.writeFile(
    a,
    await workbook({
      订单: [
        ["ID", "Value"],
        [1, 100],
        [2, 200],
      ],
    }),
  );
  await fs.writeFile(
    b,
    await workbook({
      订单: [
        ["ID", "Value"],
        [2, 220],
        [1, 100],
      ],
    }),
  );
  await page.getByRole("tab", { name: "文件比较", exact: true }).click();
  const choose = async (index, filename, folder = false) => {
    await configure("open", filename);
    await page
      .getByRole("button", {
        name: folder ? "选择文件夹" : "选择文件",
        exact: true,
      })
      .nth(index)
      .click();
  };
  await choose(0, a);
  await choose(1, b);
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await expect(page.locator(".excel-diff tbody tr")).toHaveCount(1);
  await expect(page.locator(".excel-diff")).toContainText("220");
  console.log(
    "PASS: host-authorized file selection and Excel key-row matching",
  );

  for (const [format, label] of [
    ["html", "HTML 报告"],
    ["xlsx", "Excel 报告"],
  ]) {
    const target = path.join(tmp, `report.${format}`);
    await configure("save", target);
    await page.getByRole("button", { name: "导出报告" }).click();
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `报告已导出到 ${target}` }),
    ).toBeVisible();
    if (format === "html") {
      if (!(await fs.readFile(target, "utf8")).includes("220"))
        throw new Error("HTML data missing");
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(target);
      if (wb.getWorksheet("Excel差异").getCell("I2").value !== "220")
        throw new Error("Excel data missing");
    }
  }
  console.log(
    "PASS: native save dialogs and independently read HTML/Excel reports",
  );
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
  await fs.writeFile(path.join(left, "same.txt"), "same");
  await fs.writeFile(path.join(right, "same.txt"), "same");
  await page.getByRole("tab", { name: "文件夹比较", exact: true }).click();
  await choose(0, left, true);
  await choose(1, right, true);
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await expect(page.locator(".file-item")).toHaveCount(2);
  await expect(page.locator(".file-list")).toContainText("app.txt");
  await page.screenshot({ path: path.join(artifacts, "webview2-folders.png") });
  console.log("PASS: native folder dialogs and nested WAR/JAR comparison");
  const denied = await page.evaluate(async () => {
    try {
      await window.wiiMerge.compare({
        mode: "files",
        left: "C:\\Windows\\win.ini",
        right: "C:\\Windows\\win.ini",
      });
      return false;
    } catch {
      return true;
    }
  });
  if (!denied) throw new Error("Unselected path was readable");
  if (windows) {
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "native-drop-test";
      document.body.append(input);
    });
    await page.locator("#native-drop-test").setInputFiles(a);
    const dropped = await page.evaluate(() =>
      window.wiiMerge.droppedPath(
        document.getElementById("native-drop-test").files[0],
      ),
    );
    if (dropped.path.toLowerCase() !== a.toLowerCase())
      throw new Error("WebView2 file drop path mismatch");
    console.log(
      "PASS: WebView2 additional File objects authorize real dropped paths",
    );
  }
  console.log("PASS: unselected paths remain blocked");
  await page.getByRole("tab", { name: "文件比较", exact: true }).click();
  const longA = path.join(tmp, "long-a.txt"),
    longB = path.join(tmp, "long-b.txt");
  await fs.writeFile(longA, "left\n".repeat(10000));
  await fs.writeFile(longB, "right\n".repeat(10000));
  await choose(0, longA);
  await choose(1, longB);
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.getByRole("button", { name: "取消比较" }).click();
  await expect(page.getByRole("alert")).toContainText("已取消");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("PASS: native task cancellation and no uncaught page errors");
} catch (error) {
  let hostError = "";
  try {
    hostError = await fs.readFile(path.join(tmp, "host-error.txt"), "utf8");
  } catch {}
  try {
    hostError +=
      "\nStartup stages:\n" +
      (await fs.readFile(path.join(tmp, "host-state.txt"), "utf8"));
  } catch {}
  console.error(
    "::error::" +
      (hostError || error.message).replaceAll("\r", "").replaceAll("\n", "%0A"),
  );
  throw error;
} finally {
  if (windows && child) {
    await new Promise((resolve) => {
      const close = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`,
        ],
        { stdio: "ignore" },
      );
      close.on("exit", resolve);
    });
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once("exit", resolve);
        setTimeout(() => {
          if (child.exitCode === null) {
            const kill = spawn(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { stdio: "ignore" },
            );
            kill.on("exit", resolve);
          } else resolve();
        }, 6000);
      }
    });
  } else {
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
  }
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}
