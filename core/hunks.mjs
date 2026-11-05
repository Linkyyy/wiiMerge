import { diffArrays } from "diff";

export const lines = (value) =>
  value === "" ? [] : value.replace(/\r\n?/g, "\n").split("\n");
export function textModel(left, right) {
  const a = lines(left),
    b = lines(right);
  const chunks = diffArrays(a, b, { timeout: 2000 });
  if (!chunks) throw new Error("原文差异过于复杂，请缩小文件后合并");
  const rows = [],
    hunks = [];
  let ai = 0,
    bi = 0;
  const row = (status, l, r) =>
    rows.push({
      status,
      left: l === null ? null : a[l],
      right: r === null ? null : b[r],
      leftLine: l === null ? null : l + 1,
      rightLine: r === null ? null : r + 1,
    });
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c.added && !c.removed) {
      for (let n = 0; n < c.count; n++) row("equal", ai++, bi++);
      continue;
    }
    const h = { leftStart: ai, rightStart: bi, row: rows.length };
    const removed = c.removed ? c.count : 0;
    const added = c.added
      ? c.count
      : chunks[i + 1]?.added
        ? chunks[++i].count
        : 0;
    for (let n = 0; n < Math.max(removed, added); n++)
      row(
        n < removed && n < added
          ? "changed"
          : n < removed
            ? "removed"
            : "added",
        n < removed ? ai++ : null,
        n < added ? bi++ : null,
      );
    hunks.push({ ...h, leftEnd: ai, rightEnd: bi, endRow: rows.length });
  }
  return { rows, hunks };
}
export function adoptHunk(left, right, hunk, from) {
  if (!["left", "right"].includes(from)) throw new Error("无效的合并方向");
  let a = lines(left),
    b = lines(right);
  if (from === "left")
    b = b
      .slice(0, hunk.rightStart)
      .concat(a.slice(hunk.leftStart, hunk.leftEnd), b.slice(hunk.rightEnd));
  else
    a = a
      .slice(0, hunk.leftStart)
      .concat(b.slice(hunk.rightStart, hunk.rightEnd), a.slice(hunk.leftEnd));
  return { left: a.join("\n"), right: b.join("\n") };
}
