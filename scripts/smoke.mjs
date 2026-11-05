import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { zip, workbook } from "../tests/helpers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-desktop-"));
const artifacts = path.join(root, "artifacts");
await fs.mkdir(artifacts, { recursive: true });
const left = path.join(tmp, "before"),
  right = path.join(tmp, "after");
await fs.mkdir(left);
await fs.mkdir(right);
await fs.writeFile(
  path.join(left, "config.json"),
  '{\n  "version": 1,\n  "name": "wiiMerge"\n}\n',
);
await fs.writeFile(
  path.join(right, "config.json"),
  '{\n  "version": 2,\n  "name": "wiiMerge",\n  "export": true\n}\n',
);
await fs.writeFile(path.join(left, "unchanged.txt"), "unchanged");
await fs.writeFile(path.join(right, "unchanged.txt"), "unchanged");
await fs.writeFile(path.join(left, "removed.txt"), "old only");
await fs.writeFile(path.join(right, "added.txt"), "new only");
await fs.writeFile(
  path.join(left, "app.war"),
  await zip({
    "WEB-INF/lib/service.jar": await zip({
      "application.properties": "version=1",
    }),
  }),
);
await fs.writeFile(
  path.join(right, "app.war"),
  await zip({
    "WEB-INF/lib/service.jar": await zip({
      "application.properties": "version=2",
    }),
  }),
);
const aExcel = path.join(tmp, "before.xlsx"),
  bExcel = path.join(tmp, "after.xlsx");
await fs.writeFile(
  aExcel,
  await workbook({
    订单: [
      ["订单ID", "客户", "金额"],
      [1001, "张三", 120],
      [1002, "李四", 200],
    ],
  }),
);
await fs.writeFile(
  bExcel,
  await workbook({
    订单: [
      ["订单ID", "客户", "金额"],
      [1002, "李四", 220],
      [1001, "张三", 120],
    ],
  }),
);

