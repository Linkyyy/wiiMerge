import { diffArrays } from "diff";
import { compilePattern, makeNormalizer } from "./rules.mjs";

export const MAX_DIFF_ROWS = 12000;
export function compareText(left, right, rules) {
  const normalize = makeNormalizer(rules);
  const ignored = rules.ignoreLines.map((p) => compilePattern(p));
  const lines = (text) => {
    if (!text) return [];
    // Keep the final empty line so adding/removing the final newline is visible.
    return text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((text, i) => ({ text, number: i + 1, key: normalize(text) }))
      .filter(
        (l) =>
          !ignored.some((p) => p.test(l.text)) &&
          !(rules.ignoreBlankLines && !l.key.trim()),
      );
  };
  const a = lines(left),
    b = lines(right);
  const chunks = diffArrays(
    a.map((l) => l.key),
    b.map((l) => l.key),
    { timeout: 2500 },
  );
  if (!chunks)
    throw new Error("文本差异过于复杂，比较超时；请拆分文件或增加忽略规则");
  const rows = [],
    changedRows = [],
    counts = { added: 0, removed: 0, changed: 0, equal: 0 };
  let ai = 0,
    bi = 0,
    totalRows = 0;
  const add = (status, l, r) => {
    counts[status]++;
    totalRows++;
    if (
      rows.length < MAX_DIFF_ROWS ||
      (status !== "equal" && changedRows.length < MAX_DIFF_ROWS)
    ) {
      const row = {
        status,
        left: l?.text ?? null,
        right: r?.text ?? null,
        leftLine: l?.number ?? null,
        rightLine: r?.number ?? null,
      };
      if (rows.length < MAX_DIFF_ROWS) rows.push(row);
      if (status !== "equal" && changedRows.length < MAX_DIFF_ROWS)
        changedRows.push(row);
    }
  };
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c.added && !c.removed) {
      for (let j = 0; j < c.count; j++) add("equal", a[ai++], b[bi++]);
      continue;
    }
    if (c.removed && chunks[i + 1]?.added) {
      const next = chunks[++i];
      for (let j = 0; j < Math.max(c.count, next.count); j++)
        add(
          j < c.count && j < next.count
            ? "changed"
            : j < c.count
              ? "removed"
              : "added",
          j < c.count ? a[ai++] : null,
          j < next.count ? b[bi++] : null,
        );
    } else if (c.removed) {
      for (let j = 0; j < c.count; j++) add("removed", a[ai++], null);
    } else {
      for (let j = 0; j < c.count; j++) add("added", null, b[bi++]);
    }
  }
  const contextOmitted = totalRows > MAX_DIFF_ROWS && changedRows.length > 0;
  const retained = contextOmitted ? changedRows : rows;
  return {
    kind: "text",
    equal: !counts.added && !counts.removed && !counts.changed,
    rows: retained,
    counts,
    totalRows,
    truncated: totalRows > retained.length,
    contextOmitted,
    leftLines: a.length,
    rightLines: b.length,
  };
}
