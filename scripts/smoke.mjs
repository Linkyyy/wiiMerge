import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { zip } from "../tests/helpers.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-merge-ui-"));
const a = path.join(tmp, "a.txt"),
  b = path.join(tmp, "b.txt");
await fs.writeFile(a, "head\nleft\nanchor\nleft-end\n");
await fs.writeFile(b, "head\r\nright\r\nanchor\r\nright-end\r\n");
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
  await page.locator(".result-preview").waitFor();
  const created = app.waitForEvent("window");
  await page.getByRole("button", { name: "打开独立差分窗口" }).click();
  const diff = await created;
  await diff.setViewportSize({ width: 1440, height: 940 });
  await diff.locator(".merge-table").waitFor();
  await expect(diff.locator(".hunk-navigation>button")).toHaveCount(2);
  await diff.locator(".hunk-navigation>button").nth(1).click();
  await diff.getByRole("button", { name: "使用左边", exact: true }).click();
  await expect(diff.locator(".hunk-navigation>button")).toHaveCount(1);
  await diff.getByRole("button", { name: "使用左边", exact: true }).click();
  await expect(diff.locator(".hunk-navigation>button")).toHaveCount(0);
  await diff
    .locator(".editor-sides>div")
    .nth(1)
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(diff.getByRole("status")).toContainText("已保存");
  if (
    (await fs.readFile(b, "utf8")) !== "head\r\nleft\r\nanchor\r\nleft-end\r\n"
  )
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
  await page.locator(".result-preview").waitFor();
  const next = app.waitForEvent("window");
  await page.getByRole("button", { name: "浏览完整目录与归档" }).click();
  const archives = await next;
  await archives
    .locator(".nav-tree-row")
    .filter({ hasText: "app.war" })
    .dblclick();
  await expect(archives.locator(".document-tabs>div")).toHaveCount(2);
  await archives.getByRole("button", { name: "打开差分", exact: true }).click();
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
  console.log(
    "PASS: integrated chrome, separate windows, hunk navigation, bidirectional merge/save, WAR/JAR tabs, overview and complete HTML report",
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
