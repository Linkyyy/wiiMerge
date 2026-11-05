import ExcelJS from "exceljs";
import yazl from "yazl";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
export async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wiimerge-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
export async function zip(files) {
  const zip = new yazl.ZipFile();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (b) => chunks.push(b));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
  for (const [name, value] of Object.entries(files)) {
    if (name.endsWith("/")) zip.addEmptyDirectory(name);
    else
      zip.addBuffer(Buffer.isBuffer(value) ? value : Buffer.from(value), name);
  }
  zip.end();
  return done;
}
export async function workbook(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = wb.addWorksheet(name);
    sheet.addRows(rows);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
