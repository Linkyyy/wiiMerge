import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createService } from "../native/service.mjs";
import { temporary, workbook, zip } from "./helpers.mjs";

async function setup(t) {
  const dir = await temporary(t),
    nativeToken = randomBytes(32).toString("hex");
  const service = await createService({
    appRoot: path.resolve(import.meta.dirname, ".."),
    dataDir: path.join(dir, "profile"),
    nativeToken,
  });
  t.after(() => service.close());
  const launched = await fetch(service.launchURL, { redirect: "manual" });
  const cookie = launched.headers.get("set-cookie").split(";")[0];
  async function post(route, value = {}, native = false) {
    const response = await fetch(service.origin + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(native
          ? { "X-WiiMerge-Native": nativeToken }
          : { cookie, origin: service.origin }),
      },
      body: JSON.stringify(value),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  return { ...service, dir, cookie, post, nativeToken };
}

test("native service rejects unauthenticated, cross-origin and renderer file-grant requests", async (t) => {
  const s = await setup(t);
  assert.equal(
    (await fetch(s.origin + "/api/compare", { method: "POST", body: "{}" }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(s.origin + "/api/compare", {
        method: "POST",
        headers: { cookie: s.cookie, origin: "https://example.com" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(s.origin + "/native/authorize", {
        method: "POST",
        headers: { cookie: s.cookie, origin: s.origin },
        body: JSON.stringify({ path: process.execPath }),
      })
    ).status,
    403,
  );
  await assert.rejects(
    s.post("/api/compare", {
      mode: "files",
      left: process.execPath,
      right: process.execPath,
    }),
    /授权/,
  );
  const report = await s.post("/api/compare", {
    mode: "text",
    left: "before",
    right: "after",
  });
  assert.equal(report.summary.changed, 1);
});

test("native service grants only host-selected paths and retains archive and Excel behavior", async (t) => {
  const s = await setup(t),
    left = path.join(s.dir, "a.zip"),
    right = path.join(s.dir, "b.zip");
  await fs.writeFile(
    left,
    await zip({
      "data.xlsx": await workbook({
        Data: [
          ["id", "value"],
          [1, 10],
        ],
      }),
    }),
  );
  await fs.writeFile(
    right,
    await zip({
      "data.xlsx": await workbook({
        Data: [
          ["id", "value"],
          [1, 20],
        ],
      }),
    }),
  );
  await s.post("/native/authorize", { path: left }, true);
  await s.post("/native/authorize", { path: right }, true);
  const report = await s.post("/api/compare", { mode: "files", left, right });
  assert.equal(report.items[0].type, "excel");
  assert.equal(report.items[0].details.changes[0].left, "10");
  const target = path.join(s.dir, "report.html");
  assert.equal(
    (
      await fetch(s.origin + "/native/export-report", {
        method: "POST",
        headers: { cookie: s.cookie },
        body: JSON.stringify({ id: report.id, path: target, format: "html" }),
      })
    ).status,
    403,
  );
  await s.post(
    "/native/export-report",
    { id: report.id, path: target, format: "html" },
    true,
  );
  assert.match(await fs.readFile(target, "utf8"), /data.xlsx/);
  await assert.rejects(
    s.post(
      "/native/export-report",
      { id: "stale", path: target, format: "html" },
      true,
    ),
    /比较/,
  );
});

test("native preferences round-trip and progress streams close with the service", async (t) => {
  const s = await setup(t);
  const saved = await s.post("/api/save-rules", {
    ignoreCase: true,
    excelKeyColumns: "A",
  });
  assert.equal(saved.ignoreCase, true);
  assert.equal((await s.post("/api/load-rules")).excelKeyColumns, "A");
  const filename = path.join(s.dir, "rules.json");
  await s.post("/native/export-rules", { path: filename, rules: saved }, true);
  assert.equal(
    (await s.post("/native/import-rules", { path: filename }, true)).ignoreCase,
    true,
  );
  const progress = await fetch(s.origin + "/api/progress", {
    headers: { cookie: s.cookie },
  });
  assert.equal(progress.headers.get("content-type"), "text/event-stream");
  await progress.body.cancel();
  await s.close();
});

test("multiple native windows keep separate authentication cookies", async (t) => {
  const a = await setup(t),
    b = await setup(t);
  assert.notEqual(a.cookie.split("=")[0], b.cookie.split("=")[0]);
  for (const s of [a, b]) {
    const response = await fetch(s.origin + "/api/load-rules", {
      method: "POST",
      headers: { cookie: a.cookie + "; " + b.cookie, origin: s.origin },
      body: "{}",
    });
    assert.equal(response.status, 200);
  }
});

test("native JSON transport preserves the 2 MiB per-side text allowance", async (t) => {
  const s = await setup(t),
    text = "\t".repeat(2 * 1024 * 1024);
  const report = await s.post("/api/compare", {
    mode: "text",
    left: text,
    right: text,
  });
  assert.equal(report.summary.equal, 1);
  assert.equal(report.items[0].details.rows[0].left.length, text.length);
});
