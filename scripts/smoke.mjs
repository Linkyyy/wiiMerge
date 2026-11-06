import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { zip, legacyWorkbook, workbook } from "../tests/helpers.mjs";
async function exportFromMenu(page, label) {
  await page.getByRole("button", { name: "导出报告", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function scopeFolder(page, row) {
  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "仅查看此目录", exact: true })
    .click();
}
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
  await diff
    .locator('.overview-table tbody tr[data-object-type="text"]')
    .dblclick();
  await diff.locator(".merge-table").waitFor();
  await expect(diff.locator(".titlebar .document-tabs")).toBeVisible();
  await expect(diff.getByRole("toolbar", { name: "差分操作" })).toHaveCount(1);
  await expect(
    diff.locator(".diff-topbar,.editor-sides,.merge-toolbar,.editor-status"),
  ).toHaveCount(0);
  await expect(
    diff.locator(".overview-table th").filter({ hasText: "操作" }),
  ).toHaveCount(0);
  const contentTop = await diff
    .locator(".diff-body")
    .evaluate((el) => el.getBoundingClientRect().top);
  if (contentTop > 80)
    throw new Error("Workspace must have exactly two compact header rows");
  await diff.getByRole("button", { name: "工作区菜单", exact: true }).click();
  await diff
    .getByRole("menuitemcheckbox", { name: "显示文字导航", exact: true })
    .click();
  await expect(diff.locator(".text-navigation")).toBeVisible();
  await diff.getByRole("button", { name: "工作区菜单", exact: true }).click();
  await diff
    .getByRole("menuitemcheckbox", { name: "显示文字导航", exact: true })
    .click();
  await diff.keyboard.press("Control+b");
  await expect(diff.getByRole("slider")).toHaveCount(0);
  await diff.keyboard.press("Control+b");

  await expect(diff.locator(".diff-map")).toHaveAttribute(
    "data-difference-count",
    "2",
  );
  const visual = diff.getByRole("slider", { name: "差异位置" });
  await expect(diff.getByRole("slider")).toHaveCount(1);
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
    .getByRole("slider", { name: "差异位置" })
    .press("End");
  await expect(
    diff.getByRole("dialog").getByRole("slider", { name: "差异位置" }),
  ).toHaveAttribute("aria-valuenow", "1851");
  await diff.screenshot({
    path: path.join(root, "artifacts/diff-navigation-fullscreen.png"),
  });
  await diff.keyboard.press("Escape");
  await expect(diff.getByRole("dialog")).toHaveCount(0);
  await expect(visual).toHaveAttribute("aria-valuenow", "1851");
  await diff
    .locator('[data-merge-row="1850"] .right-cell')
    .click({ button: "right" });
  await diff.getByRole("menuitem", { name: "使用左边", exact: true }).click();
  await expect(diff.locator(".diff-map")).toHaveAttribute(
    "data-difference-count",
    "1",
  );
  await diff.getByRole("button", { name: "撤销合并", exact: true }).click();
  await expect(diff.locator(".diff-map")).toHaveAttribute(
    "data-difference-count",
    "2",
  );
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
  await diff.getByRole("button", { name: "保存右侧", exact: true }).click();
  await expect(diff.getByRole("status")).toContainText("已保存");
  if ((await fs.readFile(b, "utf8")) !== before.join("\r\n") + "\r\n")
    throw new Error("Merged file or CRLF is incorrect");
  await diff.keyboard.press("Control+Shift+Tab");
  await expect(
    diff.locator('.document-tabs [role="tab"][aria-selected="true"]'),
  ).toHaveText("差分一览");
  await diff.keyboard.press("Control+Tab");
  await expect(diff.locator(".merge-table")).toBeVisible();
  await diff.locator(".document-tabs>div.active").click({ button: "right" });
  await diff.getByRole("menuitem", { name: "关闭标签", exact: true }).click();
  await expect(diff.locator(".document-tabs>div")).toHaveCount(1);
  await expect(diff.locator(".archive-overview")).toBeVisible();
  await diff.locator('tr[data-object-type="text"]').dblclick();
  await expect(diff.locator(".merge-table")).toBeVisible();
  await diff.keyboard.press("Control+w");
  await expect(diff.locator(".document-tabs>div")).toHaveCount(1);
  await diff.locator('tr[data-object-type="text"]').dblclick();
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
  await scopeFolder(
    archives,
    archives.locator('tr[data-object-type="directory"]'),
  );
  await archives.locator('tr[data-object-type="archive"]').dblclick();
  await expect(archives.locator(".document-tabs>div")).toHaveCount(3);
  await archives.locator('tr[data-object-type="text"]').dblclick();
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
  await exportFromMenu(archives, "HTML 报告");
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
  await scopeFolder(page, page.locator('tr[data-object-type="archive"]'));
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
  await expect(
    page.locator('.overview-table tbody tr[data-object-type="text"]'),
  ).toHaveCount(1);
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
  await expect(
    large.locator('.overview-table tbody tr[data-object-type="text"]'),
  ).toHaveCount(1);
  await large.locator('tr[data-object-type="text"]').dblclick();
  await expect(large.locator(".merge-table")).toContainText("value-400");
  await exportFromMenu(large, "HTML 报告");
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
  await page.locator('tr[data-object-type="excel"]').dblclick();
  const excel = await xlWindow;
  await expect(excel.locator(".excel-diff tbody tr")).toHaveCount(2);
  await excel.getByRole("slider", { name: "差异位置" }).press("End");
  await expect(excel.getByRole("slider", { name: "差异位置" })).toHaveAttribute(
    "aria-valuenow",
    "1851",
  );
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
    page.locator(
      '.comparison-overview .overview-table tbody tr[data-object-type="text"]',
    ),
  ).toHaveCount(2);
  await expect(page.locator(".archive-warnings")).toBeVisible();
  const duplicateWindow = app.waitForEvent("window");
  await page
    .locator(
      '.comparison-overview .overview-table tbody tr[data-object-type="text"]',
    )
    .filter({ hasText: "同名#2" })
    .dblclick();
  const duplicate = await duplicateWindow;
  await expect(duplicate.locator(".merge-table")).toContainText("old-second");
  await expect(duplicate.locator(".merge-table")).toContainText("new-second");
  await duplicate
    .getByRole("button", { name: "归档提示", exact: true })
    .click();
  await duplicate
    .locator(".archive-warnings")
    .first()
    .locator("summary")
    .click();
  await exportFromMenu(duplicate, "HTML 报告");
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
  await page.getByRole("button", { name: "展开 src", exact: true }).click();
  await expect(page.locator('[data-object-path="src/nested"]')).toHaveAttribute(
    "aria-level",
    "2",
  );
  await page.getByRole("button", { name: "展开 nested", exact: true }).click();
  await expect(
    page.locator('[data-object-path="src/nested/change.txt"]'),
  ).toHaveAttribute("aria-level", "3");
  await page.getByRole("button", { name: "收起 src", exact: true }).click();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "展开所有差异", exact: true }).click();
  await expect(
    page.locator('[data-object-path="src/nested/change.txt"]'),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "隐藏一致项", exact: true }).check();
  await expect(page.locator('[data-object-path="stable"]')).toHaveCount(0);
  await expect(page.locator('[data-object-path="root.txt"]')).toHaveCount(0);
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(4);
  await page.screenshot({
    path: path.join(root, "artifacts/tree-differences.png"),
  });
  await page.getByRole("button", { name: "收起全部", exact: true }).click();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "展开所有差异", exact: true }).click();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(4);
  await page.locator('[data-object-path="src"]').press("ArrowLeft");
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
  await page.locator('[data-object-path="src"]').press("ArrowRight");
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(4);
  await page.getByRole("checkbox", { name: "隐藏差异项", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "隐藏一致项", exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(2);
  await expect(
    page.locator('[data-object-path="src/nested/change.txt"]'),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "隐藏差异项", exact: true })
    .uncheck();
  await page
    .getByRole("combobox", { name: "筛选比较条目" })
    .selectOption("added");
  await expect(
    page.locator('[data-object-path="src/new-empty"]'),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "筛选比较条目" })
    .selectOption("all");
  const folderFileWindow = app.waitForEvent("window");
  await page.locator('[data-object-path="src/nested/change.txt"]').dblclick();
  const folderFile = await folderFileWindow;
  await expect(folderFile.locator(".merge-table")).toContainText(
    "old-folder-file",
  );
  await expect(folderFile.locator(".merge-table")).toContainText(
    "new-folder-file",
  );
  await scopeFolder(page, page.locator('[data-object-path="src/nested"]'));
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
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