let application;
const pageErrors = [];
try {
  const launchArgs =
    process.env.WIIMERGE_SMOKE_HEADLESS === "1"
      ? ["--no-sandbox", "--ozone-platform=headless", "--disable-gpu"]
      : [];
  application = await electron.launch({
    ...(process.env.WIIMERGE_TEST_EXECUTABLE
      ? { executablePath: process.env.WIIMERGE_TEST_EXECUTABLE }
      : {}),
    args: [
      ...(process.env.WIIMERGE_TEST_EXECUTABLE
        ? []
        : [process.env.WIIMERGE_TEST_APP_PATH || root]),
      ...launchArgs,
      `--user-data-dir=${path.join(tmp, "profile")}`,
    ],
    env: { ...process.env, WIIMERGE_DEV: "0" },
    timeout: 30000,
  });
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page
    .getByRole("heading", { name: "让每一处差异，都清晰可见。" })
    .waitFor();
  await page.screenshot({ path: path.join(artifacts, "desktop-empty.png") });
  console.log("PASS: isolated Electron window, preload and production UI");

  await page.getByRole("button", { name: "用一段示例体验文本比较" }).click();
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.getByRole("heading", { name: /比较结果/ }).waitFor();
  await expect(page.locator(".text-diff tr.changed")).toHaveCount(3);
  await expect(page.locator(".text-diff tr.added")).toHaveCount(1);
  await page.getByRole("button", { name: "下一处差异" }).click();
  await expect(page.locator(".focused-row")).toHaveCount(1);
  await page.screenshot({ path: path.join(artifacts, "desktop-text.png") });
  console.log(
    "PASS: worker-backed text comparison, character highlights and diff navigation",
  );

  await page.getByRole("button", { name: "比较规则", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel.getByText("忽略大小写", { exact: true }).click();
  const ignoredLines = panel.locator(".rule-code").first();
  await ignoredLines.fill("^#");
  await ignoredLines.press("End");
  await ignoredLines.press("Enter");
  await ignoredLines.pressSequentially("^//");
  await expect(ignoredLines).toHaveValue("^#\n^//");
  await panel.getByPlaceholder("例如 A 或 A,B").fill("A");
  await panel.getByRole("button", { name: "保存规则" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("输入或规则已更改，请重新比较")).toBeVisible();
  console.log("PASS: validated rules persistence and stale report protection");

  await page.getByRole("tab", { name: "文件比较", exact: true }).click();
  async function choose(side, filename) {
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filename],
      });
    }, filename);
    await page
      .getByRole("button", { name: "选择文件", exact: true })
      .nth(side)
      .click();
  }
  await choose(0, aExcel);
  await choose(1, bExcel);
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.getByRole("heading", { name: /比较结果/ }).waitFor();
  await expect(page.locator(".excel-diff tbody tr")).toHaveCount(1);
  await expect(page.locator(".excel-diff")).toContainText("200");
  await expect(page.locator(".excel-diff")).toContainText("220");
  await page.screenshot({ path: path.join(artifacts, "desktop-excel.png") });
  console.log(
    "PASS: native file selection, XLSX parsing and keyed row matching",
  );

  for (const [format, label] of [
    ["html", "HTML 报告"],
    ["xlsx", "Excel 报告"],
  ]) {
    const target = path.join(tmp, `report.${format}`);
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    }, target);
    await page.getByRole("button", { name: "导出报告" }).click();
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `报告已导出到 ${target}` }),
    ).toBeVisible();
    if (format === "html") {
      const html = await fs.readFile(target, "utf8");
      if (!html.includes("订单") || !html.includes("220"))
        throw new Error("HTML export content missing");
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(target);
      if (wb.getWorksheet("Excel差异").getCell("G2").value !== "200")
        throw new Error("XLSX export content missing");
    }
  }
  console.log(
    "PASS: native HTML / Excel export and independently verified report contents",
  );

  await page.getByRole("tab", { name: "文件夹比较", exact: true }).click();
  for (const [index, filename] of [left, right].entries()) {
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filename],
      });
    }, filename);
    await page
      .getByRole("button", { name: "选择文件夹", exact: true })
      .nth(index)
      .click();
  }
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.getByRole("heading", { name: /比较结果/ }).waitFor();
  await expect(page.locator(".file-item")).toHaveCount(5);
  await page.getByRole("button", { name: /config.json/ }).click();
  await page.screenshot({ path: path.join(artifacts, "desktop-folders.png") });
  await page
    .getByRole("combobox", { name: "筛选比较条目" })
    .selectOption("changed");
  await expect(page.locator(".file-item")).toHaveCount(2);
  await page.getByRole("textbox", { name: "搜索文件" }).fill("properties");
  await expect(page.locator(".file-item")).toHaveCount(1);
  await expect(page.locator(".file-item")).toContainText(
    "application.properties",
  );
  console.log(
    "PASS: folder traversal, nested WAR/JAR contents, result filtering and search",
  );

  const denied = await page.evaluate(async () => {
    try {
      await window.wiiMerge.compare({
        mode: "files",
        left: "/etc/passwd",
        right: "/etc/passwd",
      });
      return false;
    } catch {
      return true;
    }
  });
  if (!denied) throw new Error("Path authorization failed");
  console.log("PASS: unauthorized filesystem reads rejected at IPC boundary");

  await page.getByRole("tab", { name: "文本比较", exact: true }).click();
  await page.locator("#text-left").fill("手动输入：原始文本");
  await page.locator("#text-right").fill("手动输入：修改文本");
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await expect(page.locator(".text-diff")).toContainText("原始");
  await expect(page.locator(".text-diff")).toContainText("修改");
  console.log("PASS: manual text editing updates the comparison inputs");
  await page.getByRole("tab", { name: "文件比较", exact: true }).click();
  const longLeft = path.join(tmp, "long-left.txt"),
    longRight = path.join(tmp, "long-right.txt");
  await fs.writeFile(longLeft, Array(10000).fill("left").join("\n"));
  await fs.writeFile(longRight, Array(10000).fill("right").join("\n"));
  await choose(0, longLeft);
  await choose(1, longRight);
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.getByRole("button", { name: "取消比较" }).click();
  await expect(page.getByRole("alert")).toContainText("已取消");
  console.log("PASS: background task cancellation leaves the UI responsive");
  if (pageErrors.length)
    throw new Error("Renderer errors: " + pageErrors.join("\n"));
  console.log("PASS: no uncaught renderer errors");
} finally {
  await application?.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
