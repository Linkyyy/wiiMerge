import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import iconv from "iconv-lite";
import { decode } from "./compare.mjs";
import { safeRead, inspectFile } from "./io.mjs";
import { isArchive, readArchive } from "./archive.mjs";
import { compareText } from "./text.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return (
    !rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel)
  );
};
async function sideSource(root, relative, missing, encoding, binary = false) {
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink()) throw new Error("不读取符号链接");
  let file = root,
    virtual = false,
    buffer = null,
    boundary = null;
  const pieces = (relative || "").split("!/");
  if (stat.isDirectory()) {
    boundary = await fs.realpath(root);
    file = path.resolve(root, pieces.shift() || "");
    if (!inside(path.resolve(root), file))
      throw new Error("文件路径超出比较范围");
    if (!missing) {
      if (!inside(boundary, await fs.realpath(file)))
        throw new Error("文件路径超出比较范围");
      if (!binary || isArchive(file)) buffer = await safeRead(file);
    }
  } else {
    if (!missing && (!binary || isArchive(file))) buffer = await safeRead(file);
    boundary = path.dirname(await fs.realpath(root));
    if (!isArchive(root)) pieces.length = 0;
  }
  if (isArchive(file) && !missing) {
    virtual = true;
    for (const member of pieces) {
      const entry = (await readArchive(buffer)).find((e) => e.name === member);
      if (!entry || entry.directory)
        throw new Error("归档条目已改变，请重新比较");
      buffer = entry.buffer;
    }
  } else if (pieces.length) virtual = true;
  if (binary)
    return {
      file,
      boundary,
      virtual,
      buffer,
      exists: !missing,
      fingerprint: missing
        ? null
        : buffer
          ? hash(buffer)
          : (await inspectFile(file)).hash,
    };
  const text = buffer ? decode(buffer, encoding) : "";
  if (text === null) throw new Error("该条目不是可合并文本");
  let codec = encoding === "auto" ? "utf8" : encoding,
    bom = "";
  if (buffer?.[0] === 255 && buffer?.[1] === 254) {
    codec = "utf16le";
    bom = "fffe";
  } else if (buffer?.[0] === 254 && buffer?.[1] === 255) {
    codec = "utf16be";
    bom = "feff";
  } else if (buffer?.subarray(0, 3).equals(Buffer.from([239, 187, 191])))
    bom = "efbbbf";
  return {
    file,
    label: virtual ? file + "!/" + pieces.join("!/") : file,
    boundary,
    virtual,
    exists: !missing,
    fingerprint: buffer ? hash(buffer) : null,
    codec,
    bom,
    eol: text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n",
    text: text.replace(/\r\n?/g, "\n"),
  };
}

