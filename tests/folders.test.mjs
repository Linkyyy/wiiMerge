import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Workbook from "exceljs/lib/doc/workbook.js";
import { compare } from "../core/compare.mjs";
import { overviewObjects } from "../core/folders.mjs";
import { htmlReport, excelReport } from "../core/export.mjs";
import { Workspace } from "../core/workspace.mjs";
import { temporary, zip } from "./helpers.mjs";

async function roots(t) {
  const root = await temporary(t),
    left = path.join(root, "left"),
    right = path.join(root, "right");
  await fs.mkdir(left);
  await fs.mkdir(right);
  return { root, left, right };
}
const folderAt = (report, p) => report.folders.find((f) => f.path === p);

test("populated folders and nested empty folders are objects with aggregate status and parent links", async (t) => {
  const s = await roots(t);
  for (const dir of [s.left, s.right]) {
    await fs.mkdir(path.join(dir, "src", "nested"), { recursive: true });
    await fs.mkdir(path.join(dir, "stable"));
    await fs.writeFile(path.join(dir, "src", "same.txt"), "same");
  }
  await fs.mkdir(path.join(s.left, "src", "nested", "removed"));
  await fs.mkdir(path.join(s.right, "src", "nested", "added"));
  await fs.writeFile(
    path.join(s.left, "src", "nested", "change.txt"),
    "before",
  );
  await fs.writeFile(
    path.join(s.right, "src", "nested", "change.txt"),
    "after",
  );
  const r = await compare({ mode: "folders", ...s });
  assert.equal(folderAt(r, "src").status, "changed");
  assert.equal(folderAt(r, "src/nested").parentKey, folderAt(r, "src").key);
  assert.equal(folderAt(r, "src/nested/removed").status, "removed");
  assert.equal(folderAt(r, "src/nested/added").status, "added");
  assert.equal(folderAt(r, "stable").status, "equal");
  assert.deepEqual(folderAt(r, "src").counts, {
    added: 0,
    removed: 0,
    changed: 1,
    equal: 1,
    error: 0,
    total: 2,
  });
  assert.equal(overviewObjects(r).filter((i) => !i.parentKey).length, 2);
  assert.equal(overviewObjects(r).filter((i) => i.path === "stable").length, 1);
  assert.match(htmlReport(r), /文件夹与归档差分一览/);
  const wb = new Workbook();
  await wb.xlsx.load(await excelReport(r));
  assert.equal(wb.getWorksheet("文件夹与归档").rowCount, r.folders.length + 1);
});

test("empty child presence changes parents even with no file differences; type conflicts and failed archives propagate", async (t) => {
  const s = await roots(t);
  for (const dir of [s.left, s.right]) await fs.mkdir(path.join(dir, "root"));
  await fs.mkdir(path.join(s.right, "root", "only-empty"));
  await fs.mkdir(path.join(s.left, "conflict"));
  await fs.writeFile(path.join(s.left, "conflict", "inside.txt"), "x");
  await fs.writeFile(path.join(s.right, "conflict"), "file");
  const r = await compare({ mode: "folders", ...s });
  assert.equal(folderAt(r, "root").status, "changed");
  assert.equal(folderAt(r, "root").counts.total, 0);
  assert.equal(folderAt(r, "conflict").status, "changed");
  assert.match(folderAt(r, "conflict").error, /类型不同/);
  for (const dir of [s.left, s.right])
    await fs.writeFile(path.join(dir, "root", "broken.jar"), "bad zip");
  const error = await compare({ mode: "folders", ...s });
  assert.equal(folderAt(error, "root/broken.jar").status, "error");
  assert.equal(folderAt(error, "root").status, "error");
});

test("implied archive directories and duplicate nested JARs retain distinct hierarchy", async (t) => {
  const s = await roots(t),
    member = "WEB-INF/lib/app.jar";
  for (const [dir, value] of [
    [s.left, "before"],
    [s.right, "after"],
  ])
    await fs.writeFile(
      path.join(dir, "app.war"),
      await zip([
        [member, await zip({ "config/deep/app.txt": "stable" })],
        [member, await zip({ "config/deep/app.txt": value })],
      ]),
    );
  const request = { mode: "folders", left: s.left, right: s.right },
    r = await compare(request);
  const jars = r.folders.filter(
    (f) => f.type === "archive" && f.path.endsWith(".jar"),
  );
  assert.equal(jars.length, 2);
  assert.equal(jars[0].status, "equal");
  assert.equal(jars[1].status, "changed");
  assert.equal(folderAt(r, "app.war").counts.total, 2);
  assert.equal(folderAt(r, "app.war!/WEB-INF/lib").counts.total, 2);
  const changed = r.items.find((i) => i.status === "changed");
  assert.ok(
    r.folders.some(
      (f) => f.key === changed.parentKey && f.path.includes("同名#2"),
    ),
  );
  const workspace = new Workspace(
    (job) => compare(job.request),
    path.join(s.root, "data"),
  );
  workspace.add(r, request);
  const doc = await workspace.open(r.id, changed.key);
  workspace.preview(doc.id, doc.left, doc.left);
  const staged = workspace.getReport(r.id);
  assert.equal(folderAt(staged, "app.war").status, "equal");
  assert.equal(staged.objectSummary.changed, 0);
});
