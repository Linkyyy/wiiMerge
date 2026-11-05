import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { compare } from "../core/compare.mjs";
import { compareExcel } from "../core/excel.mjs";
import { DEFAULT_RULES, validateRules } from "../core/rules.mjs";
import { htmlReport, excelReport } from "../core/export.mjs";
import { Workspace } from "../core/workspace.mjs";
import Workbook from "exceljs/lib/doc/workbook.js";
import { temporary, legacyWorkbook, workbook, zip } from "./helpers.mjs";

test("XLS compares Chinese cells, added/deleted sheets and row keys across XLS/XLSX", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "old.xls"),
    right = path.join(root, "new.xlsx");
  const rows = [
    ["ID", "名称"],
    [1, "中文"],
    [2, "第二行"],
  ];
  await fs.writeFile(left, legacyWorkbook({ 数据: rows }));
  await fs.writeFile(
    right,
    await workbook({ 数据: [rows[0], rows[2], rows[1]] }),
  );
  const result = await compare({
    mode: "files",
    left,
    right,
    rules: { excelKeyColumns: "A" },
  });
  assert.equal(result.summary.equal, 1);
  assert.equal(result.items[0].type, "excel");
  const space = new Workspace(
    (job) => compare(job.request),
    path.join(root, "data"),
  );
  space.add(result, {
    mode: "files",
    left,
    right,
    rules: { excelKeyColumns: "A" },
  });
  const before = await fs.readFile(right);
  await assert.rejects(space.adoptFile(result.id, "file", "left"), /相同格式/);
  assert.deepEqual(await fs.readFile(right), before);
  const changed = await compareExcel(
    legacyWorkbook({ 数据: rows, 删除: [] }),
    legacyWorkbook({
      数据: [
        ["ID", "名称"],
        [1, "新版中文"],
      ],
      新增: [],
    }),
    DEFAULT_RULES,
  );
  assert.ok(
    changed.changes.some((c) => c.left === "中文" && c.right === "新版中文"),
  );
  assert.equal(changed.sheets.find((s) => s.name === "删除").status, "removed");
  assert.equal(changed.sheets.find((s) => s.name === "新增").status, "added");
  const duplicate = legacyWorkbook({
    数据: [
      ["ID", "名称"],
      [1, "A"],
      [1, "B"],
    ],
  });
  await assert.rejects(
    compareExcel(duplicate, duplicate, validateRules({ excelKeyColumns: "A" })),
    /主键重复/,
  );
});

test("independently generated XLS preserves BIFF formulas, Chinese, dates and booleans", async () => {
  const data = await fs.readFile(
    new URL("./fixtures/legacy-formulas.xls", import.meta.url),
  );
  const original = await compareExcel(data, null, DEFAULT_RULES);
  assert.ok(original.changes.some((c) => c.left === "=1+2"));
  assert.ok(original.changes.some((c) => c.left === "中文产品"));
  assert.ok(
    original.changes.some((c) => c.left === "2024-01-02T00:00:00.000Z"),
  );
  assert.ok(original.changes.some((c) => c.left === "true"));
  const cached = await compareExcel(
    data,
    null,
    validateRules({ excelFormulas: false }),
  );
  assert.ok(!cached.changes.some((c) => c.left === "=1+2"));
});

test("XLS inside nested WAR/JAR archives exports cell details in HTML and Excel", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "before.war"),
    right = path.join(root, "after.war");
  for (const [file, value] of [
    [left, "旧值"],
    [right, "新值"],
  ])
    await fs.writeFile(
      file,
      await zip({
        "lib/data.jar": await zip({
          "数据.xls": legacyWorkbook({
            数据: [
              ["项目", "值"],
              ["A", value],
            ],
          }),
        }),
      }),
    );
  const report = await compare({ mode: "files", left, right });
  assert.equal(report.summary.changed, 1);
  assert.equal(report.items[0].details.changes[0].column, "B");
  const html = htmlReport(report);
  assert.ok(html.includes("旧值") && html.includes("新值"));
  const book = new Workbook();
  await book.xlsx.load(await excelReport(report));
  assert.ok(book.getWorksheet("Excel差异").getRow(2).values.includes("新值"));
});

test("invalid XLS inputs are reported as errors instead of guessed CSV or equal workbooks", async (t) => {
  const root = await temporary(t),
    left = path.join(root, "bad.xls"),
    right = path.join(root, "good.xls");
  await fs.writeFile(left, "not a workbook");
  await fs.writeFile(right, legacyWorkbook({ Data: [["a"]] }));
  const report = await compare({ mode: "files", left, right });
  assert.equal(report.summary.error, 1);
  assert.match(report.items[0].error, /XLS/);
});
