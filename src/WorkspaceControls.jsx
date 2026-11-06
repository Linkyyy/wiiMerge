import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ToolButton({ icon: Icon, label, shortcut, active, ...props }) {
  return (
    <button
      type="button"
      className={`workspace-tool ${active ? "is-active" : ""}`}
      aria-label={label}
      title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
      aria-pressed={active === undefined ? undefined : active}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}
export function ToolbarSlot({ host, children }) {
  return host ? createPortal(children, host) : null;
}
export function PopupMenu({ anchor, label = "操作菜单", items, onClose }) {
  const ref = useRef(null),
    [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const bounds = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        6,
        Math.min(anchor.x, window.innerWidth - bounds.width - 6),
      ),
      top: Math.max(
        6,
        Math.min(anchor.y, window.innerHeight - bounds.height - 6),
      ),
    });
    ref.current.querySelector("button:not(:disabled)")?.focus();
  }, [anchor.x, anchor.y]);
  useEffect(() => {
    const previous = anchor.focus || document.activeElement;
    const outside = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (
        ["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(e.key)
      ) {
        if (e.key === "Tab") {
          onClose();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const buttons = [
            ...ref.current.querySelectorAll("button:not(:disabled)"),
          ],
          index = buttons.indexOf(document.activeElement);
        buttons[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  return createPortal(
    <div
      className="workspace-popup"
      style={position}
      ref={ref}
      role="menu"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div className="menu-separator" role="separator" key={index} />
        ) : (
          <button
            key={item.id || item.label}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-label={item.label}
            aria-checked={item.checked}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.action?.();
            }}
          >
            {item.icon ? (
              <item.icon size={15} />
            ) : (
              <span className="menu-check" aria-hidden="true">
                {item.checked ? "✓" : ""}
              </span>
            )}
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
export function ActionMenu({ icon, label, items, active }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <ToolButton
        icon={icon}
        label={label}
        active={active}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(
            anchor
              ? null
              : { x: rect.left, y: rect.bottom + 4, focus: e.currentTarget },
          );
        }}
      />
      {anchor && (
        <PopupMenu
          anchor={anchor}
          label={label}
          items={items}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
