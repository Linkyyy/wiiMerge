import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import { compare } from "../core/compare.mjs";
import { compareText } from "../core/text.mjs";
import { compareExcel } from "../core/excel.mjs";
import { DEFAULT_RULES, validateRules } from "../core/rules.mjs";
import { readArchive } from "../core/archive.mjs";
import { zip, workbook, temporary } from "./helpers.mjs";

test("text aligns replacements, additions, removals and original line numbers", () => {
  const result = compareText(
    "one\ntwo\nthree",
    "one\nTWO\nthree\nfour",
    DEFAULT_RULES,
  );
  assert.equal(result.equal, false);
  assert.deepEqual(result.counts, {
    equal: 2,
    changed: 1,
    added: 1,
    removed: 0,
  });
  assert.deepEqual(result.rows[1], {
    status: "changed",
    left: "two",
    right: "TWO",
    leftLine: 2,
    rightLine: 2,
  });
  assert.equal(result.rows[3].leftLine, null);
  const removed = compareText("a\nb", "a", DEFAULT_RULES);
  assert.equal(removed.counts.removed, 1);
});

test("normalization respects whitespace, case, ignored lines and replacements", () => {
  const rules = validateRules({
    ignoreCase: true,
    whitespace: "all",
    ignoreBlankLines: true,
    ignoreLines: ["^#"],
    replacements: [{ pattern: "v\\d+", replacement: "v" }],
  });
  const result = compareText("#old\n A B v12\n\nC\n", "#new\nab v23\nc", rules);
  assert.equal(result.equal, true);
  assert.equal(result.rows[0].leftLine, 2);
  assert.equal(result.rows[1].leftLine, 4);
  assert.equal(compareText("a\r\nb\r\n", "a\nb\n", DEFAULT_RULES).equal, true);
  assert.equal(compareText("a", "a\n", DEFAULT_RULES).equal, false);
  assert.equal(compareText("", "", DEFAULT_RULES).rows.length, 0);
});

test("rules reject invalid and unsafe regular expressions and invalid key columns", () => {
  assert.throws(() => validateRules({ ignoreLines: ["["] }), /无效/);
  assert.throws(() => validateRules({ ignoreLines: ["(a+)+$"] }), /过于复杂/);
  assert.throws(() => validateRules({ excelKeyColumns: "A;B" }), /主键/);
  assert.throws(() => validateRules({ excelKeyColumns: "ZZ" }), /256/);
  assert.throws(() => validateRules({ ignoreCase: "true" }), /布尔/);
  assert.deepEqual(validateRules().exclude, DEFAULT_RULES.exclude);
});

test("folder comparison excludes noise, matches relative paths and includes binary changes", async (t) => {
  const dir = await temporary(t),
    left = path.join(dir, "a"),
    right = path.join(dir, "b");
  await fs.mkdir(path.join(left, "node_modules"), { recursive: true });
  await fs.mkdir(right);
  await fs.writeFile(path.join(left, "node_modules/ignored.txt"), "ignored");
  await fs.writeFile(path.join(left, "same.txt"), "same\n");
  await fs.writeFile(path.join(right, "same.txt"), "same\n");
  await fs.writeFile(path.join(left, "gone.txt"), "removed");
  await fs.writeFile(path.join(right, "new.txt"), "new");
  await fs.writeFile(path.join(left, "data.bin"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(right, "data.bin"), Buffer.from([0, 1, 3]));
  const report = await compare({ mode: "folders", left, right });
  assert.deepEqual(report.summary, {
    added: 1,
    removed: 1,
    changed: 1,
    equal: 1,
    error: 0,
    total: 4,
    excluded: 1,
  });
  const binary = report.items.find((i) => i.path === "data.bin");
  assert.equal(binary.type, "binary");
  assert.notEqual(binary.details.leftHash, binary.details.rightHash);
});

test("path replacement matches renamed files, and ambiguous paths fail explicitly", async (t) => {
  const dir = await temporary(t),
    left = path.join(dir, "a"),
    right = path.join(dir, "b");
  await fs.mkdir(left);
  await fs.mkdir(right);
  await fs.writeFile(path.join(left, "config-v1.txt"), "ok");
  await fs.writeFile(path.join(right, "config-v2.txt"), "ok");
  const rules = { pathReplacements: [{ pattern: "-v\\d+", replacement: "" }] };
  const report = await compare({ mode: "folders", left, right, rules });
  assert.equal(report.summary.equal, 1);
  assert.equal(report.items[0].leftPath, "config-v1.txt");
  await fs.writeFile(path.join(right, "config-v3.txt"), "ok");
  await assert.rejects(
    compare({ mode: "folders", left, right, rules }),
    /路径匹配冲突/,
  );
});

test("ZIP / WAR / JAR expand nested archives without extraction and support folder-to-archive", async (t) => {
  const dir = await temporary(t);
  const a = await zip({
    "WEB-INF/lib/app.jar": await zip({
      "app.properties": "version=1",
      "unchanged.txt": "same",
    }),
    "index.html": "old",
  });
  const b = await zip({
    "WEB-INF/lib/app.jar": await zip({
      "app.properties": "version=2",
      "unchanged.txt": "same",
    }),
    "index.html": "new",
  });
  const left = path.join(dir, "a.war"),
    right = path.join(dir, "b.war");
  await fs.writeFile(left, a);
  await fs.writeFile(right, b);
  const report = await compare({ mode: "files", left, right });
  assert.equal(report.summary.changed, 2);
  assert.equal(report.summary.equal, 1);
  assert.ok(
    report.items.some((i) => i.path === "WEB-INF/lib/app.jar!/app.properties"),
  );
  const folder = path.join(dir, "folder");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "hello.txt"), "hello");
  const archive = path.join(dir, "folder.zip");
  await fs.writeFile(archive, await zip({ "hello.txt": "hello" }));
  assert.equal(
    (await compare({ mode: "files", left: folder, right: archive })).summary
      .equal,
    1,
  );
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "a.war",
    "b.war",
    "folder",
    "folder.zip",
  ]);
});

