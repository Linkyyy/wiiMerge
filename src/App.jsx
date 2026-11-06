import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  File,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  FolderOpen,
  Info,
  LoaderCircle,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  WrapText,
  X,
} from "lucide-react";
import { diffChars } from "diff";
import { DEFAULT_RULES } from "../core/defaults.mjs";

import Titlebar from "./Titlebar.jsx";
import FolderOverview from "./FolderOverview.jsx";
import DiffMap from "./DiffMap.jsx";
import ArchiveWarnings from "./ArchiveWarnings.jsx";
import useDiffViewport from "./useDiffViewport.js";
import { excelNavigation } from "../core/navigation.mjs";
const api = window.wiiMerge;
const LABELS = {
  changed: "有差异",
  added: "仅右侧",
  removed: "仅左侧",
  equal: "一致",
  error: "未能比较",
};
const TYPE_LABELS = {
  text: "文本",
  excel: "Excel",
  binary: "二进制",
  directory: "文件夹",
};
const MODES = [
  { id: "files", label: "文件比较", icon: Files },
  { id: "folders", label: "文件夹比较", icon: Folder },
  { id: "text", label: "文本比较", icon: FileText },
];
const SAMPLE_LEFT =
  '{\n  "name": "wiiMerge",\n  "version": "1.0.0",\n  "features": ["text", "files"],\n  "theme": "light"\n}\n';
const SAMPLE_RIGHT =
  '{\n  "name": "wiiMerge",\n  "version": "2.0.0",\n  "features": ["text", "files", "excel"],\n  "theme": "light",\n  "export": true\n}\n';
const basename = (path) => path?.split(/[\\/]/).filter(Boolean).pop() ?? "";
function IconButton({ icon: Icon, title, ...props }) {
  return (
    <button className="icon-button" title={title} aria-label={title} {...props}>
      <Icon size={16} />
    </button>
  );
}
function FileIcon({ type, size = 18 }) {
  const Icon =
    type === "excel"
      ? FileSpreadsheet
      : type === "text"
        ? FileCode2
        : type === "directory"
          ? Folder
          : File;
  return <Icon size={size} />;
}
function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} />;
}
function bytes(value) {
  return value == null
    ? "不存在"
    : value < 1024
      ? `${value} B`
      : value < 1048576
        ? `${(value / 1024).toFixed(1)} KB`
        : `${(value / 1048576).toFixed(1)} MB`;
}

