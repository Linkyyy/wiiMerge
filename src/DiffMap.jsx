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
  const { ranges, leftTotal, rightTotal } = navigation;
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
    const gap = 8,
      width = (size.width - gap) / 2;
    ["left", "right"].forEach((side, track) => {
      const x = track * (width + gap),
        total = side === "left" ? leftTotal : rightTotal;
      ctx.fillStyle = "#e8edf5";
      ctx.fillRect(x, 0, width, size.height);
      for (const r of ranges) {
        const top = Math.max(
          0,
          Math.min(size.height - 2, (r[side + "Start"] / total) * size.height),
        );
        const height = Math.max(
          3,
          ((r[side + "End"] - r[side + "Start"]) / total) * size.height,
        );
        ctx.fillStyle = colors[r.status] || colors.changed;
        ctx.fillRect(
          x + 2,
          top,
          width - 4,
          Math.min(height, size.height - top),
        );
      }
      if (ranges[current]) {
        const top = Math.max(
          0,
          Math.min(
            size.height - 4,
            (ranges[current][side + "Start"] / total) * size.height,
          ),
        );
        ctx.strokeStyle = "#385ed0";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          x + 1,
          top,
          width - 2,
          Math.max(
            4,
            ((ranges[current][side + "End"] - ranges[current][side + "Start"]) /
              total) *
              size.height,
          ),
        );
      }
      const view = viewport?.[side];
      if (view) {
        const top = Math.max(0, Math.min(1, view.start)) * size.height,
          height = Math.max(7, (view.end - view.start) * size.height);
        ctx.fillStyle = "#3f64c51a";
        ctx.fillRect(x, top, width, Math.min(height, size.height - top));
        ctx.strokeStyle = "#6b82bb";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          x + 0.5,
          top + 0.5,
          width - 1,
          Math.min(height, size.height - top) - 1,
        );
      }
    });
  }, [navigation, current, size, viewport]);
  const pointer = (event, side) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      fraction = (event.clientY - rect.top) / rect.height;
    const index = nearestDifference(
      ranges,
      side,
      fraction,
      side === "left" ? leftTotal : rightTotal,
    );
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
        <span>左侧 · {leftTotal} 行</span>
        <span>右侧 · {rightTotal} 行</span>
      </div>
      <div className="map-surface" ref={host}>
        <canvas ref={canvas} aria-hidden="true" />
        {["left", "right"].map((side) => (
          <div
            key={side}
            className={`map-track map-${side}`}
            role="slider"
            tabIndex={0}
            aria-label={side === "left" ? "左侧差异位置" : "右侧差异位置"}
            aria-orientation="vertical"
            aria-valuemin={1}
            aria-valuemax={side === "left" ? leftTotal : rightTotal}
            aria-valuenow={Math.min(
              side === "left" ? leftTotal : rightTotal,
              (ranges[current]?.[side + "Start"] || 0) + 1,
            )}
            aria-valuetext={ranges[current]?.label || "没有差异"}
            title="点击或拖动定位差分；双击放大全屏"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pointer(event, side);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                pointer(event, side);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              let index;
              if (event.key === "ArrowDown")
                index = Math.min(ranges.length - 1, current + 1);
              else if (event.key === "ArrowUp")
                index = Math.max(0, current - 1);
              else if (event.key === "Home") index = 0;
              else if (event.key === "End") index = ranges.length - 1;
              else return;
              event.preventDefault();
              if (index >= 0) onJump(index);
            }}
          />
        ))}
      </div>
      <div className="map-legend">
        <span className="removed">删除</span>
        <span className="added">新增</span>
        <span className="changed">修改</span>
      </div>
      {!expanded && (
        <button
          className="map-expand"
          onClick={onExpand}
          title="放大全屏（也可双击导航栏）"
        >
          <Maximize2 size={12} /> 放大导航
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