export class Workspace {
  constructor(execute, dataDir, updated = () => {}) {
    this.execute = execute;
    this.dataDir = dataDir;
    this.updated = updated;
    this.reports = new Map();
    this.documents = new Map();
  }
  add(report, request) {
    if (this.reports.size >= 8) {
      const unused = [...this.reports.keys()].find(
        (id) => ![...this.documents.values()].some((d) => d.reportId === id),
      );
      if (!unused) throw new Error("比较会话过多，请关闭文件差分后重试");
      this.reports.delete(unused);
    }
    this.reports.set(report.id, { report, request: structuredClone(request) });
    return report;
  }
  session(id) {
    const value = this.reports.get(id);
    if (!value) throw new Error("比较会话已过期，请重新比较");
    return value;
  }
  release(reportId) {
    for (const [id, document] of this.documents)
      if (document.reportId === reportId) this.documents.delete(id);
  }
  getReport(id) {
    const report = structuredClone(this.session(id).report);
    for (const d of this.documents.values())
      if (
        d.reportId === id &&
        (d.left !== d.sources.left.text || d.right !== d.sources.right.text)
      ) {
        const item = report.items.find((i) => i.key === d.itemKey);
        item.details = compareText(d.left, d.right, DEFAULT_RULES);
        item.status = item.details.equal ? "equal" : "changed";
        report.draft = true;
      }
    for (const k of ["added", "removed", "changed", "equal", "error"])
      report.summary[k] = report.items.filter((i) => i.status === k).length;
    return report;
  }
  async open(reportId, itemKey) {
    const old = [...this.documents.values()].find(
      (d) => d.reportId === reportId && d.itemKey === itemKey,
    );
    if (old) return this.describe(old);
    if (this.documents.size >= 32)
      throw new Error("最多同时打开 32 个文本文件");
    const { report, request } = this.session(reportId),
      item = report.items.find((i) => i.key === itemKey);
    if (!item || item.type !== "text" || item.error)
      throw new Error("该条目不支持文本合并");
    const sources = {};
    for (const side of ["left", "right"])
      sources[side] =
        request.mode === "text"
          ? {
              file: null,
              virtual: true,
              text: request[side].replace(/\r\n?/g, "\n"),
              codec: "utf8",
              bom: "",
              eol: "\n",
            }
          : await sideSource(
              request[side],
              item[side + "Path"] ?? item.path,
              item[side + "Path"] === null,
              report.rules.encoding,
            );
    const d = {
      id: randomUUID(),
      reportId,
      itemKey,
      sources,
      left: sources.left.text,
      right: sources.right.text,
    };
    this.documents.set(d.id, d);
    return this.describe(d);
  }
  document(id) {
    const d = this.documents.get(id);
    if (!d) throw new Error("文件会话已关闭");
    return d;
  }
  describe(d) {
    return {
      id: d.id,
      reportId: d.reportId,
      itemKey: d.itemKey,
      left: d.left,
      right: d.right,
      savedLeft: d.sources.left.text,
      savedRight: d.sources.right.text,
      sides: Object.fromEntries(
        ["left", "right"].map((s) => [
          s,
          {
            label:
              d.sources[s].label ||
              d.sources[s].file ||
              (s === "left" ? "左侧文本" : "右侧文本"),
            writable: !d.sources[s].virtual && !!d.sources[s].file,
            encoding: d.sources[s].codec,
          },
        ]),
      ),
    };
  }
  preview(id, left, right) {
    const d = this.document(id);
    for (const text of [left, right])
      if (typeof text !== "string") throw new Error("请输入有效的合并文本");
    d.left = left;
    d.right = right;
    return true;
  }
  async save(id, side, saveAs) {
    if (!["left", "right"].includes(side)) throw new Error("无效的保存方向");
    const d = this.document(id),
      source = d.sources[side];
    if (!saveAs && (source.virtual || !source.file))
      throw new Error("归档条目或粘贴文本请使用另存为");
    const target = saveAs || source.file;
    if (!path.isAbsolute(target)) throw new Error("无效的保存路径");
    if (source.boundary && !saveAs) {
      let parent = path.dirname(target);
      while (true) {
        try {
          const real = await fs.realpath(parent);
          if (!inside(source.boundary, real))
            throw new Error("目标文件夹超出比较范围");
          break;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          const next = path.dirname(parent);
          if (next === parent) throw e;
          parent = next;
        }
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    let current = null;
    try {
      if ((await fs.lstat(target)).isSymbolicLink())
        throw new Error("不覆盖符号链接");
      current = await safeRead(target);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (!saveAs && (current ? hash(current) : null) !== source.fingerprint)
      throw new Error("源文件已被其他程序修改，请重新打开差分；未覆盖任何内容");
    const text = d[side].replace(/\r\n?/g, "\n").replace(/\n/g, source.eol);
    const codec = saveAs ? "utf8" : source.codec;
    const encoded = iconv.encode(text, codec);
    if (iconv.decode(encoded, codec) !== text)
      throw new Error("目标编码不能完整表示合并内容，请另存为 UTF-8");
    const bytes = Buffer.concat([
      !saveAs && source.bom ? Buffer.from(source.bom, "hex") : Buffer.alloc(0),
      encoded,
    ]);
    const temp = target + ".wiimerge-" + randomUUID() + ".tmp";
    let backup = null;
    if (current) {
      const folder = path.join(this.dataDir, "backups");
      await fs.mkdir(folder, { recursive: true });
      backup = path.join(folder, randomUUID() + ".bak");
      await fs.writeFile(backup, current, { mode: 0o600 });
      await fs.writeFile(
        backup + ".json",
        JSON.stringify({ target, createdAt: new Date().toISOString() }),
      );
    }
    try {
      await fs.writeFile(temp, bytes, {
        flag: "wx",
        mode: current ? (await fs.stat(target)).mode & 0o777 : 0o600,
      });
      if (!saveAs) {
        let latest = null;
        try {
          latest = await safeRead(target);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        if ((latest ? hash(latest) : null) !== source.fingerprint)
          throw new Error("保存前源文件发生变化，已取消覆盖");
      }
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
    if (!saveAs) {
      source.text = d[side];
      source.fingerprint = hash(bytes);
      source.exists = true;
      const session = this.session(d.reportId);
      try {
        const fresh = await this.execute({
          action: "compare",
          request: session.request,
        });
        fresh.id = d.reportId;
        session.report = fresh;
      } catch {
        const item = session.report.items.find((i) => i.key === d.itemKey);
        item.details = compareText(d.left, d.right, session.report.rules);
        item.status = item.details.equal ? "equal" : "changed";
      }
      this.updated(this.getReport(d.reportId));
    }
    return { path: target, backup, document: this.describe(d) };
  }

  async adoptFile(reportId, itemKey, from) {
    if (!["left", "right"].includes(from)) throw new Error("无效的采用方向");
    const session = this.session(reportId),
      item = session.report.items.find((i) => i.key === itemKey);
    if (
      !item ||
      item.error ||
      item.type === "directory" ||
      session.request.mode === "text"
    )
      throw new Error("该条目不支持整文件替换");
    const to = from === "left" ? "right" : "left";
    if (!item[from + "Path"])
      throw new Error("来源文件不存在；不会隐式删除目标文件");
    const a = await sideSource(
      session.request[from],
      item[from + "Path"],
      false,
      "auto",
      true,
    );
    const b = await sideSource(
      session.request[to],
      item[to + "Path"] || item.path,
      !item[to + "Path"],
      "auto",
      true,
    );
    if (b.virtual)
      throw new Error("归档内条目不直接回写；文本可按块合并后另存");
    if (
      a.fingerprint !== item[from + "Fingerprint"] ||
      b.fingerprint !== (item[to + "Fingerprint"] ?? null)
    )
      throw new Error("文件已发生外部修改，请重新比较");
    if (b.boundary) {
      let parent = path.dirname(b.file);
      while (true) {
        try {
          if (!inside(b.boundary, await fs.realpath(parent)))
            throw new Error("目标超出比较范围");
          break;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          parent = path.dirname(parent);
        }
      }
    }
    await fs.mkdir(path.dirname(b.file), { recursive: true });
    let backup = null;
    if (b.exists) {
      const folder = path.join(this.dataDir, "backups");
      await fs.mkdir(folder, { recursive: true });
      backup = path.join(folder, randomUUID() + ".bak");
      await fs.copyFile(b.file, backup);
      await fs.chmod(backup, 0o600);
      if ((await inspectFile(backup)).hash !== b.fingerprint)
        throw new Error("备份期间文件发生变化，已取消覆盖");
      await fs.writeFile(backup + ".json", JSON.stringify({ target: b.file }));
    }
    const temp = b.file + ".wiimerge-" + randomUUID() + ".tmp";
    try {
      if (a.virtual)
        await fs.writeFile(temp, a.buffer, { flag: "wx", mode: 0o600 });
      else await fs.copyFile(a.file, temp, fs.constants.COPYFILE_EXCL);
      await fs.chmod(
        temp,
        b.exists ? (await fs.stat(b.file)).mode & 0o777 : 0o600,
      );
      if ((await inspectFile(temp)).hash !== a.fingerprint)
        throw new Error("复制期间来源文件发生变化，已取消覆盖");
      let latest = null;
      try {
        latest = (await inspectFile(b.file)).hash;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (latest !== b.fingerprint)
        throw new Error("保存前文件发生变化，已取消覆盖");
      await fs.rename(temp, b.file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    const fresh = await this.execute({
      action: "compare",
      request: session.request,
    });
    fresh.id = reportId;
    session.report = fresh;
    this.updated(fresh);
    return { path: b.file, backup };
  }
}
