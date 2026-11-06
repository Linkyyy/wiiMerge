import yauzl from "yauzl";
import path from "node:path";

export const LIMITS = Object.freeze({
  depth: 3,
});
export const isArchive = (name) => /\.(zip|war|jar)$/i.test(name);
export const isWorkbook = (name) => /\.(xls|xlsx|xlsm)$/i.test(name);

export const archiveDisplayPath = (name) =>
  name.replaceAll("⟦", "⟦⟦").replaceAll("⟧", "⟧⟧");
export function archiveDisplayName(name, occurrence = 1) {
  const escaped = archiveDisplayPath(name);
  if (occurrence === 1) return escaped;
  const ext = path.posix.extname(escaped);
  return (
    escaped.slice(0, escaped.length - ext.length) + `⟦同名#${occurrence}⟧` + ext
  );
}

export async function readArchive(
  buffer,
  { collect = true, rejectDuplicates = false } = {},
) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (err, value) => (err ? reject(err) : resolve(value)),
    ),
  );
  return new Promise((resolve, reject) => {
    const entries = [],
      names = new Map();
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(
          entries.map((e) => ({
            ...e,
            duplicateCount: names.get(e.name),
            displayName: archiveDisplayName(e.name, e.occurrence),
          })),
        );
      }
    });
    zip.on("entry", (entry) => {
      (async () => {
        const name = entry.fileName;
        if (
          name.includes("\0") ||
          /(^|\/)\.\.(\/|$)/.test(name) ||
          /^[A-Za-z]:/.test(name) ||
          name.startsWith("/") ||
          name.includes("\\")
        )
          throw new Error("归档包含不安全的路径");
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000)
          throw new Error(`归档含有符号链接：${name}`);
        const occurrence = (names.get(name) || 0) + 1;
        if (rejectDuplicates && occurrence > 1)
          throw new Error(`Excel 工作簿包包含重复路径：${name}`);
        names.set(name, occurrence);
        if (entry.generalPurposeBitFlag & 1)
          throw new Error(`不支持加密归档：${name}`);
        if (name.endsWith("/")) {
          if (collect && occurrence === 1)
            entries.push({ name, directory: true, size: 0, occurrence });
          zip.readEntry();
          return;
        }
        const stream = await new Promise((res, rej) =>
          zip.openReadStream(entry, (err, value) =>
            err ? rej(err) : res(value),
          ),
        );
        const chunks = [];
        let actual = 0;
        for await (const chunk of stream) {
          actual += chunk.length;
          if (actual > entry.uncompressedSize) {
            stream.destroy();
            throw new Error("归档解压尺寸超出声明");
          }
          if (collect) chunks.push(chunk);
        }
        if (collect)
          entries.push({
            name,
            buffer: Buffer.concat(chunks),
            size: actual,
            occurrence,
          });
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
