import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { compare } from "../core/compare.mjs";
import { Workspace } from "../core/workspace.mjs";
import { adoptHunk, textModel } from "../core/hunks.mjs";
import { temporary, zip, workbook } from "./helpers.mjs";

test("bidirectional hunks preserve unrelated lines, insertions and final newline", () => {
  for (const [a, b] of [
    ["head\nold\nanchor\nleft\n", "head\nnew\nanchor\nright\n"],
    ["a\nb", "a\nx\nb"],
    ["", "x\n"],
    ["a", "a\n"],
  ]) {
    let left = a,
      right = b;
    while (textModel(left, right).hunks.length)
      ({ left, right } = adoptHunk(
        left,
        right,
        textModel(left, right).hunks[0],
        "left",
      ));
    assert.equal(right, a);
    left = a;
    right = b;
    while (textModel(left, right).hunks.length)
      ({ left, right } = adoptHunk(
        left,
        right,
        textModel(left, right).hunks[0],
        "right",
      ));
    assert.equal(left, b);
  }
});
async function setup(t, request) {
  const data = await temporary(t);
  const workspace = new Workspace(async (job) => compare(job.request), data);
  const report = workspace.add(await compare(request), request);
  return { workspace, report, data };
}
test("merge saves preserve CRLF, keep backups and refresh the report", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.txt"),
    right = path.join(root, "b.txt");
  await fs.writeFile(left, "one\ntwo\n");
  await fs.writeFile(right, "one\r\nold\r\n");
  const { workspace, report } = await setup(t, { mode: "files", left, right });
  const doc = await workspace.open(report.id, "file");
  workspace.preview(doc.id, doc.left, doc.left);
  const saved = await workspace.save(doc.id, "right");
  assert.equal(await fs.readFile(right, "utf8"), "one\r\ntwo\r\n");
  assert.equal(await fs.readFile(saved.backup, "utf8"), "one\r\nold\r\n");
  assert.equal(workspace.getReport(report.id).summary.equal, 1);
});
test("external modifications are rejected and unsaved content stays in the workspace", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.txt"),
    right = path.join(root, "b.txt");
  await fs.writeFile(left, "left");
  await fs.writeFile(right, "right");
  const { workspace, report } = await setup(t, { mode: "files", left, right });
  const d = await workspace.open(report.id, "file");
  workspace.preview(d.id, d.left, d.left);
  const preview = workspace.getReport(report.id);
  assert.equal(preview.draft, true);
  assert.equal(preview.items[0].details.equal, true);
  await fs.writeFile(right, "outside edit");
  await assert.rejects(workspace.save(d.id, "right"), /其他程序修改/);
  assert.equal(await fs.readFile(right, "utf8"), "outside edit");
});
test("nested archive entries open without extraction and can only be saved separately", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.war"),
    right = path.join(root, "b.war");
  await fs.writeFile(
    left,
    await zip({ "lib/a.jar": await zip({ "x.txt": "left" }) }),
  );
  await fs.writeFile(
    right,
    await zip({ "lib/a.jar": await zip({ "x.txt": "right" }) }),
  );
  const before = await fs.readFile(right);
  const { workspace, report } = await setup(t, { mode: "files", left, right });
  const d = await workspace.open(report.id, report.items[0].key);
  assert.equal(d.left, "left");
  assert.equal(d.right, "right");
  assert.equal(d.sides.right.writable, false);
  workspace.preview(d.id, "left", "left");
  await assert.rejects(workspace.save(d.id, "right"), /另存为/);
  const target = path.join(root, "merged.txt");
  await workspace.save(d.id, "right", target);
  assert.equal(await fs.readFile(target, "utf8"), "left");
  assert.deepEqual(await fs.readFile(right), before);
});
test("new files may be adopted into the selected folder and report sessions remain independent", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a"),
    right = path.join(root, "b");
  await fs.mkdir(left);
  await fs.mkdir(right);
  await fs.mkdir(path.join(left, "nested"));
  await fs.writeFile(path.join(left, "nested/new.txt"), "new\n");
  const { workspace, report } = await setup(t, {
    mode: "folders",
    left,
    right,
  });
  const d = await workspace.open(report.id, report.items[0].key);
  workspace.preview(d.id, d.left, d.left);
  await workspace.save(d.id, "right");
  assert.equal(
    await fs.readFile(path.join(right, "nested/new.txt"), "utf8"),
    "new\n",
  );
  const other = { mode: "text", left: "a", right: "b" };
  workspace.add(await compare(other), other);
  assert.equal(workspace.getReport(report.id).summary.equal, 1);
});

test("whole-workbook adoption preserves exact bytes and backs up the target", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "a.xlsx"),
    right = path.join(root, "b.xlsx");
  const a = await workbook({
      Data: [
        ["ID", "Value"],
        [1, 42],
      ],
    }),
    b = await workbook({
      Data: [
        ["ID", "Value"],
        [1, 99],
      ],
    });
  await fs.writeFile(left, a);
  await fs.writeFile(right, b);
  const { workspace, report } = await setup(t, { mode: "files", left, right });
  const saved = await workspace.adoptFile(report.id, "file", "left");
  assert.deepEqual(await fs.readFile(right), a);
  assert.deepEqual(await fs.readFile(saved.backup), b);
  assert.equal(workspace.getReport(report.id).summary.equal, 1);
});