export default function App() {
  const [mode, setMode] = useState("files");
  const [paths, setPaths] = useState({ left: "", right: "" });
  const [texts, setTexts] = useState({ left: "", right: "" });
  const [rules, setRules] = useState(structuredClone(DEFAULT_RULES));
  const [rulesOpen, setRulesOpen] = useState(false);
  const [report, setReport] = useState(null),
    [signature, setSignature] = useState("");
  const [folderKey, setFolderKey] = useState(null),
    [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState(null);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [exportOpen, setExportOpen] = useState(false);
  const [editText, setEditText] = useState(true);
  const currentSignature = JSON.stringify({
    mode,
    input: mode === "text" ? texts : paths,
    rules,
  });
  const stale = !!report && currentSignature !== signature;
  const currentInput = mode === "text" ? texts : paths;
  const canCompare = mode === "text" || (!!paths.left && !!paths.right);

  useEffect(() => {
    if (api) {
      api
        .loadRules()
        .then(setRules)
        .catch((e) => setError(e.message));
      return api.onProgress((value) => {
        if (value.reportUpdated)
          setReport((previous) =>
            previous?.id === value.reportUpdated.id
              ? value.reportUpdated
              : previous,
          );
        else setProgress(value);
      });
    }
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const notifyError = (e) =>
    setError(
      String(e.message ?? e).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      ),
    );
  const choose = async (side) => {
    if (!api) {
      setError("请在桌面应用中选择本地文件。开发启动命令：npm run dev");
      return;
    }
    try {
      const result = await api.choosePath(
        mode === "folders" ? "folder" : "file",
      );
      if (result) setPaths((p) => ({ ...p, [side]: result }));
    } catch (e) {
      notifyError(e);
    }
  };
  const drop = async (event, side) => {
    event.preventDefault();
    if (!api || busy) return;
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    try {
      if (files.length > 2) throw new Error("一次最多拖入两个文件或文件夹");
      const selected = api.droppedPaths
        ? await api.droppedPaths(files)
        : [await api.droppedPath(files[0])];
      if (selected.length === 2) {
        if (selected[0].kind !== selected[1].kind)
          throw new Error("左右两侧请选择同类路径");
        setMode(selected[0].kind === "folder" ? "folders" : "files");
        setPaths({ left: selected[0].path, right: selected[1].path });
      } else {
        setMode(selected[0].kind === "folder" ? "folders" : "files");
        setPaths((p) => ({ ...p, [side]: selected[0].path }));
      }
    } catch (e) {
      notifyError(e);
    }
  };

  const run = useCallback(async () => {
    if (busy || exporting || !canCompare) return;
    if (!api) {
      setError("浏览器仅用于界面预览，请运行 npm run dev 启动桌面应用后比较。");
      return;
    }
    setBusy(true);
    setSignature("");
    setError("");
    setProgress({ message: "准备比较…" });
    try {
      const result = await api.compare({ mode, ...currentInput, rules });
      setReport(result);
      setSignature(currentSignature);
      setFilter("all");
      setFolderKey(null);
      setEditText(false);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [
    busy,
    exporting,
    canCompare,
    mode,
    currentInput,
    rules,
    currentSignature,
  ]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
      if (e.key === "Escape") {
        setRulesOpen(false);
        setExportOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run]);
  const swap = () => {
    if (mode === "text") setTexts((p) => ({ left: p.right, right: p.left }));
    else setPaths((p) => ({ left: p.right, right: p.left }));
  };
  const exportReport = async (format) => {
    setExportOpen(false);
    setExporting(true);
    setError("");
    try {
      const file = await api.exportReport(report.id, format);
      if (file) setToast(`报告已导出到 ${file}`);
    } catch (e) {
      notifyError(e);
    } finally {
      setExporting(false);
    }
  };
  const activeRules =
    [
      rules.ignoreCase,
      rules.ignoreBlankLines,
      rules.whitespace !== "none",
      rules.pathIgnoreCase,
      rules.encoding !== "auto",
      !!rules.excelKeyColumns,
      !rules.excelFormulas,
    ].filter(Boolean).length +
    rules.ignoreLines.length +
    rules.replacements.length +
    rules.pathReplacements.length;

  return (
    <div
      className={`app-shell ${report ? "has-results" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (!e.defaultPrevented) drop(e, "left");
      }}
    >
      <Titlebar>
        <button
          className="button subtle"
          disabled={busy || exporting}
          onClick={() => setRulesOpen(true)}
        >
          <Settings2 size={15} />
          比较规则
          {activeRules > 0 && <span className="counter">{activeRules}</span>}
        </button>
      </Titlebar>
      <main className="main-layout">
        <section className="workspace-top">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">COMPARE WORKSPACE</div>
              <h1>
                让每一处差异，都清晰可见<span>。</span>
              </h1>
              <p>从一行文本到整个文件夹，用同一套规则发现不同。</p>
            </div>
            <div className="format-badges">
              <span>TXT</span>
              <span>XLSX</span>
              <span>ZIP</span>
              <span>WAR / JAR</span>
            </div>
          </div>
          <div className="mode-row">
            <div className="mode-tabs" role="tablist" aria-label="比较模式">
              {MODES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={mode === id}
                  disabled={busy || exporting}
                  className={mode === id ? "active" : ""}
                  onClick={() => {
                    setMode(id);
                    setReport(null);
                    setError("");
                    setEditText(true);
                  }}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
            <div className="keyboard-hint">
              <kbd>Ctrl</kbd>
              <span>+</span>
              <kbd>Enter</kbd> 开始比较
            </div>
          </div>
          <div
            className={`input-workspace ${mode === "text" ? "text-input-workspace" : ""}`}
          >
            {mode === "text" ? (
              <>
                <div className="text-input-header">
                  <span>
                    <Braces size={16} />
                    粘贴文本，立即比较
                  </span>
                  <div>
                    <button
                      disabled={busy}
                      className="text-button"
                      onClick={() => {
                        setTexts({ left: SAMPLE_LEFT, right: SAMPLE_RIGHT });
                        setEditText(true);
                      }}
                    >
                      载入示例
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setEditText((v) => !v)}
                    >
                      {!report || editText ? "收起输入" : "编辑文本"}
                    </button>
                  </div>
                </div>
                {(!report || editText) && (
                  <div className="text-editors">
                    {["left", "right"].map((side, i) => (
                      <div className="text-editor" key={side}>
                        <label htmlFor={`text-${side}`}>
                          <span className={`side-tag ${side}`}>
                            {i === 0 ? "A" : "B"}
                          </span>
                          {i === 0 ? "左侧 · 原始文本" : "右侧 · 对比文本"}
                          <span>
                            {texts[side].length.toLocaleString()} 字符
                          </span>
                        </label>
                        <textarea
                          id={`text-${side}`}
                          disabled={busy}
                          spellCheck={false}
                          placeholder={
                            i === 0
                              ? "在此粘贴原始文本…"
                              : "在此粘贴需要对比的文本…"
                          }
                          value={texts[side]}
                          onChange={(e) =>
                            setTexts((p) => ({ ...p, [side]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="path-inputs">
                {["left", "right"].map((side, i) => (
                  <React.Fragment key={side}>
                    {i === 1 && (
                      <IconButton
                        icon={ArrowLeftRight}
                        title="交换左右输入"
                        disabled={busy}
                        onClick={swap}
                      />
                    )}
                    <div
                      className="path-card"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, side)}
                    >
                      <div className="path-label">
                        <span className={`side-tag ${side}`}>
                          {i === 0 ? "A" : "B"}
                        </span>
                        {i === 0 ? "左侧 · 原始版本" : "右侧 · 对比版本"}
                      </div>
                      <div className="path-field">
                        <FolderOpen size={18} />
                        <input
                          aria-label={i === 0 ? "左侧路径" : "右侧路径"}
                          readOnly
                          title={paths[side]}
                          value={paths[side]}
                          placeholder={`选择或拖入${mode === "folders" ? "文件夹" : "文件、ZIP / WAR / JAR"}…`}
                          onClick={() => !busy && choose(side)}
                        />
                        <button
                          className="browse-button"
                          disabled={busy}
                          onClick={() => choose(side)}
                        >
                          选择{mode === "folders" ? "文件夹" : "文件"}
                        </button>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
            <div className="input-actions">
              <div className="active-rules">
                <SlidersHorizontal size={14} />
                <span>
                  {activeRules
                    ? `${activeRules} 项自定义匹配规则`
                    : "标准比较规则"}
                </span>
                <span className="separator">·</span>
                <span>
                  {mode === "text"
                    ? "统一换行符"
                    : `已排除 ${rules.exclude.length} 类路径`}
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setRulesOpen(true)}
                >
                  配置
                  <ChevronRight size={13} />
                </button>
              </div>
              <div className="action-buttons">
                {mode === "text" && (
                  <IconButton
                    icon={ArrowDownUp}
                    title="交换左右文本"
                    disabled={busy}
                    onClick={swap}
                  />
                )}
                {busy ? (
                  <button
                    className="button cancel-button"
                    onClick={() => api.cancel()}
                  >
                    <X size={16} />
                    取消比较
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={!canCompare || exporting}
                    onClick={run}
                  >
                    <Play size={15} fill="currentColor" />
                    开始比较
                    <ArrowRight size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
        {!api && (
          <div className="notice">
            <Info size={16} />
            当前是浏览器界面预览，完整功能请使用 Electron 桌面端。
          </div>
        )}
        {error && (
          <div role="alert" className="notice error-notice">
            <CircleAlert size={17} />
            <span>{error}</span>
            <IconButton
              icon={X}
              title="关闭错误提示"
              onClick={() => setError("")}
            />
          </div>
        )}
        {busy && (
          <div className="notice progress-notice" role="status">
            <LoaderCircle className="spin" size={16} />
            <span>{progress?.message}</span>
            {progress?.total > 0 && (
              <span>
                {progress.completed} / {progress.total}
              </span>
            )}
          </div>
        )}
        {report ? (
          <section className={`results-section ${busy ? "is-busy" : ""}`}>
            <div className="results-heading">
              <div>
                <h2>
                  比较结果{" "}
                  <span className="result-count">
                    {(report.objectSummary || report.summary).total}
                  </span>
                </h2>
                <span className={`result-status ${stale ? "stale" : ""}`}>
                  {stale ? (
                    <>
                      <CircleAlert size={13} />
                      输入或规则已更改，请重新比较
                    </>
                  ) : (
                    <>
                      <CheckCheck size={14} />
                      {report.summary.error
                        ? "比较完成，部分条目未能读取"
                        : "比较完成"}
                      <span>· {(report.durationMs / 1000).toFixed(2)} 秒</span>
                    </>
                  )}
                </span>
              </div>
              <div className="export-container">
                <button
                  className="button secondary"
                  disabled={stale || busy || exporting}
                  onClick={() => setExportOpen((v) => !v)}
                  aria-expanded={exportOpen}
                >
                  {exporting ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Download size={15} />
                  )}
                  导出报告
                  <ChevronDown size={14} />
                </button>
                {exportOpen && (
                  <>
                    <div
                      className="menu-backdrop"
                      onClick={() => setExportOpen(false)}
                    />
                    <div className="export-menu">
                      <button onClick={() => exportReport("html")}>
                        <FileCode2 size={17} />
                        <div>
                          HTML 报告<small>可独立打开，保留差异颜色</small>
                        </div>
                      </button>
                      <button onClick={() => exportReport("xlsx")}>
                        <FileSpreadsheet size={17} />
                        <div>
                          Excel 报告<small>分类工作表，方便筛选分析</small>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <ArchiveWarnings warnings={report.warnings} />
            <div className="summary-strip">
              {[
                { key: "changed", icon: ArrowLeftRight },
                { key: "added", icon: Plus },
                { key: "removed", icon: Minus },
                { key: "equal", icon: Check },
                ...((report.objectSummary || report.summary).error
                  ? [{ key: "error", icon: CircleAlert }]
                  : []),
              ].map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  className={`summary-stat ${key} ${filter === key ? "selected" : ""}`}
                  onClick={() => setFilter((v) => (v === key ? "all" : key))}
                >
                  <span className="stat-icon">
                    <Icon size={16} />
                  </span>
                  <span>{LABELS[key]}</span>
                  <b>{(report.objectSummary || report.summary)[key]}</b>
                </button>
              ))}
            </div>
            <div className="result-workspace overview-workspace">
              <div className="comparison-overview archive-overview">
                <FolderOverview
                  key={report.id}
                  report={report}
                  folderKey={folderKey}
                  onNavigate={setFolderKey}
                  filter={filter}
                  onFilter={setFilter}
                  onOpenFile={(item) =>
                    api.openDiff?.({ reportId: report.id, itemKey: item.key })
                  }
                  extra={
                    <button
                      className="button primary"
                      onClick={() =>
                        api.openDiff?.({ reportId: report.id, folderKey })
                      }
                    >
                      打开独立差分窗口
                    </button>
                  }
                />
              </div>
            </div>
          </section>
        ) : (
          <EmptyState
            mode={mode}
            onSample={() => {
              setMode("text");
              setTexts({ left: SAMPLE_LEFT, right: SAMPLE_RIGHT });
            }}
          />
        )}
      </main>
      <footer className="app-footer">
        <span>
          <i className="ready-dot" />
          {busy ? "正在比较" : "就绪"}
          <span className="footer-divider">/</span>本地差异引擎
        </span>
        <span>
          本地比较，合并后手动保存
          <ShieldCheck size={13} />
          <span className="footer-divider">·</span>Windows 优先
        </span>
      </footer>
      {rulesOpen && (
        <RulesPanel
          initial={rules}
          onClose={() => setRulesOpen(false)}
          onApply={async (next) => {
            if (!api) throw new Error("规则保存需要在桌面端完成");
            const saved = await api.saveRules(next);
            setRules(saved);
            setToast("比较规则已保存，将应用于下一次比较");
            setRulesOpen(false);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          <span>{toast}</span>
          <IconButton icon={X} title="关闭通知" onClick={() => setToast("")} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ mode, onSample }) {
  return (
    <section className="empty-state">
      <div className="empty-pattern">
        <div className="empty-file left-file">
          <FileText size={35} />
          <span />
          <span />
          <span />
        </div>
        <div className="empty-compare">
          <ArrowLeftRight size={23} />
        </div>
        <div className="empty-file right-file">
          <FileText size={35} />
          <span />
          <span />
          <span />
        </div>
      </div>
      <h2>好奇不同，从这里开始</h2>
      <p>
        {mode === "text"
          ? "在上方粘贴两段文本，开始你的第一次比较。"
          : `选择左右两侧的${mode === "folders" ? "文件夹" : "文件"}，每一处变化都会清晰呈现。`}
      </p>
      <button className="text-button sample-link" onClick={onSample}>
        用一段示例体验文本比较
        <ArrowRight size={15} />
      </button>
      <div className="capability-grid">
        {[
          {
            icon: FileCode2,
            title: "文本与代码",
            body: "并排查看，精确到字符",
          },
          {
            icon: FileSpreadsheet,
            title: "Excel 工作簿",
            body: "单元格差异 · 主键行匹配",
          },
          {
            icon: FileArchive,
            title: "归档与文件夹",
            body: "ZIP / WAR / JAR · 嵌套展开",
          },
          {
            icon: Download,
            title: "分享比较结果",
            body: "导出 HTML / Excel 报告",
          },
        ].map(({ icon: Icon, title, body }) => (
          <div className="capability" key={title}>
            <Icon size={20} />
            <b>{title}</b>
            <small>{body}</small>
          </div>
        ))}
      </div>
      <div className="privacy-note">
        <ShieldCheck size={13} />
        所有内容均在本地处理，无需账号，无需上传。
      </div>
    </section>
  );
}

export function CharacterDiff({ left, right, side }) {
  const changes = useMemo(
    () =>
      left?.length + right?.length < 4000
        ? diffChars(left ?? "", right ?? "")
        : null,
    [left, right],
  );
  if (!changes) return side === "left" ? left : right;
  return changes
    .filter((c) => (side === "left" ? !c.added : !c.removed))
    .map((c, i) => (
      <span key={i} className={c.added || c.removed ? "character-change" : ""}>
        {c.value}
      </span>
    ));
}

export function Detail({ item }) {
  const d = item.details;
  const [diffOnly, setDiffOnly] = useState(false),
    [wrap, setWrap] = useState(true),
    [limit, setLimit] = useState(500);
  const [sheet, setSheet] = useState("all"),
    [cursor, setCursor] = useState(-1);
  const scroll = useRef(null);
  const rows = useMemo(
    () =>
      d?.kind === "text"
        ? d.rows.filter((r) => !diffOnly || r.status !== "equal")
        : d?.kind === "excel"
          ? d.changes.filter((r) => sheet === "all" || sheet === r.sheet)
          : [],
    [d, diffOnly, sheet],
  );
  const changes = useMemo(
    () =>
      rows
        .map((r, i) => (r.status !== "equal" ? i : -1))
        .filter((i) => i !== -1),
    [rows],
  );
  const navigation = useMemo(
    () =>
      d?.kind === "excel"
        ? excelNavigation(d, rows, sheet)
        : { ranges: [], leftTotal: 1, rightTotal: 1 },
    [d, rows, sheet],
  );
  const positionAt = useMemo(
    () => (index) => navigation.ranges[index],
    [navigation],
  );
  const viewport = useDiffViewport(scroll, {
    selector: "[data-row]",
    attribute: "data-row",
    positionAt,
    leftTotal: navigation.leftTotal,
    rightTotal: navigation.rightTotal,
    version: limit,
  });
  const selectRow = (rowIndex) => {
    setCursor(changes.indexOf(rowIndex));
    setLimit((n) => Math.max(n, rowIndex + 100));
    setTimeout(
      () =>
        scroll.current
          ?.querySelector(`[data-row="${rowIndex}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      30,
    );
  };
  const jump = (step) => {
    if (!changes.length) return;
    const index =
        cursor < 0
          ? step > 0
            ? 0
            : changes.length - 1
          : (cursor + step + changes.length) % changes.length,
      rowIndex = changes[index];
    selectRow(rowIndex);
  };
  useEffect(() => {
    const key = (event) => {
      if (d?.kind === "excel" && event.key === "F7") {
        event.preventDefault();
        jump(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [d, changes, cursor]);
  return (
    <>
      <div className="detail-header">
        <div className="detail-filename">
          <FileIcon type={item.type} size={17} />
          <strong title={item.path}>{item.path}</strong>
          <span className={`status-pill ${item.status}`}>
            {LABELS[item.status]}
          </span>
        </div>
        <div className="detail-tools">
          {d?.kind === "text" && (
            <>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={diffOnly}
                  onChange={(e) => {
                    setDiffOnly(e.target.checked);
                    setCursor(-1);
                    setLimit(500);
                  }}
                />
                只看差异
              </label>
              <IconButton
                icon={WrapText}
                title="切换自动换行"
                className={`icon-button ${wrap ? "is-active" : ""}`}
                onClick={() => setWrap((v) => !v)}
              />
            </>
          )}
          {(d?.kind === "text" || d?.kind === "excel") && (
            <>
              <span className="tool-divider" />
              <span className="diff-position">
                {cursor < 0 ? 0 : cursor + 1} / {changes.length}
              </span>
              <IconButton
                icon={ArrowUp}
                title="上一处差异"
                disabled={!changes.length}
                onClick={() => jump(-1)}
              />
              <IconButton
                icon={ArrowDown}
                title="下一处差异"
                disabled={!changes.length}
                onClick={() => jump(1)}
              />
            </>
          )}
        </div>
      </div>
      {item.leftPath !== item.rightPath && item.leftPath && item.rightPath && (
        <div className="match-note">
          路径匹配：{item.leftPath} <ArrowRight size={12} /> {item.rightPath}
        </div>
      )}
      {d?.truncated && (
        <div className="inline-warning">
          <CircleAlert size={14} />
          {d.contextOmitted
            ? "文本较长，已省略一致行；最多保留 12,000 行差异，统计包含完整输入。"
            : "明细超过 12,000 条，已截断；统计总数仍包含完整输入。"}
        </div>
      )}
      {d?.kind === "excel" && (
        <div className="sheet-tabs">
          <button
            className={sheet === "all" ? "active" : ""}
            onClick={() => {
              setSheet("all");
              setCursor(-1);
            }}
          >
            全部工作表
          </button>
          {d.sheets.map((s) => (
            <button
              key={s.name}
              className={sheet === s.name ? "active" : ""}
              onClick={() => {
                setSheet(s.name);
                setCursor(-1);
                setLimit(500);
              }}
            >
              <StatusDot status={s.status} />
              {s.name}
              <small>
                {s.leftRows} / {s.rightRows} 行
              </small>
            </button>
          ))}
        </div>
      )}
      <ArchiveWarnings warnings={item.warnings} entry />
      <div className="detail-with-map">
        {d?.kind === "excel" && (
          <aside className="hunk-navigation excel-navigation">
            <b>
              差分导航 <span>{rows.length}</span>
            </b>
            <DiffMap
              navigation={navigation}
              current={cursor}
              onJump={selectRow}
              viewport={viewport}
            />
            <details className="text-navigation">
              <summary>文本导航</summary>
              {rows.slice(0, limit).map((c, i) => (
                <button
                  key={i}
                  className={cursor === i ? "active" : ""}
                  onClick={() => selectRow(i)}
                >
                  <strong>
                    {c.sheet} · {c.column}
                    {c.leftRow || c.rightRow}
                  </strong>
                  <small>
                    {c.left} → {c.right}
                  </small>
                </button>
              ))}
              {rows.length > limit && (
                <button onClick={() => setLimit((n) => n + 500)}>
                  继续显示差分
                </button>
              )}
            </details>
          </aside>
        )}
        <div className="diff-scroll" ref={scroll}>
          {item.error ? (
            <div className="detail-empty error-detail">
              <CircleAlert size={32} />
              <h3>此条目未能比较</h3>
              <p>{item.error}</p>
              <small>该条目不会计入“一致”，请修正输入后重新比较。</small>
            </div>
          ) : d?.kind === "text" ? (
            <table className={`text-diff ${wrap ? "wrap" : "nowrap"}`}>
              <colgroup>
                <col className="line-col" />
                <col className="content-col" />
                <col className="line-col" />
                <col className="content-col" />
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={2}>
                    <span className="side-tag left">A</span>
                    {item.leftPath ?? "左侧不存在"}
                    <span>{d.leftLines} 行</span>
                  </th>
                  <th colSpan={2}>
                    <span className="side-tag right">B</span>
                    {item.rightPath ?? "右侧不存在"}
                    <span>{d.rightLines} 行</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => (
                  <tr
                    key={i}
                    data-row={i}
                    className={`${r.status} ${changes[cursor] === i ? "focused-row" : ""}`}
                  >
                    <td className="line-number">{r.leftLine ?? ""}</td>
                    <td
                      className={`code-cell ${r.left === null ? "missing" : ""}`}
                    >
                      <span className="line-marker">
                        {r.status === "removed" || r.status === "changed"
                          ? "−"
                          : " "}
                      </span>
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
                    <td className="line-number">{r.rightLine ?? ""}</td>
                    <td
                      className={`code-cell ${r.right === null ? "missing" : ""}`}
                    >
                      <span className="line-marker">
                        {r.status === "added" || r.status === "changed"
                          ? "+"
                          : " "}
                      </span>
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
          ) : d?.kind === "excel" ? (
            <table className="excel-diff">
              <thead>
                <tr>
                  <th>工作表 / 位置</th>
                  <th>状态</th>
                  <th>左侧值</th>
                  <th>右侧值</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => (
                  <tr
                    key={i}
                    data-row={i}
                    className={`${r.status} ${changes[cursor] === i ? "focused-row" : ""}`}
                  >
                    <td>
                      <b>{r.sheet}</b>
                      <small>
                        {r.column}
                        {r.leftRow ?? "—"} → {r.column}
                        {r.rightRow ?? "—"}
                        {r.key && <span>主键 {r.key}</span>}
                      </small>
                    </td>
                    <td>
                      <span className={`status-pill ${r.status}`}>
                        {LABELS[r.status]}
                      </span>
                    </td>
                    <td>{r.left}</td>
                    <td>{r.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : d?.kind === "directory" ? (
            <div className="detail-empty">
              <Folder size={34} />
              <h3>空文件夹比较</h3>
              <p>{d.note}</p>
            </div>
          ) : d?.kind === "binary" ? (
            <div className="binary-detail">
              <div className="binary-icon">
                <File size={34} />
              </div>
              <h3>
                {item.status === "equal"
                  ? "文件内容完全一致"
                  : "二进制内容比较"}
              </h3>
              <p>{d.note}</p>
              <div className="hash-cards">
                {["left", "right"].map((side, i) => (
                  <div key={side}>
                    <label>
                      <span className={`side-tag ${side}`}>
                        {i ? "B" : "A"}
                      </span>
                      {i ? "右侧" : "左侧"}
                      <span>{bytes(item[`${side}Size`])}</span>
                    </label>
                    <small>SHA-256</small>
                    <code>{d[`${side}Hash`] ?? "文件不存在"}</code>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {!item.error &&
            ["text", "excel"].includes(d?.kind) &&
            !rows.length && (
              <div className="detail-empty">
                <CheckCheck size={32} />
                <h3>
                  {d?.equal ? "按当前规则，内容一致" : "此视图没有单元格差异"}
                </h3>
                <p>
                  {d?.kind === "excel"
                    ? "可在上方查看新增、移除的工作表。样式、图表和宏不参与比较。"
                    : diffOnly
                      ? "当前没有需要显示的不同内容。"
                      : "两侧均为空文本或内容已被规则忽略。"}
                </p>
              </div>
            )}
          {rows.length > limit && (
            <button
              className="load-more"
              onClick={() => setLimit((v) => v + 500)}
            >
              继续加载 500 行（已显示 {Math.min(limit, rows.length)} /{" "}
              {rows.length}）<ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="detail-footer">
        <div>
          <span className="legend removed">
            <i />
            左侧移除
          </span>
          <span className="legend added">
            <i />
            右侧新增
          </span>
          <span className="legend changed">
            <i />
            内容修改
          </span>
        </div>
        <span>
          {d?.kind === "excel"
            ? `${d.keyed ? "主键行匹配" : "按单元格位置"} · ${d.totalChanges} 个单元格差异 · 不比较样式`
            : d?.kind === "text"
              ? `${d.counts.changed + d.counts.added + d.counts.removed} 行差异 · 统一换行符`
              : d?.kind === "directory"
                ? "空目录 · 路径匹配"
                : "SHA-256 · 原始字节比较"}
        </span>
      </div>
    </>
  );
}

function RulesPanel({ initial, onClose, onApply }) {
  const [draft, setDraft] = useState(structuredClone(initial)),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const panel = useRef(null);
  const update = (name, value) => setDraft((d) => ({ ...d, [name]: value }));
  const cleanedDraft = () => ({
    ...draft,
    ignoreLines: draft.ignoreLines.filter((s) => s.trim()),
    exclude: draft.exclude.filter((s) => s.trim()),
  });
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("button")?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const focusable = [
        ...panel.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]',
        ),
      ];
      if (e.shiftKey && document.activeElement === focusable[0]) {
        e.preventDefault();
        focusable.at(-1)?.focus();
      }
      if (!e.shiftKey && document.activeElement === focusable.at(-1)) {
        e.preventDefault();
        focusable[0]?.focus();
      }
    };
    const node = panel.current;
    node.addEventListener("keydown", trap);
    return () => {
      node.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  const perform = async (task) => {
    setError("");
    setSaving(true);
    try {
      await task();
    } catch (e) {
      setError(
        e.message.replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        ref={panel}
        className="rules-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
      >
        <header className="rules-header">
          <div>
            <span className="eyebrow">YOUR COMPARISON, YOUR RULES</span>
            <h2 id="rules-title">
              <Settings2 size={21} />
              比较规则
            </h2>
            <p>减少噪声，只关注真正重要的变化。</p>
          </div>
          <IconButton
            icon={X}
            title="关闭规则"
            disabled={saving}
            onClick={onClose}
          />
        </header>
        <div className="rules-body">
          <section className="rule-section">
            <h3>
              <FileText size={16} />
              文本匹配
            </h3>
            <div className="two-fields">
              <label className="form-field">
                空白字符
                <select
                  value={draft.whitespace}
                  onChange={(e) => update("whitespace", e.target.value)}
                >
                  <option value="none">保留全部空白</option>
                  <option value="trim">忽略行首 / 行尾空白</option>
                  <option value="all">忽略所有空白</option>
                </select>
              </label>
              <label className="form-field">
                文本编码
                <select
                  value={draft.encoding}
                  onChange={(e) => update("encoding", e.target.value)}
                >
                  <option value="auto">自动（UTF-8 / BOM）</option>
                  <option value="utf8">UTF-8</option>
                  <option value="gb18030">GB18030 / GBK</option>
                  <option value="utf16le">UTF-16 LE</option>
                </select>
              </label>
            </div>
            <label className="toggle-row">
              <span>
                <b>忽略大小写</b>
                <small>例如 Hello 与 hello 视为一致</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={draft.ignoreCase}
                onChange={(e) => update("ignoreCase", e.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <b>忽略空白行</b>
                <small>不比较空行及仅包含空白的行</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={draft.ignoreBlankLines}
                onChange={(e) => update("ignoreBlankLines", e.target.checked)}
              />
            </label>
            <label className="form-field">
              忽略匹配的整行
              <small>每行一个正则表达式，不带 / 分隔符；在原始行上匹配。</small>
              <textarea
                className="rule-code"
                placeholder={"^\\s*//\n^# Generated at:"}
                value={draft.ignoreLines.join("\n")}
                onChange={(e) =>
                  update("ignoreLines", e.target.value.split("\n"))
                }
              />
            </label>
            <ReplacementEditor
              title="内容替换规则"
              description="比较前在两侧执行；例如把时间戳替换为空，报告保留原文。"
              value={draft.replacements}
              onChange={(value) => update("replacements", value)}
            />
          </section>
          <section className="rule-section">
            <h3>
              <Folder size={16} />
              文件夹与归档
            </h3>
            <label className="toggle-row">
              <span>
                <b>路径不区分大小写</b>
                <small>匹配 Readme.txt 与 README.txt；重名冲突会报错</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={draft.pathIgnoreCase}
                onChange={(e) => update("pathIgnoreCase", e.target.checked)}
              />
            </label>
            <label className="form-field">
              排除路径
              <small>
                每行一个 Glob；支持 **、*、?。目录及其子项一并排除。
              </small>
              <textarea
                className="rule-code"
                value={draft.exclude.join("\n")}
                onChange={(e) => update("exclude", e.target.value.split("\n"))}
                placeholder={"**/.git/**\n**/node_modules/**\n**/*.log"}
              />
            </label>
            <ReplacementEditor
              title="路径匹配规则"
              description="对相对路径做正则替换后再配对，例如忽略文件名中的版本号。"
              value={draft.pathReplacements}
              onChange={(value) => update("pathReplacements", value)}
            />
          </section>
          <section className="rule-section">
            <h3>
              <FileSpreadsheet size={16} />
              Excel 工作簿
            </h3>
            <label className="form-field">
              主键列（可选）
              <small>
                留空按行列位置比较。填写 A 或 A,B 后，第 1
                行视为表头，其余行按主键匹配，不受行顺序影响。空主键或重复主键会报错。
              </small>
              <input
                value={draft.excelKeyColumns}
                onChange={(e) => update("excelKeyColumns", e.target.value)}
                placeholder="例如 A 或 A,B"
              />
            </label>
            <label className="toggle-row">
              <span>
                <b>比较公式表达式</b>
                <small>关闭后比较文件中缓存的计算值；不会重新计算公式</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={draft.excelFormulas}
                onChange={(e) => update("excelFormulas", e.target.checked)}
              />
            </label>
            <div className="rule-help">
              <Info size={15} />
              <p>
                支持 .xls / .xlsx / .xlsm 的单元格内容和跨格式比较。
                样式、图表、宏及合并布局不参与比较。归档支持
                ZIP、WAR、JAR，暂不支持 RAR、7z 或加密文件。
              </p>
            </div>
          </section>
          <div className="rules-transfer">
            <button
              className="button secondary"
              disabled={saving || !api}
              onClick={() =>
                perform(async () => {
                  const value = await api.importRules();
                  if (value) setDraft(value);
                })
              }
            >
              <Upload size={14} />
              导入 JSON
            </button>
            <button
              className="button secondary"
              disabled={saving || !api}
              onClick={() => perform(() => api.exportRules(cleanedDraft()))}
            >
              <Download size={14} />
              导出 JSON
            </button>
            <button
              className="text-button"
              disabled={saving}
              onClick={() => setDraft(structuredClone(DEFAULT_RULES))}
            >
              <RotateCcw size={14} />
              恢复默认
            </button>
          </div>
          {error && (
            <div role="alert" className="notice error-notice">
              <CircleAlert size={16} />
              {error}
            </div>
          )}
        </div>
        <footer className="rules-footer">
          <span>保存至本机 · 下次启动自动恢复</span>
          <div>
            <button
              className="button secondary"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={() => perform(() => onApply(cleanedDraft()))}
            >
              {saving ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              保存规则
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ReplacementEditor({ title, description, value, onChange }) {
  return (
    <div className="replacement-editor">
      <div className="replacement-heading">
        <b>{title}</b>
        <button
          className="text-button"
          disabled={value.length >= 20}
          onClick={() => onChange([...value, { pattern: "", replacement: "" }])}
        >
          <Plus size={13} />
          添加
        </button>
      </div>
      <small>{description}</small>
      {value.map((r, index) => (
        <div className="replacement-row" key={index}>
          <input
            aria-label={`${title}正则 ${index + 1}`}
            placeholder="正则表达式，如 v\d+"
            value={r.pattern}
            onChange={(e) =>
              onChange(
                value.map((r, i) =>
                  i === index ? { ...r, pattern: e.target.value } : r,
                ),
              )
            }
          />
          <ArrowRight size={13} />
          <input
            aria-label={`${title}替换值 ${index + 1}`}
            placeholder="替换为（可留空）"
            value={r.replacement}
            onChange={(e) =>
              onChange(
                value.map((r, i) =>
                  i === index ? { ...r, replacement: e.target.value } : r,
                ),
              )
            }
          />
          <IconButton
            icon={X}
            title="删除替换规则"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </div>
      ))}
    </div>
  );
}
