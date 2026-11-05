import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import iconv from "iconv-lite";
import { validateRules, pathMatcher } from "./rules.mjs";
import { compareText } from "./text.mjs";
import { compareExcel } from "./excel.mjs";
import { readArchive, LIMITS, isArchive, isWorkbook } from "./archive.mjs";
import { safeRead, inspectFile } from "./io.mjs";
export { safeRead } from "./io.mjs";

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
export function decode(buffer, encoding) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return iconv.decode(buffer.subarray(2), "utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff)
    return iconv.decode(buffer.subarray(2), "utf16be");
  if (encoding !== "auto") return iconv.decode(buffer, encoding);
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0)) return null;
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const controls = [...value.slice(0, 8192)].filter(
      (c) => c.charCodeAt(0) < 32 && !"\r\n\t\f".includes(c),
    ).length;
    return controls > 3 ? null : value.replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

async function collectSource(filename, rules, progress) {
  const matcher = pathMatcher(rules),
    entries = new Map();
  let excluded = 0;
  const add = (entry) => {
    const key = matcher.key(entry.path);
    if (!key) throw new Error(`路径匹配规则产生空路径：${entry.path}`);
    if (entries.has(key))
      throw new Error(
        `路径匹配冲突：「${entries.get(key).path}」与「${entry.path}」；请调整大小写或路径替换规则`,
      );
    entries.set(key, entry);
  };
  const expand = async (buffer, prefix = "", depth = 0) => {
    if (depth > LIMITS.depth) throw new Error("嵌套归档超过 3 层上限");
    const archive = await readArchive(buffer);
    const populated = new Set();
    for (const { name } of archive)
      for (
        let i = name.indexOf("/");
        i >= 0 && i < name.length - 1;
        i = name.indexOf("/", i + 1)
      )
        populated.add(name.slice(0, i + 1));
    for (const item of archive) {
      const rel = prefix + item.name;
      if (matcher.excluded(rel)) {
        excluded++;
        continue;
      }
      if (item.directory) {
        if (!populated.has(item.name))
          add({ path: rel.replace(/\/$/, ""), kind: "directory", size: 0 });
        continue;
      }
      if (isArchive(rel)) {
        try {
          await expand(item.buffer, `${rel}!/`, depth + 1);
        } catch (error) {
          add({ path: rel, error: error.message });
        }
      } else {
        add({ path: rel, size: item.size, read: async () => item.buffer });
      }
    }
  };
  const walk = async (dir, prefix = "", depth = 0) => {
    if (depth > 64) throw new Error("文件夹嵌套超过 64 层");
    const children = await fs.readdir(dir, { withFileTypes: true });
    if (!children.length && prefix)
      add({ path: prefix.replace(/\/$/, ""), kind: "directory", size: 0 });
    children.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const child of children) {
      const rel = prefix + child.name,
        absolute = path.join(dir, child.name);
      if (matcher.excluded(rel)) {
        excluded++;
        continue;
      }
      if (child.isSymbolicLink()) {
        add({ path: rel, error: "符号链接已跳过，避免读取比较范围外的数据" });
        continue;
      }
      if (child.isDirectory()) {
        await walk(absolute, `${rel}/`, depth + 1);
        continue;
      }
      if (!child.isFile()) {
        add({ path: rel, error: "不支持设备、管道或特殊文件" });
        continue;
      }
      progress?.({ phase: "scan", message: `正在扫描 ${rel}` });
      try {
        const stat = await fs.lstat(absolute);
        if (isArchive(rel)) await expand(await safeRead(absolute), `${rel}!/`);
        else
          add({
            path: rel,
            size: stat.size,
            file: absolute,
            read: () => safeRead(absolute),
          });
      } catch (error) {
        add({ path: rel, error: error.message });
      }
    }
  };
  const stat = await fs.lstat(filename);
  if (stat.isSymbolicLink())
    throw new Error("请选择真实文件或文件夹，不支持符号链接");
  if (stat.isDirectory()) await walk(filename);
  else if (stat.isFile() && isArchive(filename))
    await expand(await safeRead(filename));
  else if (stat.isFile())
    return {
      tree: false,
      entries: new Map([
        [
          "file",
          {
            path: path.basename(filename),
            size: stat.size,
            file: filename,
            read: () => safeRead(filename),
          },
        ],
      ]),
      excluded,
    };
  else throw new Error("请选择普通文件或文件夹");
  return { tree: true, entries, excluded, directory: stat.isDirectory() };
}

