import { read, set_cptable, utils } from "@e965/xlsx";
import iconv from "iconv-lite";

// Reuse the existing encoding tables instead of bundling a second full set.
const encoding = (cp) =>
  ({
    1200: "utf16le",
    1201: "utf16be",
    65001: "utf8",
    20127: "ascii",
    28591: "latin1",
    10000: "macintosh",
  })[cp] || `cp${cp}`;
set_cptable({
  utils: {
    decode(cp, bytes) {
      const codec = encoding(cp);
      if (!iconv.encodingExists(codec))
        throw new Error(`XLS 使用了不支持的代码页：${cp}`);
      return iconv.decode(
        typeof bytes === "string"
          ? Buffer.from(bytes, "binary")
          : Buffer.from(bytes),
        codec,
        { stripBOM: false },
      );
    },
    encode(cp, text, type) {
      const bytes = iconv.encode(text, encoding(cp));
      return type === "str" ? bytes.toString("binary") : bytes;
    },
  },
});

export function readLegacyWorkbook(buffer, rules) {
  const compound = buffer
    .subarray(0, 8)
    .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  const biff =
    buffer.length >= 4 &&
    [0x0009, 0x0209, 0x0409, 0x0809].includes(buffer.readUInt16LE(0));
  if (!compound && !biff)
    throw new Error("不是有效的 XLS（BIFF）工作簿，或文件已损坏");
  const book = read(buffer, {
    type: "buffer",
    cellDates: true,
    cellFormula: true,
    cellText: false,
    cellNF: false,
    bookVBA: false,
  });
  if (!book.SheetNames.length)
    throw new Error("XLS 未包含可读取的工作表，可能已加密或损坏");
  const sheets = new Map();
  for (const name of book.SheetNames) {
    const rows = new Map(),
      sheet = book.Sheets[name];
    for (const [address, cell] of Object.entries(sheet)) {
      if (!/^[A-Z]+[1-9]\d*$/.test(address) || !cell || cell.t === "z")
        continue;
      const { r, c } = utils.decode_cell(address);
      const value =
        rules.excelFormulas && cell.f
          ? `=${cell.f}`
          : cell.v instanceof Date
            ? cell.v.toISOString()
            : cell.v === undefined || cell.v === null
              ? ""
              : cell.t === "e"
                ? {
                    0: "#NULL!",
                    7: "#DIV/0!",
                    15: "#VALUE!",
                    23: "#REF!",
                    29: "#NAME?",
                    36: "#NUM!",
                    42: "#N/A",
                    43: "#GETTING_DATA",
                  }[cell.v] || String(cell.v)
                : String(cell.v);
      if (value === "") continue;
      if (!rows.has(r + 1))
        rows.set(r + 1, { number: r + 1, cells: new Map() });
      rows.get(r + 1).cells.set(c + 1, value);
    }
    sheets.set(name, rows);
  }
  return sheets;
}
