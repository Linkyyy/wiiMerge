import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import Workbook from "exceljs/lib/doc/workbook.js";
import { compare } from "../core/compare.mjs";
import { htmlReport, excelReport } from "../core/export.mjs";
import { temporary, zip } from "./helpers.mjs";

const filename = (i) => `entry-${String(i).padStart(5, "0")}.txt`;
test("folders scan and compare more than 20,000 files without dropping late differences", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "left"),
    right = path.join(root, "right"),
    count = 20001;
  await fs.mkdir(left);
  await fs.mkdir(right);
  let next = 0;
  await Promise.all(
    Array.from({ length: 64 }, async () => {
      while (next < count) {
        const index = next++;
        await fs.writeFile(path.join(left, filename(index)), "");
      }
    }),
  );
  await fs.writeFile(path.join(right, filename(count - 1)), "late change");
  await fs.writeFile(path.join(right, "right-only.txt"), "new");
  let completion;
  const report = await compare({ mode: "folders", left, right }, (progress) => {
    if (progress.phase === "complete") completion = progress;
  });
  assert.equal(report.summary.total, count + 1);
  assert.equal(report.summary.removed, count - 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.error, 0);
  assert.equal(
    report.items.find((i) => i.path === filename(count - 1)).details.rows[0]
      .right,
    "late change",
  );
  assert.equal(completion.completed, count + 1);
});

test("archives and HTML/Excel reports retain every file beyond 5,000 entries", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "before.jar"),
    right = path.join(root, "after.jar"),
    count = 5001;
  const entries = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [filename(i), "same"]),
  );
  await fs.writeFile(left, await zip(entries));
  entries[filename(count - 1)] = "last change";
  await fs.writeFile(right, await zip(entries));
  const report = await compare({ mode: "files", left, right });
  assert.equal(report.summary.total, count);
  assert.equal(report.summary.equal, count - 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.error, 0);
  const html = htmlReport(report);
  assert.equal((html.match(/<section id="file-/g) || []).length, count);
  assert.ok(html.includes(filename(count - 1)));
  assert.ok(html.includes("last change"));
  const workbook = new Workbook();
  await workbook.xlsx.load(await excelReport(report));
  assert.equal(workbook.getWorksheet("文件清单").rowCount, count + 1);
  assert.ok(
    workbook
      .getWorksheet("文件清单")
      .getRow(count + 1)
      .values.includes(filename(count - 1)),
  );
  assert.ok(
    workbook.getWorksheet("文本差异").getRow(2).values.includes("last change"),
  );
});
