import Workbook from "exceljs/lib/doc/workbook.js";

export const STATUS_LABEL = {
  added: "仅右侧",
  removed: "仅左侧",
  changed: "有差异",
  equal: "一致",
  error: "未能比较",
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const limitsNote =
  "文本 / 单元格明细每项最多保留 12,000 条；如有截断会单独标注。Excel 仅比较单元格内容，不比较样式、图表、宏或合并布局。仅右侧 / 仅左侧均相对左右输入，不代表实际修改历史。";

export function htmlReport(report) {
  const archiveNotes = report.warnings?.length
    ? `<div class="warning"><p>归档同名路径：${report.warnings.length} 组；所有文件按出现序号分别比较，虚拟版本标签不改动原归档。</p><ul>${report.warnings.map((w) => `<li>${escape(w.message)}</li>`).join("")}</ul></div>`
    : "";
  const row = (cells, status = "") =>
    `<tr class="${escape(status)}">${cells.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`;
  const table = (headers, rows) =>
    `<div class="scroll"><table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows || row(["没有差异明细"])}</tbody></table></div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>wiiMerge 比较报告</title><style>
body{font:14px/1.6 system-ui,sans-serif;color:#253449;background:#f5f7fb;margin:0;padding:40px}main{max-width:1300px;margin:auto}h1{letter-spacing:-1px}h2{font-size:17px;overflow-wrap:anywhere}section,.overview{background:white;border:1px solid #dae2ed;border-radius:12px;padding:22px;margin:20px 0}.meta,small{color:#5f6c80}table{border-collapse:collapse;width:100%;font:12px/1.6 ui-monospace,monospace}th,td{text-align:left;vertical-align:top;border:1px solid #e3e8ef;padding:7px 10px;white-space:pre-wrap;overflow-wrap:anywhere;min-width:50px}th{background:#f4f6fa}.added{background:#eaf8f0}.removed{background:#fff0ef}.changed{background:#fff8e6}.error,.warning{color:#b45309}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}.badge{font-size:12px;color:#64748b}footer{margin-top:30px;color:#64748b}
</style></head><body><main><div class="badge">wiiMerge · LOCAL COMPARISON REPORT</div><h1>差异比较报告</h1><div class="meta">生成时间 ${escape(report.createdAt)} · 耗时 ${report.durationMs} ms</div><div class="overview"><p>左侧：${escape(report.leftLabel)}<br>右侧：${escape(report.rightLabel)}</p><b>${Object.entries(
    STATUS_LABEL,
  )
    .map(([k, v]) => `${v} ${report.summary[k]}`)
    .join(
      "　 /　 ",
    )}</b><p class="meta">共 ${report.summary.total} 项；排除 ${report.summary.excluded} 项。${escape(limitsNote)}</p>${report.summary.error ? '<p class="warning">部分条目未能比较，请查看错误详情；结果不能视为完整一致。</p>' : ""}${archiveNotes}${report.draft ? '<p class="warning">包含未保存的合并编辑，编辑条目按原文比较。</p>' : ""}</div>${report.folders?.length ? `<section><h2>文件夹与归档差分一览</h2>${table(["路径", "类型", "状态", "内部文件", "差分文件", "说明"], report.folders.map((f) => row([f.path, f.type === "archive" ? "归档" : "文件夹", STATUS_LABEL[f.status], f.counts.total, f.counts.total - f.counts.equal, f.error || ""], f.status)).join(""))}</section>` : ""}<section><h2>差分一览</h2><table><thead><tr><th>文件</th><th>状态</th><th>类型</th></tr></thead><tbody>${report.items.map((item, index) => `<tr><td><a href="#file-${index}">${escape(item.path)}</a></td><td>${STATUS_LABEL[item.status]}</td><td>${escape(item.type)}</td></tr>`).join("")}</tbody></table></section>${report.items
    .map((item, index) => {
      const d = item.details;
      let body = item.error
        ? `<p class="warning">${escape(item.error)}</p>`
        : "";
      if (item.warnings?.length)
        body += `<details class="warning"><summary>归档条目版本信息</summary><ul>${item.warnings.map((message) => `<li>${escape(message)}</li>`).join("")}</ul></details>`;
      if (d?.truncated)
        body += d.contextOmitted
          ? '<p class="warning">文本较长，一致行已省略；最多保留 12,000 行差异，总计仍按全部内容计算。</p>'
          : '<p class="warning">明细已截断；下方不是完整明细，总计仍按全部内容计算。</p>';
      if (d?.kind === "text")
        body += table(
          ["状态", "左行", "左侧内容", "右行", "右侧内容"],
          d.rows
            .map((r) =>
              row(
                [
                  STATUS_LABEL[r.status],
                  r.leftLine,
                  r.left,
                  r.rightLine,
                  r.right,
                ],
                r.status,
              ),
            )
            .join(""),
        );
      if (d?.kind === "excel")
        body +=
          table(
            ["工作表", "状态", "左侧行数", "右侧行数"],
            d.sheets
              .map((s) =>
                row(
                  [s.name, STATUS_LABEL[s.status], s.leftRows, s.rightRows],
                  s.status,
                ),
              )
              .join(""),
          ) +
          table(
            ["工作表", "状态", "主键", "列", "左行", "左值", "右行", "右值"],
            d.changes
              .map((r) =>
                row(
                  [
                    r.sheet,
                    STATUS_LABEL[r.status],
                    r.key,
                    r.column,
                    r.leftRow,
                    r.left,
                    r.rightRow,
                    r.right,
                  ],
                  r.status,
                ),
              )
              .join(""),
          );
      if (d?.kind === "binary")
        body += `<p>${escape(d.note)}</p><pre>左 SHA-256: ${escape(d.leftHash ?? "—")}\n右 SHA-256: ${escape(d.rightHash ?? "—")}</pre>`;
      if (d?.kind === "directory") body += `<p>${escape(d.note)}</p>`;
      return `<section id="file-${index}"><h2>${escape(item.path)} <span class="badge">${STATUS_LABEL[item.status]} · ${escape(item.type)}</span></h2><small>左：${escape(item.leftPath ?? "不存在")} / 右：${escape(item.rightPath ?? "不存在")}</small>${body}</section>`;
    })
    .join(
      "",
    )}<details><summary>本次比较规则</summary><pre>${escape(JSON.stringify(report.rules, null, 2))}</pre></details><footer>由 wiiMerge 生成 · 所有比较均在本地完成</footer></main></body></html>`;
}

export async function excelReport(report) {
  const wb = new Workbook();
  wb.creator = "wiiMerge";
  wb.created = new Date(report.createdAt);
  const summary = wb.addWorksheet("比较摘要");
  summary.addRows([
    ["wiiMerge 差异比较报告"],
    ["生成时间", report.createdAt],
    ["左侧", report.leftLabel],
    ["右侧", report.rightLabel],
    ["耗时 (ms)", report.durationMs],
    ...Object.entries(STATUS_LABEL).map(([k, v]) => [v, report.summary[k]]),
    ["排除条目", report.summary.excluded],
    ["说明", limitsNote],
    ["规则", JSON.stringify(report.rules)],
  ]);
  summary.addRow([
    "工作区编辑",
    report.draft ? "包含未保存编辑；编辑条目按原文比较" : "已保存文件快照",
  ]);
  if (report.warnings?.length) {
    summary.addRow([
      "归档同名路径",
      `${report.warnings.length} 组；文件按出现序号配对，全部参与比较`,
    ]);
    const duplicates = wb.addWorksheet("归档重复路径");
    duplicates.addRow(["侧", "归档", "原始路径", "出现次数", "处理方式"]);
    for (const w of report.warnings)
      duplicates.addRow([
        w.side,
        w.archive,
        w.path,
        w.count,
        w.directory ? "重复目录合并" : "各文件按出现序号分别比较",
      ]);
  }
  if (report.folders?.length) {
    const folders = wb.addWorksheet("文件夹与归档");
    folders.addRow([
      "路径",
      "类型",
      "状态",
      "左侧路径",
      "右侧路径",
      "内部文件",
      "差分文件",
      "说明",
    ]);
    for (const f of report.folders)
      folders.addRow([
        f.path,
        f.type === "archive" ? "归档" : "文件夹",
        STATUS_LABEL[f.status],
        f.leftPath,
        f.rightPath,
        f.counts.total,
        f.counts.total - f.counts.equal,
        f.error || "",
      ]);
  }
  const files = wb.addWorksheet("文件清单");
  files.addRow([
    "路径",
    "状态",
    "类型",
    "左侧路径",
    "右侧路径",
    "左侧字节",
    "右侧字节",
    "错误",
    "明细截断",
    "归档条目版本信息",
  ]);
  const lines = wb.addWorksheet("文本差异");
  lines.addRow(["文件", "状态", "左行", "左侧内容", "右行", "右侧内容"]);
  const cells = wb.addWorksheet("Excel差异");
  cells.addRow([
    "文件",
    "工作表",
    "状态",
    "主键",
    "列",
    "左行",
    "左值",
    "右行",
    "右值",
  ]);
  const sheets = wb.addWorksheet("工作表清单");
  sheets.addRow(["文件", "工作表", "状态", "左侧行数", "右侧行数"]);
  const binaries = wb.addWorksheet("二进制指纹");
  binaries.addRow(["文件", "左 SHA-256", "右 SHA-256", "说明"]);
  for (const item of report.items) {
    const d = item.details;
    files.addRow([
      item.path,
      STATUS_LABEL[item.status],
      item.type,
      item.leftPath,
      item.rightPath,
      item.leftSize,
      item.rightSize,
      item.error ?? "",
      d?.truncated ? "是" : "否",
      (item.warnings || []).join("\n"),
    ]);
    if (d?.kind === "text")
      for (const r of d.rows)
        if (r.status !== "equal")
          lines.addRow([
            item.path,
            STATUS_LABEL[r.status],
            r.leftLine,
            r.left,
            r.rightLine,
            r.right,
          ]);
    if (d?.kind === "excel") {
      for (const s of d.sheets)
        sheets.addRow([
          item.path,
          s.name,
          STATUS_LABEL[s.status],
          s.leftRows,
          s.rightRows,
        ]);
      for (const r of d.changes)
        cells.addRow([
          item.path,
          r.sheet,
          STATUS_LABEL[r.status],
          r.key,
          r.column,
          r.leftRow,
          r.left,
          r.rightRow,
          r.right,
        ]);
    }
    if (d?.kind === "binary")
      binaries.addRow([item.path, d.leftHash, d.rightHash, d.note]);
  }
  for (const sheet of wb.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF344B89" },
    };
    sheet.columns.forEach((c, i) => {
      c.width = i === 0 ? 36 : 25;
    });
    if (sheet !== summary)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: sheet.rowCount, column: sheet.columnCount },
      };
    sheet.eachRow((r) =>
      r.eachCell((c) => {
        // ExcelJS emits plain strings as shared strings, never as executable formulas.
        if (typeof c.value === "string" && c.value.length > 32767)
          c.value =
            c.value.slice(0, 32720) + "\n[超过 Excel 单元格字符限制，已截断]";
        c.alignment = { vertical: "top", wrapText: true };
      }),
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
