import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { nearestDifference } from "../core/navigation.mjs";

const colors = { added: "#49a97e", removed: "#db6868", changed: "#d79a31" };
function MapCanvas({
  navigation,
  current = -1,
  onJump,
  viewport,
  expanded = false,
  onExpand,
}) {
  const host = useRef(null),
    canvas = useRef(null);
  const [size, setSize] = useState({ width: 140, height: 190 });
  const { ranges, mapTotal: total } = navigation;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current,
      ratio = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    const ctx = element.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#e8edf5";
    ctx.fillRect(0, 0, size.width, size.height);
    const marker = (range) => {
      const top = Math.max(
        0,
        Math.min(size.height - 3, (range.mapStart / total) * size.height),
      );
      return {
        top,
        height: Math.min(
          size.height - top,
          Math.max(3, ((range.mapEnd - range.mapStart) / total) * size.height),
        ),
      };
    };
    for (const range of ranges) {
      const { top, height } = marker(range);
      ctx.fillStyle = colors[range.status] || colors.changed;
      ctx.fillRect(2, top, size.width - 4, height);
    }
    if (ranges[current]) {
      const { top, height } = marker(ranges[current]);
      ctx.strokeStyle = "#385ed0";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, top, size.width - 2, Math.max(4, height));
    }
    const view = viewport?.map;
    if (view) {
      const top = Math.max(0, Math.min(1, view.start)) * size.height,
        height = Math.min(
          size.height - top,
          Math.max(7, (view.end - view.start) * size.height),
        );
      ctx.fillStyle = "#3f64c51a";
      ctx.fillRect(0, top, size.width, height);
      ctx.strokeStyle = "#6b82bb";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, top + 0.5, size.width - 1, height - 1);
    }
  }, [navigation, current, size, viewport]);
  const pointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      fraction = (event.clientY - rect.top) / rect.height;
    const index = nearestDifference(ranges, "map", fraction, total);
    if (index >= 0) onJump(index);
  };
  return (
    <div
      className="diff-map"
      role="group"
      aria-label="可视化差分导航"
      data-difference-count={ranges.length}
      onDoubleClick={onExpand}
    >
      <div className="map-labels">
        <span>
          {navigation.mapLabel} · {total}
        </span>
        <span>{ranges.length} 处差分</span>
      </div>
      <div className="map-surface" ref={host}>
        <canvas ref={canvas} aria-hidden="true" />
        <div
          className="map-track map-unified"
          role="slider"
          tabIndex={0}
          aria-label="差异位置"
          aria-orientation="vertical"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={Math.min(total, (ranges[current]?.mapStart || 0) + 1)}
          aria-valuetext={ranges[current]?.label || "没有差异"}
          title="点击或拖动定位差分；双击放大全屏"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              pointer(event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onKeyDown={(event) => {
            let index;
            if (event.key === "ArrowDown")
              index = Math.min(ranges.length - 1, current + 1);
            else if (event.key === "ArrowUp") index = Math.max(0, current - 1);
            else if (event.key === "Home") index = 0;
            else if (event.key === "End") index = ranges.length - 1;
            else return;
            event.preventDefault();
            if (index >= 0) onJump(index);
          }}
        />
      </div>
      <div className="map-legend">
        <span className="removed">仅左侧</span>
        <span className="added">仅右侧</span>
        <span className="changed">修改</span>
      </div>
      {!expanded && (
        <button
          className="map-expand"
          onClick={onExpand}
          aria-label="放大差分导航"
          title="放大全屏（也可双击导航栏）"
        >
          <Maximize2 size={13} />
        </button>
      )}
    </div>
  );
}

export default function DiffMap(props) {
  const [expanded, setExpanded] = useState(false),
    host = useRef(null),
    dialog = useRef(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement;
    dialog.current?.querySelector("button")?.focus();
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
      }
      if (event.key === "Tab") {
        const targets = [
          ...dialog.current.querySelectorAll('button, [tabindex="0"]'),
        ];
        const index = targets.indexOf(document.activeElement);
        event.preventDefault();
        targets[
          (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length
        ]?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
      else host.current?.querySelector('[role="slider"]')?.focus();
    };
  }, [expanded]);
  return (
    <>
      <div
        className="diff-map-host"
        ref={host}
        inert={expanded}
        aria-hidden={expanded || undefined}
      >
        <MapCanvas {...props} onExpand={() => setExpanded(true)} />
      </div>
      {expanded &&
        createPortal(
          <div
            className="map-fullscreen"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="全屏差分导航"
          >
            <header>
              <div>
                <b>差分位置一览</b>
                <span>双击导航栏或按 Esc 返回</span>
              </div>
              <button
                className="icon-button"
                aria-label="退出全屏导航"
                onClick={() => setExpanded(false)}
              >
                <X size={19} />
              </button>
            </header>
            <MapCanvas
              {...props}
              expanded
              onExpand={() => setExpanded(false)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
