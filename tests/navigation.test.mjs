import { test } from "node:test";
import assert from "node:assert/strict";
import { textModel } from "../core/hunks.mjs";
import {
  textNavigation,
  excelNavigation,
  nearestDifference,
} from "../core/navigation.mjs";

test("missing Excel sides use insertion points while the existing side retains its row position", () => {
  const details = {
    sheets: [{ name: "New", leftMaxRow: 0, rightMaxRow: 2000 }],
  };
  const nav = excelNavigation(details, [
    {
      sheet: "New",
      column: "A",
      leftRow: null,
      rightRow: 1900,
      status: "added",
    },
  ]);
  assert.equal(nav.ranges[0].leftStart, nav.ranges[0].leftEnd);
  assert.equal(nav.ranges[0].rightStart, 1899);
  assert.equal(nav.ranges[0].rightEnd, 1900);
});

test("visual text navigation preserves whole-document positions and nearest-hunk jumps", () => {
  const a = Array.from({ length: 2000 }, (_, i) => `line ${i}`),
    b = [...a];
  b[5] = "early";
  b[1850] = "late";
  const nav = textNavigation(textModel(a.join("\n"), b.join("\n")));
  assert.equal(nav.leftTotal, 2000);
  assert.equal(nav.ranges.length, 2);
  assert.ok(nav.ranges[0].leftStart / nav.leftTotal < 0.01);
  assert.ok(nav.ranges[1].rightStart / nav.rightTotal > 0.9);
  assert.equal(nearestDifference(nav.ranges, "right", 0.95, nav.rightTotal), 1);
  assert.equal(nearestDifference(nav.ranges, "left", 0, nav.leftTotal), 0);
  assert.equal(nearestDifference([], "left", 1, 1), -1);
});
test("Excel navigation uses original row numbers and per-sheet offsets after key matching", () => {
  const d = {
    sheets: [
      { name: "A", leftMaxRow: 2000, rightMaxRow: 3000 },
      { name: "B", leftMaxRow: 100, rightMaxRow: 100 },
    ],
  };
  const rows = [
    {
      sheet: "A",
      column: "B",
      leftRow: 1800,
      rightRow: 2900,
      status: "changed",
    },
    { sheet: "B", column: "C", leftRow: 50, rightRow: 70, status: "changed" },
  ];
  const all = excelNavigation(d, rows);
  assert.equal(all.leftTotal, 2100);
  assert.equal(all.ranges[1].rightStart, 3069);
  const one = excelNavigation(d, [rows[0]], "A");
  assert.equal(one.ranges[0].leftStart, 1799);
  assert.equal(one.rightTotal, 3000);
});
