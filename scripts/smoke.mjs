import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { zip, legacyWorkbook, workbook } from "../tests/helpers.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-merge-ui-"));
const a = path.join(tmp, "a.txt"),
  b = path.join(tmp, "b.txt");
const before = Array.from({ length: 2000 }, (_, i) => `line-${i}`),
  after = [...before];
before[5] = "left-first";
after[5] = "right-first";
before[1850] = "left-last";
after[1850] = "right-last";
await fs.writeFile(a, before.join("\n") + "\n");
await fs.writeFile(b, after.join("\r\n") + "\r\n");
let app;
try {
  app = await electron.launch({
    ...(process.env.WIIMERGE_TEST_EXECUTABLE
      ? { executablePath: process.env.WIIMERGE_TEST_EXECUTABLE }
      : {}),
    args: [
      ...(process.env.WIIMERGE_TEST_EXECUTABLE
        ? []
        : [process.env.WIIMERGE_TEST_APP_PATH || root]),
      ...(process.env.WIIMERGE_SMOKE_HEADLESS === "1"
        ? ["--no-sandbox", "--ozone-platform=headless", "--disable-gpu"]
        : []),
      `--user-data-dir=${path.join(tmp, "profile")}`,
    ],
    env: { ...process.env, WIIMERGE_DEV: "0" },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.locator(".mode-tabs").waitFor();
  await expect(
    page.getByRole("button", { name: "关闭窗口", exact: true }),
  ).toBeVisible();
  for (const [index, filename] of [a, b].entries()) {
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filename],
      });
    }, filename);
    await page
      .getByRole("button", { name: "选择文件", exact: true })
      .nth(index)
      .click();
  }
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await page.locator(".comparison-overview").waitFor();
  await expect(page.locator(".comparison-overview h2")).toHaveText("差分一览");
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "artifacts/comparison-overview.png"),
  });
  const created = app.waitForEvent("window");
  await page.getByRole("button", { name: "打开独立差分窗口" }).click();
  const diff = await created;
  await diff.setViewportSize({ width: 1440, height: 940 });
  await expect(diff.locator(".archive-overview")).toBeVisible();
  await expect(diff.locator(".merge-table")).toHaveCount(0);
  await diff.getByRole("button", { name: "查看差分", exact: true }).click();
  await diff.locator(".merge-table").waitFor();
  await expect(diff.locator(".diff-map")).toHaveAttribute(
    "data-difference-count",
    "2",
  );
  const visual = diff.getByRole("slider", { name: "右侧差异位置" });
  await expect(diff.locator(".text-navigation")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(diff.locator(".diff-explorer")).toHaveCount(0);
  const mapSize = await visual.boundingBox();
  await visual.click({ position: { x: 10, y: mapSize.height * 0.93 } });
  await expect(visual).toHaveAttribute("aria-valuenow", "1851");
  await expect(diff.locator('[data-merge-row="1850"]')).toBeInViewport();
  await expect
    .poll(() => diff.locator(".merge-scroll").evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await diff.screenshot({
    path: path.join(root, "artifacts/diff-minimap-text.png"),
  });
  await visual.dblclick();
  await expect(
    diff.getByRole("dialog", { name: "全屏差分导航" }),
  ).toBeVisible();
  await diff
    .getByRole("dialog")
    .getByRole("slider", { name: "右侧差异位置" })
    .press("End");
  await expect(
    diff.getByRole("dialog").getByRole("slider", { name: "右侧差异位置" }),
  ).toHaveAttribute("aria-valuenow", "1851");
  await diff.screenshot({
    path: path.join(root, "artifacts/diff-navigation-fullscreen.png"),
  });
  await diff.keyboard.press("Escape");
  await expect(diff.getByRole("dialog")).toHaveCount(0);
  await expect(visual).toHaveAttribute("aria-valuenow", "1851");
  await diff.getByRole("button", { name: "使用左边", exact: true }).click();
  await expect(diff.locator(".diff-map")).toHaveAttribute(
    "data-difference-count",
    "1",
  );
  await diff.getByRole("button", { name: "使用左边", exact: true }).click();
  await expect(diff.locator(".diff-map")).toHaveAttribute(
    "data-difference-count",
    "0",
  );
  await diff
    .locator(".editor-sides>div")
    .nth(1)
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(diff.getByRole("status")).toContainText("已保存");
  if ((await fs.readFile(b, "utf8")) !== before.join("\r\n") + "\r\n")
    throw new Error("Merged file or CRLF is incorrect");
  const archiveA = path.join(tmp, "before"),
    archiveB = path.join(tmp, "after");
  await fs.mkdir(archiveA);
  await fs.mkdir(archiveB);
  await fs.writeFile(
    path.join(archiveA, "app.war"),
    await zip({ "lib/app.jar": await zip({ "app.txt": "before" }) }),
  );
  await fs.writeFile(
    path.join(archiveB, "app.war"),
    await zip({ "lib/app.jar": await zip({ "app.txt": "after" }) }),
  );
  await page.getByRole("tab", { name: "文件夹比较" }).click();
  for (const [index, filename] of [archiveA, archiveB].entries()) {
    await app.evaluate(({ dialog }, filename) => {
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
  await expect(
    page.locator(".comparison-overview .overview-table"),
  ).toContainText("app.war");
  const next = app.waitForEvent("window");
  await page.getByRole("button", { name: "打开独立差分窗口" }).click();
  const archives = await next;
  await archives
    .locator(".overview-table tbody tr")
    .filter({ hasText: "app.war" })
    .dblclick();
  await expect(archives.locator(".document-tabs>div")).toHaveCount(2);
  await archives
    .getByRole("button", { name: "打开文件夹", exact: true })
    .click();
  await archives.getByRole("button", { name: "进入归档", exact: true }).click();
  await expect(archives.locator(".document-tabs>div")).toHaveCount(3);
  await archives.getByRole("button", { name: "查看差分", exact: true }).click();
  await archives.locator(".merge-table").waitFor();
  await expect(archives.locator(".merge-table")).toContainText("before");
  await expect(archives.locator(".merge-table")).toContainText("after");
  const html = path.join(tmp, "report.html");
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: filename,
    });
  }, html);
  await archives
    .getByRole("button", { name: "HTML 报告", exact: true })
    .click();
  await expect(archives.getByRole("status")).toContainText("已导出");
  const content = await fs.readFile(html, "utf8");
  if (
    !content.includes("差分一览") ||
    !content.includes("app.txt") ||
    !content.includes("before")
  )
    throw new Error("Export missing overview/details");
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await archives.screenshot({
    path: path.join(root, "artifacts/diff-tabs.png"),
  });
  await diff.screenshot({ path: path.join(root, "artifacts/diff-merge.png") });
  const many = Object.fromEntries(
    Array.from({ length: 401 }, (_, i) => [
      `entry-${String(i).padStart(5, "0")}.txt`,
      `value-${i}`,
    ]),
  );
  const packed = await zip(many);
  for (const dir of [archiveA, archiveB])
    await fs.writeFile(path.join(dir, "app.war"), packed);
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await expect(
    page.locator(".comparison-overview .overview-table tbody tr"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "进入归档", exact: true }).click();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(200);
  await page
    .getByRole("navigation", { name: "差分一览分页" })
    .getByRole("button", { name: "最后一页" })
    .click();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".overview-table")).toContainText(
    "entry-00400.txt",
  );
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("entry-00400");
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索文件", exact: true }).fill("");
  const another = app.waitForEvent("window");
  await page.getByRole("button", { name: "打开独立差分窗口" }).click();
  const large = await another;
  await expect(large.locator(".overview-table tbody tr")).toHaveCount(200);
  await large
    .getByRole("navigation", { name: "差分一览分页" })
    .getByRole("button", { name: "最后一页" })
    .click();
  await expect(large.locator(".overview-table tbody tr")).toHaveCount(1);
  await expect(large.locator(".overview-table")).toContainText(
    "entry-00400.txt",
  );
  await large
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("entry-00400");
  await expect(large.locator(".overview-table tbody tr")).toHaveCount(1);
  await large.getByRole("button", { name: "查看差分", exact: true }).click();
  await expect(large.locator(".merge-table")).toContainText("value-400");
  await large.getByRole("button", { name: "HTML 报告", exact: true }).click();
  await expect(large.getByRole("status")).toContainText("已导出");
  const full = await fs.readFile(html, "utf8");
  if (
    !full.includes("entry-00000.txt") ||
    !full.includes("entry-00400.txt") ||
    (full.match(/<section id="file-/g) || []).length !== 401
  )
    throw new Error("Pagination or search truncated the exported report");
  await large.screenshot({ path: path.join(root, "artifacts/many-files.png") });
  const xlA = path.join(tmp, "legacy.xls"),
    xlB = path.join(tmp, "modern.xlsx");
  const xlLeft = Array.from({ length: 2000 }, (_, i) => [i, `项目-${i}`]),
    xlRight = xlLeft.map((row) => [...row]);
  xlRight[5][1] = "新版早期值";
  xlRight[1850][1] = "新版末尾值";
  await fs.writeFile(xlA, legacyWorkbook({ 数据: xlLeft }));
  await fs.writeFile(xlB, await workbook({ 数据: xlRight }));
  await page.getByRole("tab", { name: "文件比较", exact: true }).click();
  for (const [index, filename] of [xlA, xlB].entries()) {
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filename],
      });
    }, filename);
    await page
      .getByRole("button", { name: "选择文件", exact: true })
      .nth(index)
      .click();
  }
  await page.getByRole("button", { name: "开始比较", exact: true }).click();
  await expect(
    page.locator(".comparison-overview .overview-table"),
  ).toContainText("modern.xlsx");
  const xlWindow = app.waitForEvent("window");
  await page.getByRole("button", { name: "查看差分", exact: true }).click();
  const excel = await xlWindow;
  await expect(excel.locator(".excel-diff tbody tr")).toHaveCount(2);
  await excel.getByRole("slider", { name: "右侧差异位置" }).press("End");
  await expect(
    excel.getByRole("slider", { name: "右侧差异位置" }),
  ).toHaveAttribute("aria-valuenow", "1851");
  await expect(excel.locator(".excel-diff tr.focused-row")).toContainText(
    "新版末尾值",
  );
  await excel.screenshot({
    path: path.join(root, "artifacts/diff-minimap-xls.png"),
  });
  const duplicateMember = "WEB-INF/lib/nablarch-core-jdbc-1.4.0.jar";
  for (const [dir, value] of [
    [archiveA, "old-second"],
    [archiveB, "new-second"],
  ])
    await fs.writeFile(
      path.join(dir, "app.war"),
      await zip([
        [duplicateMember, await zip({ "config.txt": "stable-first" })],
        [duplicateMember, await zip({ "config.txt": value })],
        ["README.txt", "normal"],
      ]),
    );
  await page.getByRole("tab", { name: "文件夹比较", exact: true }).click();
  for (const [index, filename] of [archiveA, archiveB].entries()) {
    await app.evaluate(({ dialog }, filename) => {
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
  await expect(
    page.locator(".comparison-overview .overview-table tbody tr"),
  ).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("config.txt");
  await expect(
    page.locator(".comparison-overview .overview-table tbody tr"),
  ).toHaveCount(2);
  await expect(page.locator(".archive-warnings")).toBeVisible();
  const duplicateWindow = app.waitForEvent("window");
  await page
    .locator(".comparison-overview .overview-table tbody tr")
    .filter({ hasText: "同名#2" })
    .getByRole("button", { name: "查看差分" })
    .click();
  const duplicate = await duplicateWindow;
  await expect(duplicate.locator(".merge-table")).toContainText("old-second");
  await expect(duplicate.locator(".merge-table")).toContainText("new-second");
  await duplicate
    .locator(".archive-warnings")
    .first()
    .locator("summary")
    .click();
  await duplicate
    .getByRole("button", { name: "HTML 报告", exact: true })
    .click();
  await expect(duplicate.getByRole("status")).toContainText("已导出");
  const duplicateHtml = await fs.readFile(html, "utf8");
  if (
    !duplicateHtml.includes("归档同名路径") ||
    !duplicateHtml.includes("stable-first") ||
    !duplicateHtml.includes("new-second")
  )
    throw new Error("Duplicate versions omitted from export");
  await duplicate.screenshot({
    path: path.join(root, "artifacts/duplicate-war.png"),
  });
  const folderA = path.join(tmp, "folder-left"),
    folderB = path.join(tmp, "folder-right");
  for (const dir of [folderA, folderB]) {
    await fs.mkdir(path.join(dir, "src", "nested"), { recursive: true });
    await fs.mkdir(path.join(dir, "stable"));
    await fs.writeFile(path.join(dir, "root.txt"), "same");
  }
  await fs.mkdir(path.join(folderB, "src", "new-empty"));
  await fs.writeFile(
    path.join(folderA, "src", "nested", "change.txt"),
    "old-folder-file",
  );
  await fs.writeFile(
    path.join(folderB, "src", "nested", "change.txt"),
    "new-folder-file",
  );
  for (const [index, filename] of [folderA, folderB].entries()) {
    await app.evaluate(({ dialog }, filename) => {
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
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".file-sidebar")).toHaveCount(0);
  await expect(
    page.locator(".overview-table tbody tr").first(),
  ).toHaveAttribute("data-object-type", "directory");
  const sourceFolder = page
    .locator(".overview-table tbody tr")
    .filter({ hasText: "src" });
  await expect(sourceFolder).toContainText("有差异");
  await page.screenshot({
    path: path.join(root, "artifacts/folder-overview.png"),
  });
  await page
    .getByRole("combobox", { name: "筛选比较条目" })
    .selectOption("added");
  await expect(sourceFolder).toBeVisible();
  await sourceFolder.dblclick();
  await expect(page.locator(".overview-table")).toContainText("new-empty");
  await page
    .getByRole("combobox", { name: "筛选比较条目" })
    .selectOption("all");
  await page
    .locator(".overview-table tbody tr")
    .filter({ hasText: "nested" })
    .dblclick();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
  const folderFileWindow = app.waitForEvent("window");
  await page.getByRole("button", { name: "查看差分", exact: true }).click();
  const folderFile = await folderFileWindow;
  await expect(folderFile.locator(".merge-table")).toContainText(
    "old-folder-file",
  );
  await expect(folderFile.locator(".merge-table")).toContainText(
    "new-folder-file",
  );
  await page.getByRole("button", { name: "上一级", exact: true }).click();
  await expect(
    page.locator('.folder-breadcrumbs [aria-current="page"]'),
  ).toHaveText("src");
  console.log(
    "PASS: duplicate WAR/JAR versions, correct entry opening, complete export, overview, visual navigation, XLS and merge/save",
  );
} finally {
  await app?.close();
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