test("malformed, unsafe and oversized archives fail; partial errors never become equal", async (t) => {
  await assert.rejects(readArchive(Buffer.from("not zip")));
  const valid = await zip({ "xxx/safe.txt": "hello" });
  const unsafe = Buffer.from(
    valid.toString("latin1").replaceAll("xxx/safe.txt", "../safe.txt!"),
    "latin1",
  );
  await assert.rejects(readArchive(unsafe), /invalid|不安全/i);
  const large = await zip({ "huge.txt": Buffer.alloc(17 * 1024 * 1024, 65) });
  await assert.rejects(readArchive(large), /16 MiB/);
  const dir = await temporary(t),
    left = path.join(dir, "a"),
    right = path.join(dir, "b");
  await fs.mkdir(left);
  await fs.mkdir(right);
  await fs.writeFile(path.join(left, "broken.zip"), "broken");
  await fs.writeFile(path.join(right, "broken.zip"), "broken");
  const report = await compare({ mode: "folders", left, right });
  assert.equal(report.summary.error, 1);
  assert.equal(report.summary.equal, 0);
});

test(
  "symlinks do not read outside the selected directory",
  { skip: process.platform === "win32" },
  async (t) => {
    const dir = await temporary(t),
      left = path.join(dir, "a"),
      right = path.join(dir, "b");
    await fs.mkdir(left);
    await fs.mkdir(right);
    await fs.writeFile(path.join(dir, "secret"), "private");
    await fs.symlink(path.join(dir, "secret"), path.join(left, "secret"));
    const result = await compare({ mode: "folders", left, right });
    assert.equal(result.summary.error, 1);
    assert.match(result.items[0].error, /符号链接/);
    assert.equal(JSON.stringify(result).includes("private"), false);
  },
);

test("explicit GB18030 and UTF-16 BOM decode correctly; empty file retains existence status", async (t) => {
  const dir = await temporary(t),
    left = path.join(dir, "a.txt"),
    right = path.join(dir, "b.txt");
  await fs.writeFile(left, iconv.encode("中文原文", "gb18030"));
  await fs.writeFile(right, iconv.encode("中文改动", "gb18030"));
  const report = await compare({
    mode: "files",
    left,
    right,
    rules: { encoding: "gb18030" },
  });
  assert.equal(report.items[0].type, "text");
  assert.equal(report.items[0].details.rows[0].left, "中文原文");
  await fs.writeFile(
    left,
    Buffer.concat([Buffer.from([255, 254]), iconv.encode("中文", "utf16le")]),
  );
  await fs.writeFile(right, "中文");
  assert.equal(
    (await compare({ mode: "files", left, right })).summary.equal,
    1,
  );
  const folder = path.join(dir, "f");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "empty.txt"), "");
  const empty = path.join(dir, "empty");
  await fs.mkdir(empty);
  assert.equal(
    (await compare({ mode: "folders", left: empty, right: folder })).summary
      .added,
    1,
  );
});

