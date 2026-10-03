import { useLayoutEffect, useRef } from 'react';
import { useRainMotion } from './GlassRain.jsx';

// View navigation is independent of task polling and preserves mounted inputs.
export function usePanelMotion(ref, view, enabled = true) {
  const previous = useRef(view);
  const active = useRef(null);
  const { running } = useRainMotion(enabled);
  useLayoutEffect(() => {
    const changed = previous.current !== view;
    previous.current = view;
    active.current?.cancel();
    active.current = null;
    const node = ref.current;
    if (!node) return;
    delete node.dataset.panelMotion;
    if (!changed || !running || typeof node.animate !== 'function') return;
    const animation = node.animate([
      { opacity: .6, translate: '0 5px' },
      { opacity: 1, translate: '0 0' },
    ], { duration: 220, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    animation.id = 'daylight-panel-enter';
    active.current = animation;
    node.dataset.panelMotion = 'entering';
    const release = () => {
      if (active.current !== animation) return;
      active.current = null;
      delete node.dataset.panelMotion;
      animation.cancel();
    };
    animation.finished.then(release, release);
    return () => {
      animation.cancel();
      if (active.current === animation) {
        active.current = null;
        delete node.dataset.panelMotion;
      }
    };
  }, [ref, view, running]);
}
