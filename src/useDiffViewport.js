import { useEffect, useState } from "react";

export default function useDiffViewport(
  ref,
  { selector, attribute, positionAt, leftTotal, rightTotal, version },
) {
  const [viewport, setViewport] = useState();
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      setViewport(undefined);
      return;
    }
    let frame;
    const update = () => {
      frame = null;
      const nodes = element.querySelectorAll(selector);
      if (!nodes.length) {
        setViewport(undefined);
        return;
      }
      const bounds = element.getBoundingClientRect();
      const search = (edge) => {
        let low = 0,
          high = nodes.length;
        while (low < high) {
          const mid = (low + high) >> 1,
            rect = nodes[mid].getBoundingClientRect();
          if (
            edge === "first"
              ? rect.bottom <= bounds.top
              : rect.top < bounds.bottom
          )
            low = mid + 1;
          else high = mid;
        }
        return Math.min(
          nodes.length - 1,
          Math.max(0, edge === "first" ? low : low - 1),
        );
      };
      const first = positionAt(
          Number(nodes[search("first")].getAttribute(attribute)),
        ),
        last = positionAt(
          Number(nodes[search("last")].getAttribute(attribute)),
        );
      if (!first || !last) return;
      setViewport({
        left: {
          start: first.leftStart / Math.max(1, leftTotal),
          end: last.leftEnd / Math.max(1, leftTotal),
        },
        right: {
          start: first.rightStart / Math.max(1, rightTotal),
          end: last.rightEnd / Math.max(1, rightTotal),
        },
      });
    };
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", schedule);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [ref, selector, attribute, positionAt, leftTotal, rightTotal, version]);
  return viewport;
}
