import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";

async function openFile(filename) {
  if ((await fs.lstat(filename)).isSymbolicLink())
    throw new Error("不读取符号链接");
  const handle = await fs.open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Error("只支持普通文件，不读取设备或符号链接");
  }
  return handle;
}

export async function safeRead(filename) {
  const handle = await openFile(filename);
  try {
    const before = await handle.stat();
    const buffer = await handle.readFile();
    const after = await handle.stat();
    if (
      buffer.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error("读取期间文件发生变化，请重新比较");
    return buffer;
  } finally {
    await handle.close();
  }
}

// Hash in fixed chunks and validate UTF-8 incrementally. Binary comparisons do
// not need to allocate a buffer proportional to the size of either input.
export async function inspectFile(filename) {
  const handle = await openFile(filename);
  try {
    const before = await handle.stat(),
      hash = createHash("sha256");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunk = Buffer.alloc(1024 * 1024);
    let size = 0,
      binary = false,
      utf16 = false,
      first = true;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      const bytes = chunk.subarray(0, bytesRead);
      hash.update(bytes);
      if (first) {
        utf16 =
          (bytes[0] === 255 && bytes[1] === 254) ||
          (bytes[0] === 254 && bytes[1] === 255);
        const sample = bytes.subarray(0, 8192);
        binary =
          !utf16 &&
          (sample.includes(0) ||
            [...sample].filter((c) => c < 32 && ![9, 10, 12, 13].includes(c))
              .length > 3);
        first = false;
      }
      if (!binary && !utf16) {
        try {
          decoder.decode(bytes, { stream: true });
        } catch {
          binary = true;
        }
      }
      size += bytesRead;
    }
    if (!binary && !utf16) {
      try {
        decoder.decode();
      } catch {
        binary = true;
      }
    }
    const after = await handle.stat();
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error("读取期间文件发生变化，请重新比较");
    return { size, hash: hash.digest("hex"), binary };
  } finally {
    await handle.close();
  }
}
