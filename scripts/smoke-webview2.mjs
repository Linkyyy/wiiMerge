import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import ExcelJS from "exceljs";
import { zip, workbook } from "../tests/helpers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-native-ui-"));
const artifacts = path.join(root, "artifacts");
await fs.mkdir(artifacts, { recursive: true });
const a = path.join(tmp, "a.xlsx"),
  b = path.join(tmp, "b.xlsx"),
  left = path.join(tmp, "before"),
  right = path.join(tmp, "after");
const longA = path.join(tmp, "long-a.txt"),
  longB = path.join(tmp, "long-b.txt");
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
await fs.writeFile(longA, "left\n".repeat(10000));
await fs.writeFile(longB, "right\n".repeat(10000));
const fixtureFile = path.join(tmp, "dialogs.json"),
  resultFile = path.join(tmp, "result.json");
const html = path.join(tmp, "report.html"),
  xlsx = path.join(tmp, "report.xlsx");
await fs.writeFile(
  fixtureFile,
  JSON.stringify({
    script: path.join(root, "native/smoke-ui.js"),
    result: resultFile,
    screenshot: path.join(artifacts, "webview2-windows.png"),
    drop: a,
    open0: a,
    open1: b,
    open2: left,
    open3: right,
    open4: longA,
    open5: longB,
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
  if (result.completed.length !== 8)
    throw new Error("Some native checks did not execute");
  for (const name of result.completed) console.log("PASS: " + name);
  if (!(await fs.readFile(html, "utf8")).includes("220"))
    throw new Error("HTML content missing");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  if (wb.getWorksheet("Excel差异").getCell("I2").value !== "220")
    throw new Error("Excel content missing");
  if (
    (await fs.realpath(result.droppedPath)).toLowerCase() !==
    (await fs.realpath(a)).toLowerCase()
  )
    throw new Error("Dropped path points to a different file");
  if ((await fs.stat(path.join(artifacts, "webview2-windows.png"))).size < 1000)
    throw new Error("No native screenshot was captured");
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
