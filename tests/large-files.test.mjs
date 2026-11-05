import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { compare } from "../core/compare.mjs";
import { readArchive } from "../core/archive.mjs";
import { inspectFile } from "../core/io.mjs";
import { Workspace } from "../core/workspace.mjs";
import { adoptHunk, textModel } from "../core/hunks.mjs";
import { temporary, zip, workbook } from "./helpers.mjs";

async function sparse(file, size, ending = 0) {
  const handle = await fs.open(file, "w");
  try {
    await handle.truncate(size);
    if (ending) await handle.write(Buffer.from([ending]), 0, 1, size - 1);
  } finally {
    await handle.close();
  }
}
test("folder inputs over 128 MiB use streaming fingerprints and detect a changed final byte", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "left"),
    right = path.join(root, "right");
  await fs.mkdir(left);
  await fs.mkdir(right);
  for (const dir of [left, right])
    for (const name of ["a.bin", "b.bin"])
      await sparse(path.join(dir, name), 66 * 1024 * 1024);
  const request = { mode: "folders", left, right };
  const equal = await compare(request);
  assert.equal(equal.summary.equal, 2);
  assert.equal(equal.items[0].leftSize, 66 * 1024 * 1024);
  await sparse(path.join(right, "b.bin"), 66 * 1024 * 1024, 1);
  const changed = await compare(request);
  assert.equal(changed.summary.changed, 1);
  assert.equal(
    changed.items.find((i) => i.path === "b.bin").details.kind,
    "binary",
  );
});
test("archive entries and expanded archives larger than 128 MiB remain readable", async () => {
  const size = 129 * 1024 * 1024;
  const archive = await zip({ "large.bin": Buffer.alloc(size) });
  const entries = await readArchive(archive);
  assert.equal(entries[0].size, size);
  assert.equal(entries[0].buffer.length, size);
  assert.equal(entries[0].buffer.at(-1), 0);
});
test("text over 16 MiB stays text and can be merged and saved with target line endings", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.txt"),
    right = path.join(root, "b.txt");
  const prefix = "x".repeat(17 * 1024 * 1024);
  await fs.writeFile(left, prefix + "\nleft\n");
  await fs.writeFile(right, prefix + "\r\nright\r\n");
  const request = { mode: "files", left, right },
    report = await compare(request);
  assert.equal(report.items[0].type, "text");
  assert.equal(report.items[0].details.counts.changed, 1);
  const workspace = new Workspace(
    (job) => compare(job.request),
    path.join(root, "data"),
  );
  workspace.add(report, request);
  const doc = await workspace.open(report.id, "file");
  const merged = adoptHunk(
    doc.left,
    doc.right,
    textModel(doc.left, doc.right).hunks[0],
    "left",
  );
  workspace.preview(doc.id, merged.left, merged.right);
  await workspace.save(doc.id, "right");
  assert.equal(await fs.readFile(right, "utf8"), prefix + "\r\nleft\r\n");
});
test("large whole-file adoption copies bytes and backs up without loading both files", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.bin"),
    right = path.join(root, "b.bin");
  await sparse(left, 33 * 1024 * 1024, 1);
  await sparse(right, 33 * 1024 * 1024, 2);
  const original = (await inspectFile(right)).hash,
    expected = (await inspectFile(left)).hash;
  const request = { mode: "files", left, right },
    report = await compare(request);
  const workspace = new Workspace(
    (job) => compare(job.request),
    path.join(root, "data"),
  );
  workspace.add(report, request);
  const saved = await workspace.adoptFile(report.id, "file", "left");
  assert.equal((await inspectFile(right)).hash, expected);
  assert.equal((await inspectFile(saved.backup)).hash, original);
});
test("UTF-8 validation spans chunk boundaries and detects invalid trailing bytes", async (t) => {
  const root = await temporary(t),
    file = path.join(root, "unicode.txt");
  await fs.writeFile(file, "a".repeat(1024 * 1024 - 1) + "汉字");
  assert.equal((await inspectFile(file)).binary, false);
  await fs.appendFile(file, Buffer.from([0xff]));
  assert.equal((await inspectFile(file)).binary, true);
});
test("large insertions can be adopted without JavaScript argument-count limits", () => {
  const right = "x\n".repeat(150000),
    hunk = textModel("", right).hunks[0];
  assert.equal(adoptHunk("", right, hunk, "right").left, right);
});
test("Excel supports rows and columns beyond the former application quotas", async () => {
  const rows = Array.from({ length: 10001 }, (_, i) => [i]);
  rows[10000][256] = "wide";
  const data = await workbook({ Data: rows });
  const root = await readArchive(data, { collect: false });
  assert.deepEqual(root, []);
  const { compareExcel } = await import("../core/excel.mjs");
  const { DEFAULT_RULES } = await import("../core/defaults.mjs");
  const result = await compareExcel(data, data, DEFAULT_RULES);
  assert.equal(result.equal, true);
  assert.equal(result.counts.equal, 10002);
});
