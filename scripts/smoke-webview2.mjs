import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import ExcelJS from "exceljs";
import { zip, workbook, legacyWorkbook } from "../tests/helpers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-native-ui-"));
const artifacts = path.join(root, "artifacts");
await fs.mkdir(artifacts, { recursive: true });
const a = path.join(tmp, "a.txt"),
  b = path.join(tmp, "b.txt"),
  left = path.join(tmp, "before"),
  right = path.join(tmp, "after");
const xlA = path.join(tmp, "legacy.xls"),
  xlB = path.join(tmp, "modern.xlsx");
const before = Array.from({ length: 2000 }, (_, i) => `line-${i}`),
  after = [...before];
before[5] = "left-first";
after[5] = "right-first";
before[1850] = "left-last";
after[1850] = "right-last";
await fs.writeFile(a, before.join("\n") + "\n");
await fs.writeFile(b, after.join("\r\n") + "\r\n");
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
for (const dir of [left, right])
  await fs.writeFile(path.join(dir, "same.txt"), "same");
const xlLeft = Array.from({ length: 2000 }, (_, i) => [i, `项目-${i}`]),
  xlRight = xlLeft.map((row) => [...row]);
xlRight[5][1] = "新版早期值";
xlRight[1850][1] = "新版末尾值";
await fs.writeFile(xlA, legacyWorkbook({ 数据: xlLeft }));
await fs.writeFile(xlB, await workbook({ 数据: xlRight }));
const fixtureFile = path.join(tmp, "dialogs.json"),
  resultFile = path.join(tmp, "result.json");
const html = path.join(tmp, "report.html"),
  xlsx = path.join(tmp, "report.xlsx");
await fs.writeFile(
  fixtureFile,
  JSON.stringify({
    script: path.join(root, "native/smoke-ui.js"),
    diffScript: path.join(root, "native/smoke-diff.js"),
    diffResult: path.join(tmp, "diff-result.json"),
    diffScreenshot: path.join(artifacts, "diff-windows.png"),
    dropLeft: a,
    dropRight: b,
    result: resultFile,
    screenshot: path.join(artifacts, "webview2-windows.png"),
    drop: a,
    open0: a,
    open1: b,
    open2: left,
    open3: right,
    open4: xlA,
    open5: xlB,
    save0: html,
    save1: xlsx,
  }),
);
let child;
try {
  child = spawn(
    path.join(root, ".native-build/wiiMerge.exe"),
    [
      `--smoke-fixtures=${fixtureFile}`,
      `--profile=${path.join(tmp, "profile")}`,
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 120000;
  let result;
  while (Date.now() < deadline) {
    try {
      result = JSON.parse(await fs.readFile(resultFile, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    if (child.exitCode !== null)
      throw new Error(`Native window exited: ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!result) throw new Error("Native UI test timed out");
  if (result.error) throw new Error(result.error);
  if (result.completed.length !== 6)
    throw new Error("Some native checks did not execute");
  if (!result.frameless)
    throw new Error("Root window still has a system titlebar");
  if (!result.borderless || !result.shadowEnabled)
    throw new Error("Root window must use a DWM shadow without border padding");
  for (const name of ["webview2-windows.png", "diff-windows.png"])
    if ((await fs.stat(path.join(artifacts, name))).size < 5000)
      throw new Error("Native screenshot is empty: " + name);
  for (const name of result.completed) console.log("PASS: " + name);
  const exported = await fs.readFile(html, "utf8");
  if (
    !exported.includes("差分一览") ||
    !exported.includes("app.txt") ||
    !exported.includes("before")
  )
    throw new Error("HTML overview or file details missing");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  if (
    wb.getWorksheet("文件清单").rowCount !== 3 ||
    wb.getWorksheet("文本差异").rowCount < 2
  )
    throw new Error("Excel overview or details missing");
  if ((await fs.readFile(b, "utf8")) !== before.join("\r\n") + "\r\n")
    throw new Error("Merge did not preserve target CRLF");
  console.log(
    "PASS: exported reports independently read and actual native screenshot captured",
  );
} catch (error) {
  const detail = [error.message];
  for (const name of ["host-error.txt", "host-state.txt"])
    try {
      detail.push(await fs.readFile(path.join(tmp, name), "utf8"));
    } catch {}
  console.error(
    "::error::" +
      detail.join("\n").replaceAll("\r", "").replaceAll("\n", "%0A"),
  );
  throw error;
} finally {
  if (child && child.exitCode === null) {
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
        }, 5000);
      }
    });
  }
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}
