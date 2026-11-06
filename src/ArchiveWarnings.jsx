import React from "react";

export default function ArchiveWarnings({ warnings, entry = false }) {
  if (!warnings?.length) return null;
  return (
    <details className="archive-warnings">
      <summary>
        {entry
          ? "同名归档条目：查看当前版本与配对信息"
          : `归档中有 ${warnings.length} 组同名路径，已保留并分别比较`}
      </summary>
      <p>
        同名文件按归档中的出现序号配对，带 ⟦同名#N⟧
        的为后续条目；虚拟标签不会改动原归档。
      </p>
      <ul>
        {warnings.map((warning, index) => (
          <li key={index}>
            {typeof warning === "string" ? warning : warning.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
