import ExcelJS from "exceljs";
import { readArchive, LIMITS } from "./archive.mjs";
import { makeNormalizer, columnNumber, columnName } from "./rules.mjs";

function displayValue(value, formulas) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("formula" in value || "sharedFormula" in value)
    return formulas
      ? `=${value.formula ?? value.sharedFormula}`
      : displayValue(value.result, false);
  if ("richText" in value) return value.richText.map((t) => t.text).join("");
  if ("hyperlink" in value) return String(value.text ?? value.hyperlink);
  if ("error" in value) return value.error;
  return String(value.text ?? "");
}

async function readWorkbook(buffer, rules) {
  // Bound the expanded XML before letting ExcelJS parse the workbook.
  await readArchive(buffer, { collect: false });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = new Map();
  let cellCount = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > LIMITS.rows || sheet.columnCount > LIMITS.columns)
      throw new Error(
        `工作表「${sheet.name}」超过 ${LIMITS.rows} 行 / ${LIMITS.columns} 列的上限`,
      );
    const rows = new Map();
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = new Map();
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (++cellCount > LIMITS.cells)
          throw new Error("Excel 非空单元格超过 300,000 个");
        const value = displayValue(cell.value, rules.excelFormulas);
        if (value !== "") cells.set(col, value);
      });
      if (cells.size) rows.set(row.number, { number: row.number, cells });
    });
    sheets.set(sheet.name, rows);
  }
  return sheets;
}

export async function compareExcel(leftBuffer, rightBuffer, rules) {
  const left = leftBuffer ? await readWorkbook(leftBuffer, rules) : new Map();
  const right = rightBuffer
    ? await readWorkbook(rightBuffer, rules)
    : new Map();
  const normalize = makeNormalizer(rules),
    changes = [],
    sheets = [];
  const counts = { added: 0, removed: 0, changed: 0, equal: 0 };
  const keys = rules.excelKeyColumns
    ? rules.excelKeyColumns.split(",").map(columnNumber)
    : [];
  let totalChanges = 0;
  const align = (rows, sheet) => {
    const result = new Map();
    for (const row of rows?.values() ?? []) {
      let key = String(row.number);
      if (keys.length && row.number !== 1) {
        const values = keys.map((c) => normalize(row.cells.get(c) ?? ""));
        if (values.some((v) => !v))
          throw new Error(
            `工作表「${sheet}」第 ${row.number} 行主键为空，请补全主键或取消主键匹配`,
          );
        key = JSON.stringify(values);
      } else if (keys.length) key = "__header__";
      if (result.has(key))
        throw new Error(
          `工作表「${sheet}」第 ${row.number} 行主键重复，无法唯一匹配`,
        );
      result.set(key, row);
    }
    return result;
  };
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    const a = align(left.get(name), name),
      b = align(right.get(name), name);
    const sheetCounts = { added: 0, removed: 0, changed: 0, equal: 0 };
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const l = a.get(key),
        r = b.get(key);
      for (const col of new Set([
        ...(l?.cells.keys() ?? []),
        ...(r?.cells.keys() ?? []),
      ])) {
        const lv = l?.cells.get(col) ?? "",
          rv = r?.cells.get(col) ?? "";
        const status =
          normalize(lv) === normalize(rv)
            ? "equal"
            : !l || (!lv && rv)
              ? "added"
              : !r || (lv && !rv)
                ? "removed"
                : "changed";
        counts[status]++;
        sheetCounts[status]++;
        if (status !== "equal") {
          totalChanges++;
          if (changes.length < 12000)
            changes.push({
              sheet: name,
              key: keys.length && key !== "__header__" ? key : "",
              column: columnName(col),
              leftRow: l?.number ?? null,
              rightRow: r?.number ?? null,
              left: lv,
              right: rv,
              status,
            });
        }
      }
    }
    const status = !left.has(name)
      ? "added"
      : !right.has(name)
        ? "removed"
        : Object.entries(sheetCounts).some(([s, n]) => s !== "equal" && n)
          ? "changed"
          : "equal";
    sheets.push({
      name,
      status,
      leftRows: left.get(name)?.size ?? 0,
      rightRows: right.get(name)?.size ?? 0,
      counts: sheetCounts,
    });
  }
  return {
    kind: "excel",
    equal: totalChanges === 0 && sheets.every((s) => s.status === "equal"),
    sheets,
    changes,
    counts,
    totalChanges,
    truncated: totalChanges > changes.length,
    keyed: !!keys.length,
  };
}
