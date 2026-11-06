import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const root = path.resolve(import.meta.dirname, ".."),
  output = path.join(root, "website/dist"),
  release = JSON.parse(
    await fs.readFile(path.join(root, "website/release.json"), "utf8"),
  ),
  config = JSON.parse(
    await fs.readFile(path.join(root, "vercel.json"), "utf8"),
  );
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};
const server = http.createServer(async (req, res) => {
  try {
    const relative =
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ).replace(/^\/+/, "") || "index.html",
      filename = path.resolve(output, relative);
    if (!filename.startsWith(output + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const bytes = await fs.readFile(filename);
    res.setHeader(
      "Content-Type",
      contentTypes[path.extname(filename)] || "application/octet-stream",
    );
    for (const header of config.headers[0].headers)
      res.setHeader(header.key, header.value);
    res.end(bytes);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      permissions: ["clipboard-read", "clipboard-write"],
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => {
    window.sitePolicyViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.sitePolicyViolations.push(e.violatedDirective),
    );
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await expect(page).toHaveTitle(/wiiMerge/);
  await expect(page.locator("h1")).toContainText("看清每一处差异");
  assert.equal(await page.locator(".demo-line.is-different").count(), 3);
  await page.getByRole("button", { name: "使用左边 →", exact: true }).click();
  await expect(page.locator("#demo-status")).toContainText("已采用左侧");
  await expect(page.locator(".demo-line.is-different")).toHaveCount(0);
  await page.getByRole("button", { name: "重置合并示例", exact: true }).click();
  await expect(page.locator(".demo-line.is-different")).toHaveCount(3);
  await page.getByRole("button", { name: "使用右边", exact: false }).click();
  await expect(page.locator("#demo-status")).toContainText("已采用右侧");
  await page.getByRole("button", { name: "重置合并示例", exact: true }).click();
  await page
    .getByRole("button", { name: "跳转到版本差异", exact: true })
    .click();
  await expect(page.locator('.demo-line[data-line="2"]')).toHaveClass(
    /is-selected/,
  );
  await page.getByRole("tab", { name: "文本与合并", exact: true }).click();
  await expect(page.locator("#workspace-image")).toHaveAttribute(
    "src",
    /workspace-text\.[a-f\d]+\.png/,
  );
  await page
    .getByRole("tab", { name: "文本与合并", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Excel 表格", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "放大查看桌面界面", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/dialog-open/);
  await page.getByRole("tab", { name: "文件夹与归档", exact: true }).click();
  await page.locator("#copy-package").click();
  await expect(page.locator("#copy-status")).toHaveText("包名已复制");
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "wiiMerge-WebView2-Windows-x64",
  );
  for (const link of await page.locator(".download-link").all())
    await expect(link).toHaveAttribute("href", release.downloadUrl);
  await page
    .locator("summary")
    .filter({ hasText: "Excel 比较需要安装 Office 吗？" })
    .click();
  await expect(
    page
      .locator(".faq-list details")
      .filter({ hasText: "Excel 比较需要安装 Office 吗？" }),
  ).toHaveAttribute("open", "");
  const brokenAnchors = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) =>
      links
        .filter(
          (link) =>
            link.getAttribute("href") !== "#" &&
            !document.getElementById(link.getAttribute("href").slice(1)),
        )
        .map((link) => link.getAttribute("href")),
    );
  assert.deepEqual(brokenAnchors, []);
  await page.locator("#workspace-image").evaluate((image) => image.decode());
  await page.evaluate(() => window.scrollTo(0, 0));
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "artifacts/website-desktop.png"),
    fullPage: true,
  });
  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  }
  await page.getByRole("button", { name: "展开导航菜单", exact: true }).click();
  await expect(page.locator(".main-nav")).toBeVisible();
  await page
    .locator(".main-nav")
    .getByRole("link", { name: "下载 Windows 版", exact: true })
    .click();
  await expect(page.locator(".menu-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator("#download")).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(root, "artifacts/website-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(await page.evaluate(() => window.sitePolicyViolations), []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile layout, merge example, screenshot tabs and lightbox, menu, clipboard, download links, anchors, CSP and all assets",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
