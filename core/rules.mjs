import safeRegex from "safe-regex2";
import picomatch from "picomatch";
import { DEFAULT_RULES } from "./defaults.mjs";
export { DEFAULT_RULES } from "./defaults.mjs";

export function compilePattern(source, flags = "u") {
  if (typeof source !== "string" || source.length > 256)
    throw new Error("正则表达式最长为 256 个字符");
  if (!source) throw new Error("正则表达式不能为空");
  let expression;
  try {
    expression = new RegExp(source, flags);
  } catch {
    throw new Error(`无效的正则表达式：${source}`);
  }
  if (!safeRegex(expression))
    throw new Error(`正则表达式过于复杂，请简化：${source}`);
  return expression;
}

export function validateRules(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("规则必须是 JSON 对象");
  const rules = structuredClone(DEFAULT_RULES);
  for (const field of [
    "ignoreCase",
    "ignoreBlankLines",
    "pathIgnoreCase",
    "excelFormulas",
  ]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "boolean")
        throw new Error(`规则 ${field} 必须为布尔值`);
      rules[field] = input[field];
    }
  }
  for (const [field, values] of Object.entries({
    whitespace: ["none", "trim", "all"],
    encoding: ["auto", "utf8", "utf16le", "gb18030"],
  })) {
    if (input[field] !== undefined) {
      if (!values.includes(input[field]))
        throw new Error(`无效的 ${field} 规则`);
      rules[field] = input[field];
    }
  }
  for (const field of ["exclude", "ignoreLines"]) {
    if (input[field] === undefined) continue;
    if (
      !Array.isArray(input[field]) ||
      input[field].length > 30 ||
      input[field].some((s) => typeof s !== "string" || !s || s.length > 256)
    ) {
      throw new Error(`${field} 最多支持 30 条非空规则，每条不超过 256 字符`);
    }
    rules[field] = [...input[field]];
  }
  for (const field of ["replacements", "pathReplacements"]) {
    if (input[field] === undefined) continue;
    if (!Array.isArray(input[field]) || input[field].length > 20)
      throw new Error(`${field} 最多支持 20 条替换规则`);
    rules[field] = input[field].map((r) => {
      if (
        !r ||
        typeof r.pattern !== "string" ||
        typeof r.replacement !== "string" ||
        r.replacement.length > 256
      )
        throw new Error("替换规则需要 pattern 和 replacement 字符串");
      compilePattern(r.pattern, "gu");
      return { pattern: r.pattern, replacement: r.replacement };
    });
  }
  rules.ignoreLines.forEach((p) => compilePattern(p));
  rules.exclude.forEach((p) => {
    try {
      picomatch(p);
    } catch {
      throw new Error(`无效的排除规则：${p}`);
    }
  });
  if (input.excelKeyColumns !== undefined) {
    if (
      typeof input.excelKeyColumns !== "string" ||
      !/^(?:\s*[A-Za-z]{1,3}\s*(?:,\s*[A-Za-z]{1,3}\s*)*)?$/.test(
        input.excelKeyColumns,
      )
    )
      throw new Error("Excel 主键列格式为 A 或 A,B");
    rules.excelKeyColumns = input.excelKeyColumns
      .toUpperCase()
      .replace(/\s/g, "");
    if (
      rules.excelKeyColumns.split(",").some((c) => c && columnNumber(c) > 256)
    )
      throw new Error("Excel 主键列不能超过 IV（256 列）");
  }
  return rules;
}

export function columnNumber(name) {
  return [...name].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}
export function columnName(n) {
  let s = "";
  for (; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function makeNormalizer(rules) {
  const replacements = rules.replacements.map((r) => [
    compilePattern(r.pattern, "gu"),
    r.replacement,
  ]);
  return (value) => {
    let s = String(value ?? "").normalize("NFC");
    for (const [pattern, replacement] of replacements)
      s = s.replace(pattern, replacement);
    if (rules.whitespace === "trim") s = s.trim();
    if (rules.whitespace === "all") s = s.replace(/\s/gu, "");
    if (rules.ignoreCase) s = s.toLowerCase();
    return s;
  };
}

export function pathMatcher(rules) {
  const excluded = picomatch(rules.exclude, {
    dot: true,
    nocase: rules.pathIgnoreCase,
  });
  const replacements = rules.pathReplacements.map((r) => [
    compilePattern(r.pattern, "gu"),
    r.replacement,
  ]);
  return {
    excluded: (path) => excluded(path) || excluded(`${path}/`),
    key: (path) => {
      let key = path.normalize("NFC");
      for (const [pattern, replacement] of replacements)
        key = key.replace(pattern, replacement);
      return rules.pathIgnoreCase ? key.toLowerCase() : key;
    },
  };
}
