import React, { useMemo, useState } from "react";
import {
  Archive,
  ArrowUp,
  ChevronRight,
  FileText,
  Folder,
  Search,
} from "lucide-react";
import { overviewObjects } from "../core/folders.mjs";
import Pagination, { usePagination } from "./Pagination.jsx";

const labels = {
  changed: "有差异",
  equal: "一致",
  added: "仅右侧",
  removed: "仅左侧",
  error: "未能比较",
};
const types = {
  directory: "文件夹",
  archive: "归档",
  text: "文本",
  excel: "Excel",
  binary: "二进制",
};
const basename = (p) => p.split("/").pop();
export default function FolderOverview({
  report,
  folderKey = null,
  onNavigate,
  onOpenFile,
  onOpenArchive,
  filter = "all",
  onFilter,
  extra,
}) {
  const [search, setSearch] = useState("");
  const current = report.folders?.find((f) => f.key === folderKey);
  const crumbs = useMemo(() => {
    const byKey = new Map((report.folders || []).map((f) => [f.key, f])),
      seen = new Set(),
      result = [];
    let folder = byKey.get(folderKey);
    while (folder && !seen.has(folder.key)) {
      seen.add(folder.key);
      result.unshift(folder);
      folder = byKey.get(folder.parentKey);
    }
    return result;
  }, [report.folders, folderKey]);
  const objects = useMemo(() => overviewObjects(report), [report]);
  const rows = useMemo(() => {
    const accepts = (i) =>
      filter === "all" ||
      (filter === "differences" ? i.status !== "equal" : i.status === filter);
    // Keep ancestor folders reachable when filtering for a descendant's status.
    const accepted = new Set(),
      byKey = new Map(objects.map((i) => [i.key, i]));
    for (const item of objects) {
      if (!accepts(item)) continue;
      let object = item;
      while (object && !accepted.has(object.key)) {
        accepted.add(object.key);
        object = byKey.get(object.parentKey);
      }
    }
    return objects
      .filter((i) =>
        search.trim()
          ? i.path.toLowerCase().includes(search.trim().toLowerCase()) &&
            accepts(i)
          : (i.parentKey || null) === (current?.key || null) &&
            accepted.has(i.key),
      )
      .sort(
        (a, b) =>
          Number(b.container || false) - Number(a.container || false) ||
          a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
      );
  }, [objects, current, filter, search]);
  const pages = usePagination(
    rows,
    JSON.stringify([report.id, folderKey, search, filter]),
  );
  const navigate = (key) => {
    setSearch("");
    onNavigate(key);
  };
  const open = (item) => {
    if (!item.container) onOpenFile(item);
    else if (item.type === "archive" && onOpenArchive) {
      setSearch("");
      onOpenArchive(item);
    } else navigate(item.key);
  };
  return (
    <div className="folder-overview">
      <div className="overview-heading">
        <div>
          <h2>差分一览</h2>
          <p>
            文件夹状态汇总内部差分；双击文件夹或归档进入，打开文件查看具体差分。
          </p>
        </div>
        {extra}
      </div>
      <nav className="folder-breadcrumbs" aria-label="当前文件夹">
        <button
          className="icon-button"
          aria-label="上一级"
          disabled={!current}
          onClick={() => navigate(current.parentKey)}
        >
          <ArrowUp size={16} />
        </button>
        <button onClick={() => navigate(null)}>全部结果</button>
        {crumbs.map((f) => (
          <React.Fragment key={f.key}>
            <ChevronRight size={13} />
            <button
              aria-current={f.key === current?.key ? "page" : undefined}
              title={f.path}
              onClick={() => navigate(f.key)}
            >
              {basename(f.path)}
            </button>
          </React.Fragment>
        ))}
      </nav>
      <div className="overview-tools">
        <div className="overview-search">
          <Search size={15} />
          <input
            aria-label="搜索文件"
            placeholder="搜索全部文件夹或文件路径…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="筛选比较条目"
          value={filter}
          onChange={(e) => onFilter?.(e.target.value)}
        >
          <option value="all">全部状态</option>
          <option value="differences">只看不同</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span>
          {rows.length} 项 · {report.folderSummary?.total || 0} 个文件夹 / 归档
        </span>
      </div>
      {current?.error && (
        <div className="notice error-notice">{current.error}</div>
      )}
      <Pagination paging={pages} label="差分一览分页" />
      <table className="overview-table">
        <thead>
          <tr>
            <th>名称 / 路径</th>
            <th>类型</th>
            <th>状态</th>
            <th>内部文件</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {pages.rows.map((i) => {
            const Icon =
              i.type === "archive" ? Archive : i.container ? Folder : FileText;
            return (
              <tr
                key={i.key}
                data-object-key={i.key}
                data-object-type={i.type}
                onDoubleClick={() => open(i)}
              >
                <td>
                  <span
                    className={`overview-name ${i.container ? "container-name" : ""}`}
                    title={i.path}
                  >
                    <Icon size={17} />
                    {search.trim() ? i.path : basename(i.path)}
                  </span>
                </td>
                <td>{types[i.type] || i.type}</td>
                <td>
                  <span className={`status-pill ${i.status}`}>
                    {labels[i.status]}
                  </span>
                </td>
                <td>
                  {i.container
                    ? `${i.counts.total} 个 · 差分 ${i.counts.total - i.counts.equal}`
                    : "—"}
                </td>
                <td>
                  <button className="text-button" onClick={() => open(i)}>
                    {i.container
                      ? i.type === "archive"
                        ? "进入归档"
                        : "打开文件夹"
                      : "查看差分"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && (
        <div className="detail-empty">
          {search || filter !== "all" ? "没有符合条件的条目" : "此文件夹为空"}
        </div>
      )}
    </div>
  );
}
