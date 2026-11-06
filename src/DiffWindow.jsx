import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import Titlebar from "./Titlebar.jsx";
import Pagination, { PAGE_SIZE, usePagination } from "./Pagination.jsx";
import { Detail, CharacterDiff } from "./App.jsx";
import { adoptHunk, textModel } from "../core/hunks.mjs";
import { textNavigation } from "../core/navigation.mjs";
import DiffMap from "./DiffMap.jsx";
import ArchiveWarnings from "./ArchiveWarnings.jsx";
import useDiffViewport from "./useDiffViewport.js";

const api = window.wiiMerge;
const labels = {
  changed: "有差异",
  equal: "一致",
  added: "仅右侧",
  removed: "仅左侧",
  error: "未能比较",
};
const base = (p) => p.split(/[\\/]/).pop();
function treeFor(items, prefix = "") {
  const root = { children: new Map() };
  for (const item of items) {
    if (!item.path.startsWith(prefix)) continue;
    const parts = item.path.slice(prefix.length).split("/");
    let node = root,
      key = prefix;
    parts.forEach((part, index) => {
      key += part;
      if (!node.children.has(part))
        node.children.set(part, {
          key,
          name: part.replace(/!$/, ""),
          archive: part.endsWith("!"),
          children: new Map(),
          status: "equal",
        });
      node = node.children.get(part);
      if (item.status === "error") node.status = "error";
      else if (node.status !== "error" && item.status !== "equal")
        node.status = "changed";
      if (index === parts.length - 1) node.item = item;
      key += "/";
    });
  }
  return root;
}
function Tree({ node, level = 0, open }) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const children = [...node.children.values()];
  const renderChildren = (depth) => (
    <>
      {children.slice(0, limit).map((n) => (
        <Tree key={n.key} node={n} level={depth} open={open} />
      ))}
      {children.length > limit && (
        <button
          className="tree-load-more"
          style={{ paddingLeft: 10 + depth * 15 }}
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
        >
          继续显示（{limit} / {children.length}）
        </button>
      )}
    </>
  );
  if (!node.name) return renderChildren(0);
  const branch = node.children.size > 0,
    status = node.status;
  return (
    <>
      <button
        className={`nav-tree-row ${status}`}
        style={{ paddingLeft: 10 + level * 15 }}
        title={node.key}
        onClick={() => (branch ? setExpanded((v) => !v) : open(node))}
        onDoubleClick={() => open(node)}
      >
        {branch ? (
          expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {node.archive ? (
          <Archive size={15} />
        ) : branch ? (
          <Folder size={15} />
        ) : (
          <FileText size={15} />
        )}
        <span>{node.name}</span>
        <i className={`status-dot ${node.item?.status || status}`} />
      </button>
      {branch && expanded && renderChildren(level + 1)}
    </>
  );
}

export default function DiffWindow() {
  const query = new URLSearchParams(location.search),
    reportId = query.get("report"),
    initial = query.get("item");
  const [report, setReport] = useState(null),
    [tabs, setTabs] = useState([
      { id: "overview", type: "archive", prefix: "", name: "差分一览" },
    ]),
    [active, setActive] = useState("overview"),
    [docs, setDocs] = useState({}),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [onlyDiff, setOnlyDiff] = useState(false);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const dirty = Object.values(docs).some(
    (d) => d.left !== d.savedLeft || d.right !== d.savedRight,
  );
  useEffect(() => {
    api?.setDirty?.(dirty);
  }, [dirty]);
  useEffect(() => {
    let alive = true;
    api
      .getReport(reportId)
      .then((r) => {
        if (alive) {
          setReport(r);
          const item = r.items.find((i) => i.key === initial);
          if (item) openItem(item);
        }
      })
      .catch((e) => setError(e.message));
    const off = api.onProgress((v) => {
      if (v.reportUpdated?.id === reportId) setReport(v.reportUpdated);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  const tab = tabs.find((t) => t.id === active) || tabs[0];
  const item = report?.items.find((i) => i.key === tab.itemKey);
  const mixedExcel =
    item?.type === "excel" &&
    item.leftPath &&
    item.rightPath &&
    item.leftPath.split(".").pop().toLowerCase() !==
      item.rightPath.split(".").pop().toLowerCase();
  const doc = docs[tab.itemKey];
  const scoped = useMemo(
    () =>
      (report?.items || []).filter(
        (i) =>
          (tab.type !== "archive" || i.path.startsWith(tab.prefix)) &&
          (!onlyDiff || i.status !== "equal") &&
          i.path.toLowerCase().includes(search.toLowerCase()),
      ),
    [report, tab, search, onlyDiff],
  );
  const tree = useMemo(
    () => treeFor(scoped, tab.type === "archive" ? tab.prefix : ""),
    [scoped, tab],
  );
  const overviewPages = usePagination(
    scoped,
    JSON.stringify([tab.id, onlyDiff, search]),
  );
  async function openItem(i) {
    const id = "file:" + i.key;
    const versions = (i.rightArchiveSteps || i.leftArchiveSteps || [])
      .slice(0, -1)
      .filter((step) => step.occurrence > 1)
      .map((step) => step.occurrence);
    const name =
      base(i.path) + (versions.length ? ` · 同名#${versions.join("/")}` : "");
    setTabs((ts) =>
      ts.some((t) => t.id === id)
        ? ts
        : [...ts, { id, type: "file", name, path: i.path, itemKey: i.key }],
    );
    setActive(id);
    setError("");
    if (i.type === "text" && !i.error && !docsRef.current[i.key]) {
      try {
        const d = await api.openDocument(reportId, i.key);
        setDocs((ds) => ({ ...ds, [i.key]: d }));
      } catch (e) {
        setError(e.message);
      }
    }
  }
  function openNode(node) {
    if (node.archive || (!node.item && node.children.size)) {
      const id = "archive:" + node.key;
      setTabs((ts) =>
        ts.some((t) => t.id === id)
          ? ts
          : [
              ...ts,
              { id, type: "archive", name: node.name, prefix: node.key + "/" },
            ],
      );
      setActive(id);
    } else if (node.item) openItem(node.item);
  }
  function change(d) {
    setDocs((ds) => ({ ...ds, [d.itemKey]: d }));
  }
  async function flush() {
    for (const d of Object.values(docsRef.current))
      await api.previewDocument(d.id, d.left, d.right);
  }
  async function save(d, side, as = false) {
    setBusy(true);
    setError("");
    try {
      await api.previewDocument(d.id, d.left, d.right);
      const result = await api.saveDocument(d.id, side, as);
      if (result) {
        change(result.document);
        setMessage(
          `已保存：${result.path}${result.backup ? "（已保留原文件备份）" : ""}`,
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportAll(format) {
    setBusy(true);
    setError("");
    try {
      await flush();
      const file = await api.exportReport(reportId, format);
      if (file) setMessage("已导出差分一览和全部文件明细：" + file);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function adoptWhole(from) {
    setBusy(true);
    setError("");
    try {
      await flush();
      const result = await api.adoptFile(reportId, item.key, from);
      if (result) setMessage("已整体替换并保留备份：" + result.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!report)
    return (
      <div className="diff-window">
        <Titlebar title="wiiMerge · 差分" />
        <div className="detail-empty">
          {error || <LoaderCircle className="spin" />}
        </div>
      </div>
    );
  return (
    <div className="diff-window">
      <Titlebar title="wiiMerge · 差分工作区">
        <span className="window-subtitle">
          {base(report.leftLabel)} ↔ {base(report.rightLabel)}
        </span>
      </Titlebar>
      <div className="diff-topbar">
        <b>
          {report.summary.total} 个条目 ·{" "}
          {report.summary.changed +
            report.summary.added +
            report.summary.removed}{" "}
          项不同
        </b>
        <label>
          <input
            type="checkbox"
            checked={onlyDiff}
            onChange={(e) => setOnlyDiff(e.target.checked)}
          />
          只看不同
        </label>
        <span className="grow" />
        {dirty && <span className="dirty-label">含未保存改动</span>}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => exportAll("html")}
        >
          <Download size={14} />
          HTML 报告
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => exportAll("xlsx")}
        >
          <Download size={14} />
          Excel 报告
        </button>
      </div>
      <ArchiveWarnings warnings={report.warnings} />
      <div className="document-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={active === t.id ? "active" : ""}>
            <button
              title={t.path || t.prefix || t.name}
              onClick={() => setActive(t.id)}
            >
              {t.type === "archive" ? (
                <Archive size={14} />
              ) : (
                <FileText size={14} />
              )}
              {t.name}
              {docs[t.itemKey] &&
                (docs[t.itemKey].left !== docs[t.itemKey].savedLeft ||
                  docs[t.itemKey].right !== docs[t.itemKey].savedRight) &&
                " ●"}
            </button>
            {t.id !== "overview" && (
              <button
                aria-label={`关闭 ${t.name}`}
                onClick={() => {
                  setTabs((ts) => ts.filter((x) => x.id !== t.id));
                  if (active === t.id) setActive("overview");
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      {(error || message) && (
        <div
          className={`notice ${error ? "error-notice" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || message}
          <button
            onClick={() => {
              setError("");
              setMessage("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="diff-body">
        <aside className="diff-explorer">
          <div className="sidebar-title">
            文件与归档 <small>双击归档进入新 Tab</small>
          </div>
          <div className="file-search">
            <input
              placeholder="搜索文件路径…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="tree-scroll">
            <Tree
              key={tab.type === "archive" ? tab.prefix : "all"}
              node={tree}
              open={openNode}
            />
          </div>
        </aside>
        {tab.type === "archive" ? (
          <div className="archive-overview">
            <div className="archive-heading">
              <Archive size={22} />
              <div>
                <h2>{tab.prefix || "差分一览"}</h2>
                <p>归档在内存中展开；双击文件查看差异，双击归档打开新 Tab。</p>
              </div>
            </div>
            <Pagination paging={overviewPages} label="归档一览分页" />
            <table className="overview-table">
              <thead>
                <tr>
                  <th>文件 / 虚拟路径</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {overviewPages.rows.map((i) => (
                  <tr key={i.key} onDoubleClick={() => openItem(i)}>
                    <td>{i.path.slice(tab.prefix.length)}</td>
                    <td>{i.type}</td>
                    <td>
                      <span className={`status-pill ${i.status}`}>
                        {labels[i.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => openItem(i)}
                      >
                        打开差分
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!scoped.length && (
              <div className="detail-empty">此视图没有匹配条目</div>
            )}
          </div>
        ) : item?.type === "text" && doc ? (
          <TextEditor
            key={doc.id}
            doc={doc}
            change={change}
            save={save}
            busy={busy}
            warnings={item.warnings}
          />
        ) : (
          <div className="readonly-document">
            <div className="whole-file-toolbar">
              <span>
                {mixedExcel
                  ? "跨格式 Excel 比较：整文件采用需要两侧格式相同"
                  : "Excel / 二进制采用整文件替换（保留原文件备份）"}
              </span>
              <button
                disabled={
                  busy ||
                  mixedExcel ||
                  !!item?.error ||
                  item?.type === "directory"
                }
                onClick={() => adoptWhole("left")}
              >
                整文件使用左边 →
              </button>
              <button
                disabled={
                  busy ||
                  mixedExcel ||
                  !!item?.error ||
                  item?.type === "directory"
                }
                onClick={() => adoptWhole("right")}
              >
                ← 整文件使用右边
              </button>
            </div>
            <div className="detail-panel">
              {item && <Detail key={item.key} item={item} />}
            </div>
          </div>
        )}
      </div>
      <footer className="editor-status">
        F7 下一处 · Shift+F7 上一处 · Alt+→ 使用左边 · Alt+← 使用右边 · Ctrl+S
        保存当前侧<span>归档内容可合并后另存；原压缩包保持不变</span>
      </footer>
    </div>
  );
}

function TextEditor({ doc, change, save, busy, warnings }) {
  const [cursor, setCursor] = useState(0),
    [limit, setLimit] = useState(600),
    [editing, setEditing] = useState(false),
    [side, setSide] = useState("right"),
    [history, setHistory] = useState([]);
  const scroll = useRef(null);
  const model = useMemo(() => {
    try {
      return textModel(doc.left, doc.right);
    } catch (e) {
      return { rows: [], hunks: [], error: e.message };
    }
  }, [doc.left, doc.right]);
  const navigation = useMemo(() => textNavigation(model), [model]);
  const positionAt = useMemo(
    () => (index) => {
      const row = model.rows[index];
      return (
        row && {
          leftStart: row.leftOffset,
          leftEnd: row.leftOffset + (row.leftLine ? 1 : 0),
          rightStart: row.rightOffset,
          rightEnd: row.rightOffset + (row.rightLine ? 1 : 0),
        }
      );
    },
    [model],
  );
  const viewport = useDiffViewport(scroll, {
    selector: "[data-merge-row]",
    attribute: "data-merge-row",
    positionAt,
    leftTotal: navigation.leftTotal,
    rightTotal: navigation.rightTotal,
    version: `${limit}:${editing}`,
  });
  const current = Math.min(cursor, Math.max(model.hunks.length - 1, 0));
  function jump(index) {
    if (!model.hunks.length) return;
    const n = (index + model.hunks.length) % model.hunks.length;
    setEditing(false);
    setCursor(n);
    setLimit((v) => Math.max(v, model.hunks[n].endRow + 30));
    setTimeout(
      () =>
        scroll.current
          ?.querySelector(`[data-merge-row="${model.hunks[n].row}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      30,
    );
  }
  function adopt(from, index = current) {
    const h = model.hunks[index];
    if (!h) return;
    setHistory((hs) => [
      ...hs.slice(-19),
      { left: doc.left, right: doc.right },
    ]);
    change({ ...doc, ...adoptHunk(doc.left, doc.right, h, from) });
    setSide(from === "left" ? "right" : "left");
  }
  function undo() {
    if (!history.length) return;
    change({ ...doc, ...history[history.length - 1] });
    setHistory((h) => h.slice(0, -1));
  }
  useEffect(() => {
    const key = (e) => {
      if (e.key === "F7") {
        e.preventDefault();
        jump(current + (e.shiftKey ? -1 : 1));
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        adopt("left");
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        adopt("right");
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!busy) save(doc, side);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const firstRows = new Map(model.hunks.map((h, i) => [h.row, i]));
  return (
    <div className="text-document">
      <aside className="hunk-navigation">
        <b>
          差分导航 <span>{model.hunks.length}</span>
        </b>
        <DiffMap
          navigation={navigation}
          current={current}
          onJump={jump}
          viewport={viewport}
        />
        <div className="nav-prev-next">
          <button onClick={() => jump(current - 1)}>上一处</button>
          <button onClick={() => jump(current + 1)}>下一处</button>
        </div>
        {model.hunks.map((h, i) => (
          <button
            className={current === i ? "active" : ""}
            key={i}
            onClick={() => jump(i)}
          >
            <strong>
              差分 {i + 1} · 左 {h.leftStart + 1} / 右 {h.rightStart + 1}
            </strong>
            <small>
              {(
                model.rows[h.row]?.left ||
                model.rows[h.row]?.right ||
                "空行"
              ).slice(0, 85)}
            </small>
          </button>
        ))}
      </aside>
      <div className="editor-main">
        <ArchiveWarnings warnings={warnings} entry />
        <div className="merge-toolbar">
          <button
            disabled={!model.hunks.length || busy}
            onClick={() => adopt("left")}
            title="Alt+→"
          >
            <ArrowRight size={14} />
            使用左边
          </button>
          <button
            disabled={!model.hunks.length || busy}
            onClick={() => adopt("right")}
            title="Alt+←"
          >
            <ArrowLeft size={14} />
            使用右边
          </button>
          <button disabled={!history.length || busy} onClick={undo}>
            <RotateCcw size={14} />
            撤销合并
          </button>
          <span className="grow" />
          <button onClick={() => setEditing((v) => !v)}>
            {editing ? "查看差分" : "编辑文本"}
          </button>
        </div>
        <div className="editor-sides">
          {["left", "right"].map((s) => (
            <div
              key={s}
              onClick={() => setSide(s)}
              className={side === s ? "active" : ""}
            >
              <span>
                {s === "left" ? "A · 左侧" : "B · 右侧"} ·{" "}
                {doc.sides[s].encoding}
              </span>
              <b title={doc.sides[s].label}>{doc.sides[s].label}</b>
              <button
                disabled={
                  busy ||
                  doc[s] === doc[s === "left" ? "savedLeft" : "savedRight"]
                }
                onClick={() => save(doc, s)}
              >
                <Save size={13} />
                {doc.sides[s].writable ? "保存" : "另存为"}
              </button>
              <button disabled={busy} onClick={() => save(doc, s, true)}>
                另存为
              </button>
            </div>
          ))}
        </div>
        {model.error && (
          <div className="notice error-notice">{model.error}</div>
        )}
        {editing ? (
          <div className="raw-editors">
            {["left", "right"].map((s) => (
              <textarea
                key={s}
                aria-label={s === "left" ? "编辑左侧文本" : "编辑右侧文本"}
                value={doc[s]}
                spellCheck={false}
                onFocus={() => setSide(s)}
                onChange={(e) => change({ ...doc, [s]: e.target.value })}
              />
            ))}
          </div>
        ) : (
          <div className="merge-scroll" ref={scroll}>
            <table className="merge-table">
              <colgroup>
                <col style={{ width: 42 }} />
                <col />
                <col style={{ width: 70 }} />
                <col style={{ width: 42 }} />
                <col />
              </colgroup>
              <tbody>
                {model.rows.slice(0, limit).map((r, i) => (
                  <tr
                    key={i}
                    data-merge-row={i}
                    className={`${r.status} ${model.hunks[current] && i >= model.hunks[current].row && i < model.hunks[current].endRow ? "current-hunk" : ""}`}
                  >
                    <td className="line-number">{r.leftLine}</td>
                    <td
                      className={`left-cell ${r.left === null ? "missing" : ""}`}
                    >
                      {r.status === "changed" ? (
                        <CharacterDiff
                          left={r.left}
                          right={r.right}
                          side="left"
                        />
                      ) : (
                        r.left
                      )}
                    </td>
                    <td className="merge-gutter">
                      {firstRows.has(i) && (
                        <>
                          <button
                            title="使用左边的这个差分块"
                            disabled={busy}
                            onClick={() => adopt("left", firstRows.get(i))}
                          >
                            <ArrowRight size={13} />
                          </button>
                          <button
                            title="使用右边的这个差分块"
                            disabled={busy}
                            onClick={() => adopt("right", firstRows.get(i))}
                          >
                            <ArrowLeft size={13} />
                          </button>
                        </>
                      )}
                    </td>
                    <td className="line-number">{r.rightLine}</td>
                    <td
                      className={`right-cell ${r.right === null ? "missing" : ""}`}
                    >
                      {r.status === "changed" ? (
                        <CharacterDiff
                          left={r.left}
                          right={r.right}
                          side="right"
                        />
                      ) : (
                        r.right
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {model.rows.length > limit && (
              <button
                className="load-more"
                onClick={() => setLimit((v) => v + 600)}
              >
                继续加载（{limit} / {model.rows.length}）
              </button>
            )}
            {!model.hunks.length && (
              <div className="editor-equal">
                两侧内容一致
                {doc.left !== doc.savedLeft || doc.right !== doc.savedRight
                  ? " · 合并改动尚未保存"
                  : ""}
              </div>
            )}
          </div>
        )}
        <div className="merge-footnote">
          合并按原始文本对齐，保留忽略行；保存会检查文件版本并自动备份。
        </div>
      </div>
    </div>
  );
}
