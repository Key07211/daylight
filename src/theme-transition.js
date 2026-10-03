import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import './theme-transition.css';

const normalizeTheme = value => value === 'night' ? 'night' : 'day';
function motionPolicy() {
  return {
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    reduced: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

/** Display the old theme until its snapshot is taken, then commit the whole new theme together. */
export function useThemeTransition(targetTheme, enabled = true) {
  const nextTheme = normalizeTheme(targetTheme);
  const [displayTheme, setDisplayTheme] = useState(nextTheme);
  const [policy, setPolicy] = useState(motionPolicy);
  const displayed = useRef(nextTheme);
  const desired = useRef(nextTheme);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const active = useRef(null);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const update = () => {
      const next = motionPolicy();
      setPolicy(previous => previous.hidden === next.hidden && previous.reduced === next.reduced ? previous : next);
    };
    document.addEventListener('visibilitychange', update);
    if (media?.addEventListener) media.addEventListener('change', update);
    else media?.addListener?.(update);
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      if (media?.removeEventListener) media.removeEventListener('change', update);
      else media?.removeListener?.(update);
    };
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    desired.current = nextTheme;
    const currentGeneration = ++generation.current;
    const root = typeof document === 'undefined' ? null : document.documentElement;

    const clearSession = session => {
      if (!session) return;
      clearTimeout(session.watchdog);
      if (active.current === session) {
        active.current = null;
        if (root?.dataset.themeTransition === 'running') delete root.dataset.themeTransition;
      }
    };
    const cancelSession = session => {
      if (!session) return;
      session.cancelled = true;
      try { session.transition?.skipTransition(); } catch { /* Already finished. */ }
      clearSession(session);
    };
    cancelSession(active.current);

    const isCurrent = () => mounted.current && generation.current === currentGeneration;
    const commit = (theme, synchronous = false) => {
      if (!isCurrent()) return;
      displayed.current = theme;
      if (synchronous) flushSync(() => setDisplayTheme(theme));
      else setDisplayTheme(theme);
    };
    const cleanup = () => {
      if (generation.current === currentGeneration) generation.current += 1;
      if (active.current?.generation === currentGeneration) cancelSession(active.current);
      mounted.current = false;
    };
    const mayAnimate = () => {
      const live = motionPolicy();
      return enabled && !live.hidden && !live.reduced
        && root?.dataset.glassMotion !== 'off'
        && typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
    };

    // Initial render must match the actual scheduled/manual theme without a flash.
    if (!initialized.current) {
      initialized.current = true;
      commit(nextTheme);
      return cleanup;
    }
    if (displayed.current === nextTheme) return cleanup;
    if (!mayAnimate()) {
      commit(nextTheme);
      return cleanup;
    }

    const session = { generation: currentGeneration, transition: null, cancelled: false, watchdog: null };
    active.current = session;
    // This also disables older palette transitions before either snapshot is captured.
    root.dataset.themeTransition = 'running';
    try {
      session.transition = document.startViewTransition(() => {
        // skipTransition does not cancel an already queued update callback.
        if (!isCurrent() || session.cancelled || active.current !== session) return;
        if (!mayAnimate()) {
          try { session.transition?.skipTransition(); } catch { /* Commit the current target below. */ }
        }
        commit(desired.current, true);
      });
      if (!isCurrent() || session.cancelled) session.transition.skipTransition();
      // A skipped transition rejects ready even though its update may still complete.
      Promise.resolve(session.transition.ready).catch(() => {});
      Promise.resolve(session.transition.updateCallbackDone).catch(() => {
        if (isCurrent() && active.current === session) commit(desired.current, true);
      });
      Promise.resolve(session.transition.finished).catch(() => {}).finally(() => {
        if (isCurrent() && active.current === session) {
          if (displayed.current !== desired.current) commit(desired.current, true);
          clearSession(session);
        }
      });
      // A browser/capture failure must never leave the UI or its marker pending indefinitely.
      session.watchdog = setTimeout(() => {
        if (!isCurrent() || active.current !== session) return;
        commit(desired.current, true);
        cancelSession(session);
      }, 1800);
    } catch {
      commit(nextTheme);
      clearSession(session);
    }
    return cleanup;
  }, [nextTheme, enabled, policy.hidden, policy.reduced]);

  return displayTheme;
}

export default useThemeTransition;