test("Excel compares cells, formulas, additions and deleted sheets", async () => {
  const left = await workbook({
    Data: [
      ["ID", "Name", "Total"],
      [1, "Alice", { formula: "1+2", result: 3 }],
      [2, "Bob", 5],
    ],
    Deleted: [],
  });
  const right = await workbook({
    Data: [
      ["ID", "Name", "Total"],
      [1, "ALICE", { formula: "2+1", result: 3 }],
      [2, "Bob", 6],
    ],
    Added: [],
  });
  const diff = await compareExcel(left, right, validateRules());
  assert.equal(diff.counts.changed, 3);
  assert.equal(diff.sheets.find((s) => s.name === "Deleted").status, "removed");
  assert.equal(diff.sheets.find((s) => s.name === "Added").status, "added");
  const normalized = await compareExcel(
    left,
    right,
    validateRules({ ignoreCase: true, excelFormulas: false }),
  );
  assert.equal(normalized.counts.changed, 1);
  assert.equal(normalized.changes[0].column, "C");
  assert.equal(normalized.changes[0].leftRow, 3);
});

test("Excel key columns align reordered rows and reject duplicate / empty keys", async () => {
  const left = await workbook({
    Data: [
      ["ID", "Name"],
      [1, "Alice"],
      [2, "Bob"],
    ],
  });
  const right = await workbook({
    Data: [
      ["ID", "Name"],
      [2, "Bob"],
      [1, "Alice"],
    ],
  });
  assert.equal(
    (await compareExcel(left, right, validateRules({ excelKeyColumns: "A" })))
      .equal,
    true,
  );
  assert.equal((await compareExcel(left, right, validateRules())).equal, false);
  const duplicate = await workbook({
    Data: [
      ["ID", "Name"],
      [1, "Alice"],
      [1, "Bob"],
    ],
  });
  await assert.rejects(
    compareExcel(left, duplicate, validateRules({ excelKeyColumns: "A" })),
    /主键重复/,
  );
  const empty = await workbook({
    Data: [
      ["ID", "Name"],
      [null, "Alice"],
    ],
  });
  await assert.rejects(
    compareExcel(left, empty, validateRules({ excelKeyColumns: "A" })),
    /主键为空/,
  );
});

test("text truncation is explicit and statistics include differences beyond preview limit", () => {
  const a = Array(12010).fill("same").join("\n"),
    b = a + "\nnew";
  const diff = compareText(a, b, DEFAULT_RULES);
  assert.equal(diff.truncated, true);
  assert.equal(diff.rows.length, 1);
  assert.equal(diff.contextOmitted, true);
  assert.equal(diff.rows[0].right, "new");
  assert.equal(diff.rows[0].rightLine, 12011);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.equal, false);
});

test("empty directories and file-versus-directory conflicts are preserved", async (t) => {
  const dir = await temporary(t),
    left = path.join(dir, "a"),
    right = path.join(dir, "b");
  await fs.mkdir(path.join(left, "same"), { recursive: true });
  await fs.mkdir(path.join(right, "same"), { recursive: true });
  await fs.mkdir(path.join(left, "only-left"));
  await fs.mkdir(path.join(left, "conflict"));
  await fs.writeFile(path.join(right, "conflict"), "file");
  const report = await compare({ mode: "folders", left, right });
  assert.equal(report.summary.equal, 1);
  assert.equal(report.summary.removed, 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.items.find((i) => i.path === "same").type, "directory");
  assert.match(
    report.items.find((i) => i.path === "conflict").details.note,
    /类型不同/,
  );
  const archive = path.join(dir, "folder.zip");
  await fs.writeFile(
    archive,
    await zip({ "same/": "", "only-left/": "", "conflict/": "" }),
  );
  assert.equal(
    (await compare({ mode: "files", left, right: archive })).summary.equal,
    3,
  );
});

test("workbooks inside archives use cell comparison rather than binary comparison", async (t) => {
  const dir = await temporary(t),
    left = path.join(dir, "a.zip"),
    right = path.join(dir, "b.zip");
  await fs.writeFile(
    left,
    await zip({
      "数据.xlsx": await workbook({
        Sheet: [
          ["ID", "Value"],
          [1, 10],
        ],
      }),
    }),
  );
  await fs.writeFile(
    right,
    await zip({
      "数据.xlsx": await workbook({
        Sheet: [
          ["ID", "Value"],
          [1, 20],
        ],
      }),
    }),
  );
  const report = await compare({ mode: "files", left, right });
  assert.equal(report.items[0].type, "excel");
  assert.equal(report.items[0].details.changes[0].left, "10");
});
