import React, { useMemo, useState } from "react";
import {
  Archive,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ListTree,
  FileText,
  Folder,
  Search,
  Filter,
  FolderOpen,
} from "lucide-react";
import {
  ActionMenu,
  PopupMenu,
  ToolButton,
  ToolbarSlot,
} from "./WorkspaceControls.jsx";
import { overviewTree, treeRows } from "../core/tree.mjs";
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
  compact = false,
  toolbarHost,
}) {
  const [search, setSearch] = useState(""),
    [expanded, setExpanded] = useState(new Set()),
    [collapsed, setCollapsed] = useState(new Set()),
    [context, setContext] = useState(null);
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
  const tree = useMemo(
    () =>
      overviewTree(report, { filter, search, folderKey: current?.key || null }),
    [report, current, filter, search],
  );
  const effectiveExpanded = useMemo(
    () =>
      new Set(
        [...expanded, ...tree.autoExpanded].filter(
          (key) => !collapsed.has(key),
        ),
      ),
    [expanded, collapsed, tree],
  );
  const rows = useMemo(
    () => treeRows(tree, effectiveExpanded),
    [tree, effectiveExpanded],
  );
  const toggle = (item, value = !effectiveExpanded.has(item.key)) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      value ? next.add(item.key) : next.delete(item.key);
      return next;
    });
    setCollapsed((previous) => {
      const next = new Set(previous);
      value ? next.delete(item.key) : next.add(item.key);
      return next;
    });
  };
  const expandDifferences = () => {
    setSearch("");
    if (filter === "equal") onFilter?.("all");
    setExpanded(
      new Set(
        [...tree.byKey.values()]
          .filter((i) => i.container && i.status !== "equal")
          .map((i) => i.key),
      ),
    );
    setCollapsed(new Set());
    pages.go(0);
  };
  const collapseAll = () => {
    setExpanded(new Set());
    setCollapsed(new Set(report.folders?.map((f) => f.key)));
    pages.go(0);
  };
  const changeFilter = (value) => {
    setCollapsed(new Set());
    onFilter?.(value);
  };
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
    } else toggle(item);
  };
  return (
    <div className="folder-overview">
      {!compact && (
        <div className="overview-heading">
          <div>
            <h2>差分一览</h2>
            <p>
              展开文件夹或归档查看内部差分；双击文件打开明细，归档可在新 Tab
              浏览。
            </p>
          </div>
          {extra}
        </div>
      )}
      {!compact && (
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
      )}
      {!compact && (
        <div className="overview-tools">
          <div className="overview-search">
            <Search size={15} />
            <input
              aria-label="搜索文件"
              placeholder="搜索全部文件夹或文件路径…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCollapsed(new Set());
              }}
            />
          </div>
          <select
            aria-label="筛选比较条目"
            value={filter}
            onChange={(e) => changeFilter(e.target.value)}
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
            {rows.length} 项 · {report.folderSummary?.total || 0} 个文件夹 /
            归档
          </span>
        </div>
      )}
      {!compact && (
        <div className="tree-controls">
          <button onClick={expandDifferences}>
            <ListTree size={15} />
            展开所有差异
          </button>
          <button onClick={collapseAll}>
            <ChevronsDownUp size={14} />
            收起全部
          </button>
          <label>
            <input
              type="checkbox"
              checked={filter === "differences"}
              onChange={(e) =>
                changeFilter(e.target.checked ? "differences" : "all")
              }
            />
            隐藏一致项
          </label>
          <label>
            <input
              type="checkbox"
              checked={filter === "equal"}
              onChange={(e) => changeFilter(e.target.checked ? "equal" : "all")}
            />
            隐藏差异项
          </label>
          <span>红：仅左侧 · 绿：仅右侧 · 橙：内容不同</span>
        </div>
      )}
      <ToolbarSlot host={compact ? toolbarHost : null}>
        <ToolButton
          icon={ArrowUp}
          label="上一级"
          disabled={!current}
          onClick={() => navigate(current.parentKey)}
        />
        <button
          className="workspace-folder-label"
          title={current?.path || "全部结果"}
          onClick={() => navigate(null)}
        >
          {current ? basename(current.path) : "全部结果"}
        </button>
        <div className="workspace-search">
          <Search size={14} />
          <input
            aria-label="搜索文件"
            placeholder="搜索路径…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCollapsed(new Set());
            }}
          />
        </div>
        <ToolButton
          icon={ListTree}
          label="展开所有差异"
          onClick={expandDifferences}
        />
        <ToolButton
          icon={ChevronsDownUp}
          label="收起全部"
          onClick={collapseAll}
        />
        <ActionMenu
          icon={Filter}
          label="筛选比较条目"
          active={filter !== "all"}
          items={[
            {
              label: "全部状态",
              checked: filter === "all",
              action: () => changeFilter("all"),
            },
            {
              label: "隐藏一致项",
              checked: filter === "differences",
              action: () =>
                changeFilter(filter === "differences" ? "all" : "differences"),
            },
            {
              label: "隐藏差异项",
              checked: filter === "equal",
              action: () => changeFilter(filter === "equal" ? "all" : "equal"),
            },
            { separator: true },
            ...Object.entries(labels)
              .filter(([key]) => key !== "equal")
              .map(([value, label]) => ({
                label,
                checked: filter === value,
                action: () => changeFilter(value),
              })),
          ]}
        />
        <span className="workspace-tool-count">{rows.length} 项</span>
      </ToolbarSlot>
      {context && (
        <PopupMenu
          anchor={context.anchor}
          label="条目快捷菜单"
          onClose={() => setContext(null)}
          items={[
            {
              label: context.item.container ? "展开 / 收起" : "查看差分",
              icon: context.item.container ? Folder : FileText,
              action: () =>
                context.item.container
                  ? toggle(context.item)
                  : onOpenFile(context.item),
            },
            {
              ...(context.item.container
                ? {
                    label:
                      context.item.type === "archive" && onOpenArchive
                        ? "在新 Tab 查看归档"
                        : "仅查看此目录",
                    icon: FolderOpen,
                    action: () =>
                      context.item.type === "archive" && onOpenArchive
                        ? onOpenArchive(context.item)
                        : navigate(context.item.key),
                  }
                : { separator: true }),
            },
          ]}
        />
      )}
      {current?.error && (
        <div className="notice error-notice">{current.error}</div>
      )}
      <Pagination paging={pages} label="差分一览分页" />
      <table
        className="overview-table"
        role="treegrid"
        aria-label="文件夹与文件差分树"
      >
        <thead>
          <tr>
            <th>名称 / 路径</th>
            <th>类型</th>
            <th>状态</th>
            <th>内部文件</th>
          </tr>
        </thead>
        <tbody>
          {pages.rows.map(({ item: i, level }) => {
            const Icon =
              i.type === "archive" ? Archive : i.container ? Folder : FileText;
            return (
              <tr
                key={i.key}
                data-object-key={i.key}
                data-object-type={i.type}
                data-object-path={i.path}
                aria-level={level + 1}
                aria-expanded={
                  i.container ? effectiveExpanded.has(i.key) : undefined
                }
                tabIndex={0}
                className={tree.matches.has(i.key) ? "" : "tree-context"}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "ArrowRight" && i.container) {
                    e.preventDefault();
                    toggle(i, true);
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    if (i.container && effectiveExpanded.has(i.key))
                      toggle(i, false);
                    else
                      [
                        ...e.currentTarget
                          .closest("table")
                          .querySelectorAll("[data-object-key]"),
                      ]
                        .find((row) => row.dataset.objectKey === i.parentKey)
                        ?.focus();
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    (e.key === "ArrowDown"
                      ? e.currentTarget.nextElementSibling
                      : e.currentTarget.previousElementSibling
                    )?.focus();
                  } else if (
                    e.key === "ContextMenu" ||
                    (e.shiftKey && e.key === "F10")
                  ) {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContext({
                      item: i,
                      anchor: {
                        x: rect.left + 40,
                        y: rect.top + 20,
                        focus: e.currentTarget,
                      },
                    });
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    open(i);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContext({
                    item: i,
                    anchor: {
                      x: e.clientX,
                      y: e.clientY,
                      focus: e.currentTarget,
                    },
                  });
                }}
                onDoubleClick={() => open(i)}
              >
                <td>
                  <span
                    className={`overview-name ${i.container ? "container-name" : ""}`}
                    title={i.path}
                    style={{ paddingLeft: level * 22 }}
                  >
                    {i.container ? (
                      <button
                        className="tree-toggle"
                        aria-label={`${effectiveExpanded.has(i.key) ? "收起" : "展开"} ${basename(i.path)}`}
                        aria-expanded={effectiveExpanded.has(i.key)}
                        onClick={() => toggle(i)}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {effectiveExpanded.has(i.key) ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </button>
                    ) : (
                      <span className="tree-toggle-spacer" />
                    )}
                    <Icon size={17} />
                    <span className="tree-entry-name">
                      {basename(i.path)}
                      {search.trim() && !i.container && <small>{i.path}</small>}
                    </span>
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
