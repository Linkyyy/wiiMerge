import yauzl from "yauzl";

export const LIMITS = Object.freeze({
  files: 5000,
  bytes: 128 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  depth: 3,
  textBytes: 2 * 1024 * 1024,
  cells: 300000,
  rows: 10000,
  columns: 256,
});
export const isArchive = (name) => /\.(zip|war|jar)$/i.test(name);
export const isWorkbook = (name) => /\.(xlsx|xlsm)$/i.test(name);

export async function readArchive(buffer, { collect = true } = {}) {
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
      names = new Set();
    let count = 0,
      bytes = 0,
      settled = false;
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
        resolve(entries);
      }
    });
    zip.on("entry", (entry) => {
      (async () => {
        const name = entry.fileName;
        if (++count > LIMITS.files)
          throw new Error(`归档条目超过 ${LIMITS.files} 个的安全上限`);
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
        if (names.has(name)) throw new Error(`归档含有重复路径：${name}`);
        names.add(name);
        if (entry.generalPurposeBitFlag & 1)
          throw new Error(`不支持加密归档：${name}`);
        if (name.endsWith("/")) {
          if (collect) entries.push({ name, directory: true, size: 0 });
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > LIMITS.fileBytes)
          throw new Error(`归档内文件超过 16 MiB：${name}`);
        bytes += entry.uncompressedSize;
        if (bytes > LIMITS.bytes)
          throw new Error("归档展开后超过 128 MiB 安全上限");
        const stream = await new Promise((res, rej) =>
          zip.openReadStream(entry, (err, value) =>
            err ? rej(err) : res(value),
          ),
        );
        const chunks = [];
        let actual = 0;
        for await (const chunk of stream) {
          actual += chunk.length;
          if (actual > LIMITS.fileBytes || actual > entry.uncompressedSize) {
            stream.destroy();
            throw new Error("归档解压尺寸超出声明");
          }
          if (collect) chunks.push(chunk);
        }
        if (collect)
          entries.push({ name, buffer: Buffer.concat(chunks), size: actual });
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
