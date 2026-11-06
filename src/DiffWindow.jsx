import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  X,
  Menu,
  Info,
  CircleAlert,
  Keyboard,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronUp,
  ChevronDown,
  SquarePen,
} from "lucide-react";
import {
  ActionMenu,
  PopupMenu,
  ToolButton,
  ToolbarSlot,
} from "./WorkspaceControls.jsx";
import Titlebar from "./Titlebar.jsx";
import FolderOverview from "./FolderOverview.jsx";
import { Detail, CharacterDiff } from "./App.jsx";
import { adoptHunk, textModel } from "../core/hunks.mjs";
import { textNavigation } from "../core/navigation.mjs";
import DiffMap from "./DiffMap.jsx";
import ArchiveWarnings from "./ArchiveWarnings.jsx";
import useDiffViewport from "./useDiffViewport.js";

const api = window.wiiMerge;
const base = (p) => p.split(/[\\/]/).pop();
export default function DiffWindow() {
  const query = new URLSearchParams(location.search),
    reportId = query.get("report"),
    initial = query.get("item");
  const [report, setReport] = useState(null),
    [tabs, setTabs] = useState([
      {
        id: "overview",
        type: "archive",
        folderKey: query.get("folder") || null,
        name: "差分一览",
      },
    ]),
    [active, setActive] = useState("overview"),
    [docs, setDocs] = useState({}),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [toolbarHost, setToolbarHost] = useState(null),
    [showNavigation, setShowNavigation] = useState(true),
    [showTextNavigation, setShowTextNavigation] = useState(false),
    [panel, setPanel] = useState(null),
    [tabContext, setTabContext] = useState(null);
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
  function openArchive(folder) {
    const id = "archive:" + folder.key;
    setTabs((ts) =>
      ts.some((t) => t.id === id)
        ? ts
        : [
            ...ts,
            {
              id,
              type: "archive",
              name: base(folder.path),
              folderKey: folder.key,
            },
          ],
    );
    setActive(id);
  }
  function navigate(folderKey) {
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, folderKey } : t)));
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
  function closeTab(id = active) {
    if (id === "overview") return;
    setTabs((ts) => {
      const index = ts.findIndex((t) => t.id === id),
        next = ts.filter((t) => t.id !== id);
      if (active === id)
        setActive(next[Math.max(0, index - 1)]?.id || "overview");
      return next;
    });
  }
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        const index = tabs.findIndex((t) => t.id === active);
        setActive(
          tabs[(index + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id,
        );
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeTab();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setShowNavigation((v) => !v);
      } else if (e.key === "F1") {
        e.preventDefault();
        setPanel("shortcuts");
      } else if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tabs, active]);
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
    <div className="diff-window compact-workspace">
      <Titlebar title="wiiMerge · 差分工作区" compact>
        <ActionMenu
          icon={Menu}
          label="工作区菜单"
          items={[
            {
              label: "差分一览",
              icon: Archive,
              action: () => setActive("overview"),
            },
            { separator: true },
            {
              label: "HTML 报告",
              icon: Download,
              disabled: busy,
              action: () => exportAll("html"),
            },
            {
              label: "Excel 报告",
              icon: Download,
              disabled: busy,
              action: () => exportAll("xlsx"),
            },
            { separator: true },
            {
              label: "显示差分导航",
              checked: showNavigation,
              shortcut: "Ctrl+B",
              action: () => setShowNavigation((v) => !v),
            },
            {
              label: "显示文字导航",
              checked: showTextNavigation,
              action: () => setShowTextNavigation((v) => !v),
            },
            { label: "比较信息", icon: Info, action: () => setPanel("info") },
            {
              label: "归档提示",
              icon: CircleAlert,
              disabled: !report.warnings?.length && !item?.warnings?.length,
              action: () => setPanel("warnings"),
            },
            {
              label: "快捷键",
              icon: Keyboard,
              shortcut: "F1",
              action: () => setPanel("shortcuts"),
            },
            { separator: true },
            {
              label: "关闭当前标签",
              icon: X,
              disabled: active === "overview",
              shortcut: "Ctrl+W",
              action: () => closeTab(),
            },
            {
              label: "关闭其他标签",
              disabled: tabs.length < 2,
              action: () =>
                setTabs((ts) =>
                  ts.filter((t) => t.id === active || t.id === "overview"),
                ),
            },
          ]}
        />
        <div
          className="document-tabs"
          role="tablist"
          aria-label="差分工作区标签"
        >
          {tabs.map((t) => (
            <div
              key={t.id}
              className={active === t.id ? "active" : ""}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabContext({
                  id: t.id,
                  anchor: {
                    x: e.clientX,
                    y: e.clientY,
                    focus: e.currentTarget.querySelector("button"),
                  },
                });
                setPanel(null);
              }}
            >
              <button
                role="tab"
                aria-selected={active === t.id}
                tabIndex={active === t.id ? 0 : -1}
                title={
                  t.path ||
                  report.folders?.find((f) => f.key === t.folderKey)?.path ||
                  t.name
                }
                onClick={() => setActive(t.id)}
              >
                {t.type === "archive" ? (
                  <Archive size={14} />
                ) : (
                  <FileText size={14} />
                )}
                <span>{t.name}</span>
                {docs[t.itemKey] &&
                  (docs[t.itemKey].left !== docs[t.itemKey].savedLeft ||
                    docs[t.itemKey].right !== docs[t.itemKey].savedRight) && (
                    <i className="tab-dirty" aria-label="未保存" />
                  )}
              </button>
              {t.id !== "overview" && (
                <button
                  aria-label={`关闭 ${t.name}`}
                  title="关闭标签 (Ctrl+W)"
                  onClick={() => closeTab(t.id)}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </Titlebar>
      {tabContext && (
        <PopupMenu
          anchor={tabContext.anchor}
          label="标签快捷菜单"
          onClose={() => setTabContext(null)}
          items={[
            {
              label: "关闭标签",
              icon: X,
              shortcut: "Ctrl+W",
              disabled: tabContext.id === "overview",
              action: () => closeTab(tabContext.id),
            },
            {
              label: "关闭其他标签",
              disabled: tabs.length < 2,
              action: () => {
                setActive(tabContext.id);
                setTabs((ts) =>
                  ts.filter(
                    (t) => t.id === tabContext.id || t.id === "overview",
                  ),
                );
              },
            },
            { separator: true },
            {
              label: "返回差分一览",
              icon: Archive,
              action: () => setActive("overview"),
            },
          ]}
        />
      )}
      <div
        className="workspace-commandbar"
        role="toolbar"
        aria-label="差分操作"
      >
        <div className="workspace-active-tools" ref={setToolbarHost} />
        <div className="workspace-common-tools">
          {item && item.type !== "text" && (
            <>
              <ToolButton
                icon={ArrowRight}
                label="整文件使用左边"
                disabled={
                  busy ||
                  mixedExcel ||
                  !!item.error ||
                  item.type === "directory"
                }
                onClick={() => adoptWhole("left")}
              />
              <ToolButton
                icon={ArrowLeft}
                label="整文件使用右边"
                disabled={
                  busy ||
                  mixedExcel ||
                  !!item.error ||
                  item.type === "directory"
                }
                onClick={() => adoptWhole("right")}
              />
            </>
          )}
          {tab.type === "file" && ["text", "excel"].includes(item?.type) && (
            <ToolButton
              icon={showNavigation ? PanelLeftClose : PanelLeftOpen}
              label={showNavigation ? "隐藏差分导航" : "显示差分导航"}
              shortcut="Ctrl+B"
              active={showNavigation}
              onClick={() => setShowNavigation((v) => !v)}
            />
          )}
          <ActionMenu
            icon={Download}
            label="导出报告"
            items={[
              {
                label: "HTML 报告",
                disabled: busy,
                action: () => exportAll("html"),
              },
              {
                label: "Excel 报告",
                disabled: busy,
                action: () => exportAll("xlsx"),
              },
            ]}
          />
          {!!(report.warnings?.length || item?.warnings?.length) && (
            <ToolButton
              icon={CircleAlert}
              label="归档提示"
              onClick={() => setPanel("warnings")}
            />
          )}
          <ToolButton
            icon={Info}
            label="比较信息"
            onClick={() => setPanel("info")}
          />
          {dirty && (
            <i
              className="workspace-dirty"
              title="含未保存的合并内容"
              aria-label="含未保存改动"
            />
          )}
          {busy && (
            <LoaderCircle size={14} className="spin" aria-label="正在处理" />
          )}
        </div>
      </div>
      {panel && (
        <div
          className="workspace-info-panel"
          role="dialog"
          aria-label={
            panel === "info"
              ? "比较信息"
              : panel === "warnings"
                ? "归档提示"
                : "快捷键"
          }
        >
          <div className="workspace-panel-heading">
            <b>
              {panel === "info"
                ? "比较信息"
                : panel === "warnings"
                  ? "归档提示"
                  : "快捷键"}
            </b>
            <ToolButton
              icon={X}
              label="关闭信息面板"
              onClick={() => setPanel(null)}
            />
          </div>
          {panel === "info" ? (
            <>
              <dl>
                <dt>左侧</dt>
                <dd>{report.leftLabel}</dd>
                <dt>右侧</dt>
                <dd>{report.rightLabel}</dd>
                <dt>当前左侧文件</dt>
                <dd>{item?.leftPath || "—"}</dd>
                <dt>当前右侧文件</dt>
                <dd>{item?.rightPath || "—"}</dd>
                <dt>比较对象</dt>
                <dd>
                  {(report.objectSummary || report.summary).total} 项 · 错误{" "}
                  {(report.objectSummary || report.summary).error} 项
                </dd>
              </dl>
              <details>
                <summary>比较规则</summary>
                <pre>{JSON.stringify(report.rules, null, 2)}</pre>
              </details>
              <p>保存会检查外部修改并保留备份；归档内容通过另存为保存。</p>
            </>
          ) : panel === "warnings" ? (
            <>
              <ArchiveWarnings warnings={report.warnings} />
              <ArchiveWarnings warnings={item?.warnings} entry />
            </>
          ) : (
            <dl className="shortcut-list">
              <dt>F7 / Shift+F7</dt>
              <dd>下一处 / 上一处差异</dd>
              <dt>Alt+→ / Alt+←</dt>
              <dd>使用左边 / 使用右边</dd>
              <dt>Ctrl+S</dt>
              <dd>保存当前选中侧</dd>
              <dt>Ctrl+Shift+S</dt>
              <dd>当前侧另存为</dd>
              <dt>Ctrl+B</dt>
              <dd>显示 / 隐藏差分导航</dd>
              <dt>Ctrl+Tab</dt>
              <dd>下一个标签（加 Shift 反向）</dd>
              <dt>Ctrl+W</dt>
              <dd>关闭当前标签</dd>
              <dt>F1</dt>
              <dd>快捷键说明</dd>
            </dl>
          )}
        </div>
      )}
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
        {tab.type === "archive" ? (
          <div className="archive-overview">
            <FolderOverview
              key={tab.id}
              compact
              toolbarHost={toolbarHost}
              report={report}
              folderKey={tab.folderKey}
              onNavigate={navigate}
              onOpenFile={openItem}
              onOpenArchive={openArchive}
              filter={filter}
              onFilter={setFilter}
            />
          </div>
        ) : item?.type === "text" && doc ? (
          <TextEditor
            key={doc.id}
            doc={doc}
            change={change}
            save={save}
            busy={busy}
            toolbarHost={toolbarHost}
            showNavigation={showNavigation}
            showTextNavigation={showTextNavigation}
          />
        ) : (
          <div className="readonly-document">
            <div className="detail-panel">
              {item && (
                <Detail
                  key={item.key}
                  item={item}
                  compact
                  toolbarHost={toolbarHost}
                  showNavigation={showNavigation}
                  showTextNavigation={showTextNavigation}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextEditor({
  doc,
  change,
  save,
  busy,
  toolbarHost,
  showNavigation,
  showTextNavigation,
}) {
  const [cursor, setCursor] = useState(0),
    [limit, setLimit] = useState(600),
    [editing, setEditing] = useState(false),
    [side, setSide] = useState("right"),
    [history, setHistory] = useState([]),
    [context, setContext] = useState(null);
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
          mapStart: index,
          mapEnd: index + 1,
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
    mapTotal: navigation.mapTotal,
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
        if (!busy) save(doc, side, e.shiftKey);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const firstRows = new Map(model.hunks.map((h, i) => [h.row, i]));
  return (
    <div className="text-document">
      <ToolbarSlot host={toolbarHost}>
        <ToolButton
          icon={ChevronUp}
          label="上一处差异"
          shortcut="Shift+F7"
          disabled={!model.hunks.length}
          onClick={() => jump(current - 1)}
        />
        <ToolButton
          icon={ChevronDown}
          label="下一处差异"
          shortcut="F7"
          disabled={!model.hunks.length}
          onClick={() => jump(current + 1)}
        />
        <span className="workspace-tool-count">
          {model.hunks.length ? current + 1 : 0} / {model.hunks.length}
        </span>
        <span className="workspace-tool-separator" />
        <ToolButton
          icon={ArrowRight}
          label="使用左边"
          shortcut="Alt+→"
          disabled={busy || !model.hunks.length}
          onClick={() => adopt("left")}
        />
        <ToolButton
          icon={ArrowLeft}
          label="使用右边"
          shortcut="Alt+←"
          disabled={busy || !model.hunks.length}
          onClick={() => adopt("right")}
        />
        <ToolButton
          icon={RotateCcw}
          label="撤销合并"
          disabled={busy || !history.length}
          onClick={undo}
        />
        <span className="workspace-tool-separator" />
        <select
          className="workspace-side-select"
          aria-label="保存目标侧"
          value={side}
          onChange={(e) => setSide(e.target.value)}
        >
          <option value="left">左侧</option>
          <option value="right">右侧</option>
        </select>
        <ToolButton
          icon={Save}
          label={`${doc.sides[side].writable ? "保存" : "另存"}${side === "left" ? "左侧" : "右侧"}`}
          shortcut="Ctrl+S"
          disabled={
            busy ||
            (doc.sides[side].writable &&
              doc[side] === doc[side === "left" ? "savedLeft" : "savedRight"])
          }
          onClick={() => save(doc, side)}
        />
        <ToolButton
          icon={SquarePen}
          label={editing ? "查看差分" : "编辑文本"}
          active={editing}
          onClick={() => setEditing((v) => !v)}
        />
        <ActionMenu
          icon={MoreHorizontal}
          label="更多文件操作"
          items={[
            {
              label: "保存左侧",
              disabled: busy,
              action: () => save(doc, "left"),
            },
            {
              label: "保存右侧",
              disabled: busy,
              action: () => save(doc, "right"),
            },
            {
              label: "左侧另存为",
              disabled: busy,
              action: () => save(doc, "left", true),
            },
            {
              label: "右侧另存为",
              disabled: busy,
              action: () => save(doc, "right", true),
            },
          ]}
        />
      </ToolbarSlot>
      {showNavigation && (
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
          <details className="text-navigation" hidden={!showTextNavigation}>
            <summary>文本导航</summary>
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
          </details>
        </aside>
      )}
      <div
        className="editor-main"
        onPointerDown={(e) => {
          if (e.target.closest(".left-cell")) setSide("left");
          else if (e.target.closest(".right-cell")) setSide("right");
        }}
        onContextMenu={(e) => {
          if (e.target.closest("textarea")) return;
          e.preventDefault();
          const row = Number(
            e.target.closest("[data-merge-row]")?.dataset.mergeRow,
          );
          const index = model.hunks.findIndex(
            (h) => row >= h.row && row < h.endRow,
          );
          const targetSide = e.target.closest(".left-cell")
            ? "left"
            : e.target.closest(".right-cell")
              ? "right"
              : side;
          if (index >= 0) setCursor(index);
          setSide(targetSide);
          setContext({
            index: index >= 0 ? index : current,
            side: targetSide,
            anchor: { x: e.clientX, y: e.clientY, focus: e.currentTarget },
          });
        }}
      >
        {context && (
          <PopupMenu
            anchor={context.anchor}
            label="文本差分快捷菜单"
            onClose={() => setContext(null)}
            items={[
              {
                label: "使用左边",
                icon: ArrowRight,
                shortcut: "Alt+→",
                disabled: busy || !model.hunks.length,
                action: () => adopt("left", context.index),
              },
              {
                label: "使用右边",
                icon: ArrowLeft,
                shortcut: "Alt+←",
                disabled: busy || !model.hunks.length,
                action: () => adopt("right", context.index),
              },
              {
                label: "撤销合并",
                icon: RotateCcw,
                disabled: busy || !history.length,
                action: undo,
              },
              { separator: true },
              {
                label: `保存${context.side === "left" ? "左侧" : "右侧"}`,
                icon: Save,
                shortcut: "Ctrl+S",
                disabled: busy,
                action: () => save(doc, context.side),
              },
              {
                label: `${context.side === "left" ? "左侧" : "右侧"}另存为`,
                disabled: busy,
                action: () => save(doc, context.side, true),
              },
            ]}
          />
        )}
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
              <thead className="merge-column-head">
                <tr>
                  <th colSpan={2}>
                    <button
                      className={side === "left" ? "active" : ""}
                      aria-label="选择左侧为保存目标"
                      title={doc.sides.left.label}
                      onClick={() => setSide("left")}
                    >
                      A · 左侧{" "}
                      <span>
                        {base(doc.sides.left.label)} · {doc.sides.left.encoding}
                      </span>
                    </button>
                  </th>
                  <th />
                  <th colSpan={2}>
                    <button
                      className={side === "right" ? "active" : ""}
                      aria-label="选择右侧为保存目标"
                      title={doc.sides.right.label}
                      onClick={() => setSide("right")}
                    >
                      B · 右侧{" "}
                      <span>
                        {base(doc.sides.right.label)} ·{" "}
                        {doc.sides.right.encoding}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
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
      </div>
    </div>
  );
}
