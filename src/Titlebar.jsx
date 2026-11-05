import React from "react";
import { ArrowLeftRight, Minus, Square, X } from "lucide-react";
export default function Titlebar({ title = "wiiMerge", children }) {
  const api = window.wiiMerge;
  return (
    <header
      className="titlebar"
      onMouseDown={(e) => {
        if (e.button === 0 && !e.target.closest("button,input,select"))
          api?.windowAction?.("drag");
      }}
      onDoubleClick={(e) => {
        if (!e.target.closest("button")) api?.windowAction?.("maximize");
      }}
    >
      <div className="titlebar-brand">
        <ArrowLeftRight size={18} />
        <strong>{title}</strong>
      </div>
      <div className="titlebar-tools">{children}</div>
      <div className="window-controls">
        <button
          aria-label="最小化"
          onClick={() => api?.windowAction?.("minimize")}
        >
          <Minus size={15} />
        </button>
        <button
          aria-label="最大化或还原"
          onClick={() => api?.windowAction?.("maximize")}
        >
          <Square size={13} />
        </button>
        <button
          className="window-close"
          aria-label="关闭窗口"
          onClick={() => api?.windowAction?.("close")}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
