import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewTree, treeRows } from "../core/tree.mjs";

function sample() {
  const folder = (key, parentKey, status, type = "directory") => ({
    key,
    matchKey: key,
    parentKey,
    path: key,
    status,
    type,
    container: true,
  });
  const file = (key, parentKey, status) => ({
    key,
    parentKey,
    path: key,
    status,
    type: "text",
  });
  return {
    folders: [
      folder("src", null, "changed"),
      folder("nested", "src", "changed"),
      folder("stable", null, "equal"),
      folder("app.war", null, "changed", "archive"),
      folder("app.jar", "app.war", "changed", "archive"),
    ],
    items: [
      file("changed.txt", "nested", "changed"),
      file("equal.txt", "src", "equal"),
      file("new.txt", "app.jar", "added"),
      file("root.txt", null, "equal"),
    ],
  };
}
test("tree expansion preserves parent rows, indentation and archive hierarchy; collapsing never removes objects", () => {
  const tree = overviewTree(sample());
  assert.deepEqual(
    treeRows(tree).map((r) => r.item.key),
    ["app.war", "src", "stable", "root.txt"],
  );
  const rows = treeRows(tree, new Set(["src", "nested", "app.war", "app.jar"]));
  assert.equal(rows.length, 9);
  assert.equal(rows.find((r) => r.item.key === "changed.txt").level, 2);
  assert.equal(rows.find((r) => r.item.key === "new.txt").level, 2);
  assert.equal(
    treeRows(tree, new Set(["nested"])).some(
      (r) => r.item.key === "changed.txt",
    ),
    false,
  );
});
test("hide equal and hide differences retain only required ancestors; search opens the whole matching path", () => {
  const differences = overviewTree(sample(), { filter: "differences" });
  const expanded = new Set([...differences.autoExpanded]);
  assert.deepEqual(
    new Set(treeRows(differences, expanded).map((r) => r.item.key)),
    new Set(["src", "nested", "changed.txt", "app.war", "app.jar", "new.txt"]),
  );
  const equal = overviewTree(sample(), { filter: "equal" });
  const rows = treeRows(equal, equal.autoExpanded);
  assert.deepEqual(
    new Set(rows.map((r) => r.item.key)),
    new Set(["src", "stable", "root.txt", "equal.txt"]),
  );
  assert.equal(equal.matches.has("src"), false);
  const search = overviewTree(sample(), {
    search: "new.txt",
    folderKey: "src",
  });
  assert.deepEqual(
    treeRows(search, search.autoExpanded).map((r) => r.item.key),
    ["app.war", "app.jar", "new.txt"],
  );
  assert.equal(treeRows(search, new Set()).length, 1);
});
test("expanded trees retain all entries beyond UI pages and keep scoped subtree roots", () => {
  const report = sample();
  report.items.push(
    ...Array.from({ length: 5001 }, (_, i) => ({
      key: `entry-${i}`,
      parentKey: "nested",
      path: `src/nested/entry-${i}`,
      type: "text",
      status: "changed",
    })),
  );
  const tree = overviewTree(report, { folderKey: "src" });
  assert.equal(treeRows(tree).length, 2);
  const rows = treeRows(tree, new Set(["nested"]));
  assert.equal(rows.length, 5004);
  assert.ok(rows.some((r) => r.item.key === "entry-5000"));
  assert.equal(rows.find((r) => r.item.key === "changed.txt").level, 1);
});