async function compareEntry(key, left, right, rules) {
  const item = {
    key,
    path: right?.path ?? left.path,
    leftPath: left?.path ?? null,
    rightPath: right?.path ?? null,
    leftSize: left?.size ?? null,
    rightSize: right?.size ?? null,
    status: !left ? "added" : !right ? "removed" : "equal",
    type: "binary",
  };
  try {
    if (left?.error || right?.error)
      throw new Error([left?.error, right?.error].filter(Boolean).join("；"));
    if (left?.kind === "directory" || right?.kind === "directory") {
      item.type = "directory";
      item.details = {
        kind: "directory",
        equal: left?.kind === "directory" && right?.kind === "directory",
        note:
          left && right && left.kind !== right.kind
            ? "同名路径类型不同：一侧是文件，另一侧是空文件夹。"
            : "空文件夹（含文件的目录通过下属文件进行比较）。",
      };
      if (left && right) item.status = item.details.equal ? "equal" : "changed";
      return item;
    }
    const lExcel = left && isWorkbook(left.path),
      rExcel = right && isWorkbook(right.path);
    const lInfo =
      !lExcel && !rExcel && rules.encoding === "auto" && left?.file
        ? await inspectFile(left.file)
        : null;
    const rInfo =
      !lExcel && !rExcel && rules.encoding === "auto" && right?.file
        ? await inspectFile(right.file)
        : null;
    if (lInfo?.binary || rInfo?.binary) {
      const fingerprint = async (entry, info) =>
        !entry
          ? null
          : info?.hash ||
            (entry.file
              ? (await inspectFile(entry.file)).hash
              : hash(await entry.read()));
      item.leftFingerprint = await fingerprint(left, lInfo);
      item.rightFingerprint = await fingerprint(right, rInfo);
      if (lInfo) item.leftSize = lInfo.size;
      if (rInfo) item.rightSize = rInfo.size;
      item.details = {
        kind: "binary",
        equal:
          !!left && !!right && item.leftFingerprint === item.rightFingerprint,
        leftHash: item.leftFingerprint,
        rightHash: item.rightFingerprint,
        note: "流式读取并比较 SHA-256 指纹，无固定文件大小限制。",
      };
      if (left && right) item.status = item.details.equal ? "equal" : "changed";
      return item;
    }
    const a = left
        ? lInfo?.size === 0
          ? Buffer.alloc(0)
          : await left.read()
        : null,
      b = right
        ? rInfo?.size === 0
          ? Buffer.alloc(0)
          : await right.read()
        : null;
    item.leftFingerprint = a ? hash(a) : null;
    item.rightFingerprint = b ? hash(b) : null;
    if (
      (lInfo && lInfo.hash !== item.leftFingerprint) ||
      (rInfo && rInfo.hash !== item.rightFingerprint)
    )
      throw new Error("读取期间文件发生变化，请重新比较");
    if (lExcel || rExcel) {
      if ((left && !lExcel) || (right && !rExcel))
        throw new Error("Excel 必须与 Excel 文件比较");
      item.type = "excel";
      item.details = await compareExcel(a, b, rules);
    } else {
      const aText = a ? decode(a, rules.encoding) : "",
        bText = b ? decode(b, rules.encoding) : "";
      if (aText !== null && bText !== null) {
        item.type = "text";
        item.details = compareText(aText, bText, rules);
      } else {
        item.details = {
          kind: "binary",
          equal: !!a && !!b && a.equals(b),
          leftHash: a ? hash(a) : null,
          rightHash: b ? hash(b) : null,
          note: "二进制或无法按所选编码解码的内容按原始字节比较；可在规则中指定文本编码。",
        };
      }
    }
    if (left && right) item.status = item.details.equal ? "equal" : "changed";
  } catch (error) {
    item.status = "error";
    item.error = error.message;
  }
  return item;
}

export async function compare(request, onProgress) {
  const started = Date.now(),
    rules = validateRules(request.rules);
  let lastProgress = 0;
  const progress = (value) => {
    if (Date.now() - lastProgress > 80 || value.phase === "complete") {
      onProgress?.(value);
      lastProgress = Date.now();
    }
  };
  const mode = request.mode;
  if (!["text", "files", "folders"].includes(mode))
    throw new Error("无效的比较模式");
  let items,
    excluded = 0;
  if (mode === "text") {
    if (typeof request.left !== "string" || typeof request.right !== "string")
      throw new Error("请输入左右两侧文本");
    const details = compareText(request.left, request.right, rules);
    items = [
      {
        key: "text",
        path: "文本比较",
        leftPath: "左侧文本",
        rightPath: "右侧文本",
        type: "text",
        status: details.equal ? "equal" : "changed",
        details,
      },
    ];
  } else {
    for (const value of [request.left, request.right])
      if (typeof value !== "string" || !value || value.length > 4096)
        throw new Error("请先选择左右两侧路径");
    progress({ phase: "scan", message: "正在扫描左侧…" });
    const left = await collectSource(request.left, rules, progress);
    progress({ phase: "scan", message: "正在扫描右侧…" });
    const right = await collectSource(request.right, rules, progress);
    if (left.tree !== right.tree)
      throw new Error("请选择两个普通文件，或两个文件夹 / ZIP、WAR、JAR 归档");
    if (mode === "folders" && (!left.directory || !right.directory))
      throw new Error("文件夹模式需要选择两个文件夹");
    const keys = [
      ...new Set([...left.entries.keys(), ...right.entries.keys()]),
    ].sort((a, b) => a.localeCompare(b, "en"));
    items = [];
    excluded = left.excluded + right.excluded;
    for (const key of keys) {
      progress({
        phase: "compare",
        message: `正在比较 ${key === "file" ? left.entries.get(key)?.path : key}`,
        completed: items.length,
        total: keys.length,
      });
      items.push(
        await compareEntry(
          key,
          left.entries.get(key),
          right.entries.get(key),
          rules,
        ),
      );
    }
  }
  const summary = {
    added: 0,
    removed: 0,
    changed: 0,
    equal: 0,
    error: 0,
    total: items.length,
    excluded,
  };
  for (const item of items) summary[item.status]++;
  progress({
    phase: "complete",
    message: "比较完成",
    completed: items.length,
    total: items.length,
  });
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    mode,
    leftLabel: mode === "text" ? "左侧文本" : request.left,
    rightLabel: mode === "text" ? "右侧文本" : request.right,
    rules,
    summary,
    items,
  };
}
