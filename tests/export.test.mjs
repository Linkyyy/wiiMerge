import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { compare } from "../core/compare.mjs";
import { htmlReport, excelReport } from "../core/export.mjs";

test("HTML report is standalone, includes all statuses and escapes executable markup", async () => {
  const report = await compare({
    mode: "text",
    left: "<script>alert(1)</script>",
    right: '<img src=x onerror="alert(1)">',
  });
  const html = htmlReport(report);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img "));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(html.includes("有差异 1"));
});

test("XLSX export round-trips non-ASCII, exact original contents and safe formula-like strings", async () => {
  const report = await compare({
    mode: "text",
    left: '=HYPERLINK("https://example.com","x")',
    right: "中文 <b>值</b>",
  });
  const buffer = await excelReport(report);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.equal(wb.getWorksheet("比较摘要").getCell("B3").value, "左侧文本");
  const sheet = wb.getWorksheet("文本差异");
  assert.equal(sheet.getCell("D2").type, ExcelJS.ValueType.String);
  assert.equal(
    sheet.getCell("D2").value,
    '=HYPERLINK("https://example.com","x")',
  );
  assert.equal(sheet.getCell("F2").value, "中文 <b>值</b>");
  assert.equal(wb.getWorksheet("文件清单").rowCount, 2);
  assert.ok(wb.getWorksheet("Excel差异"));
  assert.ok(wb.getWorksheet("工作表清单"));
});
