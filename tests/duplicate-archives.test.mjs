import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { readArchive } from "../core/archive.mjs";
import { compare } from "../core/compare.mjs";
import { compareExcel } from "../core/excel.mjs";
import { DEFAULT_RULES } from "../core/defaults.mjs";
import { htmlReport, excelReport } from "../core/export.mjs";
import Workbook from "exceljs/lib/doc/workbook.js";
import { Workspace } from "../core/workspace.mjs";
import { zip, temporary, workbook } from "./helpers.mjs";

const member = "WEB-INF/lib/nablarch-core-jdbc-1.4.0.jar";
async function repeatedWar(first, second) {
  return zip([
    [member, await zip({ "config.txt": first })],
    [member, await zip({ "config.txt": second })],
    ["README.txt", "normal file"],
  ]);
}
async function session(t, leftBytes, rightBytes) {
  const root = await temporary(t),
    left = path.join(root, "before.war"),
    right = path.join(root, "after.war");
  await fs.writeFile(left, leftBytes);
  await fs.writeFile(right, rightBytes);
  const request = { mode: "files", left, right },
    report = await compare(request);
  const workspace = new Workspace(
    (job) => compare(job.request),
    path.join(root, "data"),
  );
  workspace.add(report, request);
  return { root, left, right, report, workspace };
}
test("ZIP retains duplicate files and coalesces redundant directory records", async () => {
  const entries = await readArchive(
    await zip([
      ["dir/", ""],
      ["dir/", ""],
      ["a.txt", "first"],
      ["a.txt", "second"],
    ]),
  );
  assert.equal(entries.length, 3);
  assert.equal(entries[0].duplicateCount, 2);
  assert.equal(entries[1].occurrence, 1);
  assert.equal(entries[2].occurrence, 2);
  assert.equal(entries[2].duplicateCount, 2);
  assert.equal(entries[2].buffer.toString(), "second");
  assert.match(entries[2].displayName, /同名#2/);
});
test("duplicate JDBC JAR paths do not abort the WAR and opening selects the exact occurrence", async (t) => {
  const s = await session(
    t,
    await repeatedWar("stable", "old-second"),
    await repeatedWar("stable", "new-second"),
  );
  assert.equal(s.report.summary.total, 3);
  assert.equal(s.report.summary.equal, 2);
  assert.equal(s.report.summary.changed, 1);
  assert.equal(s.report.summary.error, 0);
  assert.equal(s.report.warnings.length, 2);
  const second = s.report.items.find((i) => i.path.includes("同名#2"));
  assert.equal(second.status, "changed");
  assert.equal(second.leftArchiveSteps[0].name, member);
  assert.equal(second.leftArchiveSteps[0].occurrence, 2);
  const doc = await s.workspace.open(s.report.id, second.key);
  assert.equal(doc.left, "old-second");
  assert.equal(doc.right, "new-second");
  const html = htmlReport(s.report);
  assert.ok(html.includes("归档同名路径"));
  assert.ok(
    html.includes("同名#2") &&
      html.includes("old-second") &&
      html.includes("new-second"),
  );
  const exported = new Workbook();
  await exported.xlsx.load(await excelReport(s.report));
  assert.equal(exported.getWorksheet("文件清单").rowCount, 4);
  assert.equal(exported.getWorksheet("归档重复路径").rowCount, 3);
  assert.ok(
    exported
      .getWorksheet("文件清单")
      .getColumn(10)
      .values.some((value) => String(value).includes("第 2 项")),
  );
  assert.match(doc.sides.left.label, /同名#2/);
  const original = await fs.readFile(s.right);
  s.workspace.preview(doc.id, doc.left, doc.left);
  await assert.rejects(s.workspace.save(doc.id, "right"), /另存为/);
  const target = path.join(s.root, "merged.txt");
  await s.workspace.save(doc.id, "right", target);
  assert.equal(await fs.readFile(target, "utf8"), "old-second");
  assert.deepEqual(await fs.readFile(s.right), original);
  const first = s.report.items.find(
    (i) => i.path.endsWith("config.txt") && !i.path.includes("同名#2"),
  );
  assert.equal((await s.workspace.open(s.report.id, first.key)).left, "stable");
});
test("extra identical occurrences are reported as real additions/removals instead of silently dropped", async (t) => {
  const one = await zip([
    [member, await zip({ "config.txt": "same" })],
    ["README.txt", "normal file"],
  ]);
  const s = await session(t, await repeatedWar("same", "same"), one);
  assert.equal(s.report.summary.equal, 2);
  assert.equal(s.report.summary.removed, 1);
  assert.equal(s.report.summary.error, 0);
  const extra = s.report.items.find((i) => i.duplicateVariant);
  const doc = await s.workspace.open(s.report.id, extra.key);
  assert.equal(doc.left, "same");
  assert.equal(doc.right, "");
  await assert.rejects(
    s.workspace.adoptFile(s.report.id, extra.key, "left"),
    /对应版本/,
  );
});

test("opening an occurrence rejects an archive replaced after comparison", async (t) => {
  const s = await session(
    t,
    await repeatedWar("stable", "old-second"),
    await repeatedWar("stable", "new-second"),
  );
  const second = s.report.items.find((i) => i.duplicateVariant);
  await fs.writeFile(
    s.left,
    await repeatedWar("stable", "externally-replaced"),
  );
  await assert.rejects(
    s.workspace.open(s.report.id, second.key),
    /比较后发生变化/,
  );
});
test("literal version-marker filenames cannot collide with virtual duplicate labels or overwrite real files", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.zip"),
    right = path.join(root, "folder"),
    literal = "a⟦同名#2⟧.txt";
  await fs.mkdir(right);
  await fs.writeFile(path.join(right, "a.txt"), "first");
  await fs.writeFile(path.join(right, literal), "literal");
  await fs.writeFile(
    left,
    await zip([
      ["a.txt", "first"],
      ["a.txt", "second"],
      [literal, "literal"],
    ]),
  );
  const request = { mode: "files", left, right },
    report = await compare(request);
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.equal, 2);
  assert.equal(report.summary.removed, 1);
  assert.equal(new Set(report.items.map((i) => i.path)).size, 3);
  const workspace = new Workspace(
    (job) => compare(job.request),
    path.join(root, "data"),
  );
  workspace.add(report, request);
  const extra = report.items.find((i) => i.duplicateVariant),
    doc = await workspace.open(report.id, extra.key);
  assert.equal(doc.left, "second");
  assert.equal(doc.sides.right.writable, false);
  workspace.preview(doc.id, doc.left, doc.left);
  await assert.rejects(workspace.save(doc.id, "right"), /另存为/);
  assert.equal(await fs.readFile(path.join(right, "a.txt"), "utf8"), "first");
  const actual = report.items.find((i) => i.leftPath === literal);
  assert.equal((await workspace.open(report.id, actual.key)).right, "literal");
});
test("path replacement rules still pair duplicate archive occurrences and reject genuine matching conflicts", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.zip"),
    right = path.join(root, "b.zip");
  for (const [file, version] of [
    [left, 1],
    [right, 2],
  ])
    await fs.writeFile(
      file,
      await zip([
        [`app-v${version}.jar`, await zip({ "a.txt": "first" })],
        [`app-v${version}.jar`, await zip({ "a.txt": "second" })],
      ]),
    );
  const report = await compare({
    mode: "files",
    left,
    right,
    rules: { pathReplacements: [{ pattern: "-v[12]", replacement: "" }] },
  });
  assert.equal(report.summary.equal, 2);
  assert.equal(report.summary.error, 0);
  await fs.writeFile(left, await zip({ "A.txt": "a", "a.txt": "b" }));
  await assert.rejects(
    compare({ mode: "files", left, right, rules: { pathIgnoreCase: true } }),
    /匹配冲突/,
  );
});
test("Excel XML packages keep strict duplicate-path validation", async () => {
  const bytes = await workbook({ Data: [[1]] }),
    entries = await readArchive(bytes);
  const pairs = entries
    .filter((e) => !e.directory)
    .map((e) => [e.name, e.buffer]);
  pairs.push(pairs.find(([name]) => name === "[Content_Types].xml"));
  await assert.rejects(
    compareExcel(await zip(pairs), bytes, DEFAULT_RULES),
    /Excel.*重复路径/,
  );
});
