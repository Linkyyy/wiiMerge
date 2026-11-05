export function textNavigation(model) {
  return {
    leftTotal: Math.max(1, model.leftLines || 0),
    rightTotal: Math.max(1, model.rightLines || 0),
    ranges: model.hunks.map((h, index) => ({
      ...h,
      index,
      status:
        h.leftEnd === h.leftStart
          ? "added"
          : h.rightEnd === h.rightStart
            ? "removed"
            : "changed",
      label: `差分 ${index + 1} · 左 ${h.leftStart + 1} / 右 ${h.rightStart + 1}`,
    })),
  };
}
export function excelNavigation(details, rows, selectedSheet = "all") {
  const offsets = new Map();
  let leftTotal = 0,
    rightTotal = 0;
  for (const sheet of details.sheets) {
    if (selectedSheet !== "all" && sheet.name !== selectedSheet) continue;
    offsets.set(sheet.name, { left: leftTotal, right: rightTotal });
    leftTotal += Math.max(1, sheet.leftMaxRow ?? sheet.leftRows);
    rightTotal += Math.max(1, sheet.rightMaxRow ?? sheet.rightRows);
  }
  return {
    leftTotal: Math.max(1, leftTotal),
    rightTotal: Math.max(1, rightTotal),
    ranges: rows.map((c, index) => {
      const offset = offsets.get(c.sheet) || { left: 0, right: 0 };
      const leftStart = offset.left + Math.max(0, (c.leftRow || 1) - 1),
        rightStart = offset.right + Math.max(0, (c.rightRow || 1) - 1);
      return {
        index,
        status: c.status,
        leftStart,
        leftEnd: leftStart + (c.leftRow ? 1 : 0),
        rightStart,
        rightEnd: rightStart + (c.rightRow ? 1 : 0),
        label: `${c.sheet} · ${c.column}${c.leftRow || c.rightRow} · ${c.left} → ${c.right}`,
      };
    }),
  };
}
export function nearestDifference(ranges, side, fraction, total) {
  if (!ranges.length) return -1;
  const position = Math.max(0, Math.min(1, fraction)) * Math.max(1, total);
  let best = 0,
    distance = Infinity;
  ranges.forEach((r, i) => {
    const start = r[side + "Start"],
      end = r[side + "End"];
    const delta =
      position < start ? start - position : position > end ? position - end : 0;
    if (delta < distance) {
      best = i;
      distance = delta;
    }
  });
  return best;
}
