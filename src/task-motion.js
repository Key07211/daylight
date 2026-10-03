import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./task-motion.css";

const EASING = "cubic-bezier(.2, .75, .25, 1)";
const near = (a, b) => Math.abs(a - b) < 1;
const environmentAllowsMotion = () =>
  typeof window !== "undefined" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
  document.documentElement.dataset.glassMotion !== "off";

/**
 * Animate committed task-list layout only. IDs must describe the visible rows,
 * each identified by data-task-id. No task state or event handling is changed.
 */
export function useTaskMotion(ref, taskIds, enabled = true) {
  const signature = JSON.stringify(taskIds.map(String));
  const previous = useRef(null);
  const animations = useRef(new Map());
  const [environmentEnabled, setEnvironmentEnabled] = useState(environmentAllowsMotion);

  const cancelAnimations = () => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      const allowed = environmentAllowsMotion();
      if (!allowed) cancelAnimations();
      setEnvironmentEnabled(allowed);
    };
    const invalidateLayout = () => {
      cancelAnimations();
      // Preserve known IDs so resizing or scrolling does not re-enter old rows.
      if (previous.current) previous.current.valid = false;
    };
    const observer = new MutationObserver(updatePreference);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-glass-motion"],
    });
    media.addEventListener("change", updatePreference);
    window.addEventListener("resize", invalidateLayout, { passive: true });
    document.addEventListener("scroll", invalidateLayout, { capture: true, passive: true });
    updatePreference();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updatePreference);
      window.removeEventListener("resize", invalidateLayout);
      document.removeEventListener("scroll", invalidateLayout, true);
      cancelAnimations();
      ref.current?.removeAttribute("data-task-motion");
    };
  }, [ref]);

  useLayoutEffect(() => {
    const root = ref.current;
    cancelAnimations();
    if (!root) {
      previous.current = null;
      return;
    }

    const allowed = enabled && environmentEnabled && environmentAllowsMotion();
    root.dataset.taskMotion = allowed ? "on" : "off";
    const ids = new Set(JSON.parse(signature));
    const rootRect = root.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rows = new Map();

    // Read all geometry before starting animations; no per-frame measurements.
    for (const element of root.querySelectorAll("[data-task-id]")) {
      const id = element.dataset.taskId;
      if (!ids.has(id)) continue;
      const rect = element.getBoundingClientRect();
      rows.set(id, {
        element,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        visible: rect.bottom > 0 && rect.top < viewport.height &&
          rect.right > 0 && rect.left < viewport.width,
      });
    }

    const before = previous.current;
    previous.current = {
      rows,
      left: rootRect.left,
      top: rootRect.top,
      width: rootRect.width,
      viewport,
      valid: true,
    };
    if (!allowed || document.visibilityState === "hidden") return;

    const stableLayout = before?.valid &&
      near(before.left, rootRect.left) && near(before.top, rootRect.top) &&
      near(before.width, rootRect.width) &&
      before.viewport.width === viewport.width && before.viewport.height === viewport.height;
    let entered = 0;
    const animate = (id, element, frames, timing, kind) => {
      if (typeof element.animate !== "function") return;
      const animation = element.animate(frames, { easing: EASING, fill: "both", ...timing });
      animation.id = `daylight-task-${kind}`;
      animations.current.set(id, animation);
      const release = () => {
        if (animations.current.get(id) !== animation) return;
        animations.current.delete(id);
        animation.cancel();
      };
      animation.finished.then(release, release);
    };

    for (const [id, row] of rows) {
      if (!row.visible) continue;
      const old = before?.rows.get(id);
      if (!old) {
        animate(id, row.element, [
          { opacity: 0, translate: "0 6px" },
          { opacity: 1, translate: "0 0" },
        ], { duration: 220, delay: Math.min(entered++, 5) * 28 }, "enter");
        continue;
      }
      if (!stableLayout || !old.visible || !near(old.width, row.width) || !near(old.height, row.height)) continue;
      const dx = old.left - row.left;
      const dy = old.top - row.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Individual translate preserves the CSS hover transform on the same row.
      animate(id, row.element, [
        { translate: `${dx}px ${dy}px` },
        { translate: "0 0" },
      ], { duration: 260 }, "move");
    }
  }, [ref, signature, enabled, environmentEnabled]);
}

export default useTaskMotion;
