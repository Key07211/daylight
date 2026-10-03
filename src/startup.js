import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const HOLD_MS = 3400;
const EXIT_MS = 440;
const DEADLINE_MS = 4000;

function motionAllowed(enabled) {
  return enabled && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !window.matchMedia('(forced-colors: active)').matches;
}

// Native launches get a process-scoped claim; browser previews use the tab session.
// Neither a renderer reload nor reopening the tray window should replay the intro.
async function claimLaunch() {
  if (window.daylightDesktop?.claimStartup) return window.daylightDesktop.claimStartup();
  try {
    const played = sessionStorage.getItem('daylight-startup-played');
    sessionStorage.setItem('daylight-startup-played', '1');
    return !played;
  } catch { return true; }
}

export function useStartup({ ready, settled = true, error, enabled, theme, atmosphere }) {
  const [phase, setPhase] = useState('pending');
  const [sceneTheme, setSceneTheme] = useState(theme);
  const [sceneAtmosphere, setSceneAtmosphere] = useState(atmosphere);
  const latestAtmosphere = useRef(atmosphere);
  latestAtmosphere.current = atmosphere;
  const [allowed, setAllowed] = useState(() => motionAllowed(enabled));
  const [claimed, setClaimed] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [cycle, setCycle] = useState(0);
  const phaseRef = useRef(phase);
  const previousFocus = useRef(null);
  const claim = useRef(null);
  const pendingDeadline = useRef(null);
  phaseRef.current = phase;
  const finish = useCallback(() => setPhase('done'), []);
  const dismiss = useCallback(() => {
    setPhase(current => current === 'done' || current === 'pending' ? 'done' : motionAllowed(enabled) && !document.hidden ? 'exit' : 'done');
  }, [enabled]);
  const replay = useCallback(() => {
    previousFocus.current = document.activeElement;
    setSceneTheme(theme);
    setSceneAtmosphere(latestAtmosphere.current);
    pendingDeadline.current = null;
    setClaimed(true);
    setCycle(value => value + 1);
    setPhase(motionAllowed(enabled) ? 'pending' : 'done');
  }, [enabled, theme]);

  useEffect(() => {
    let disposed = false;
    claim.current ||= claimLaunch();
    claim.current.then(play => {
      if (disposed) return;
      if (!play) finish();
      else setClaimed(true);
    }).catch(finish);
    return () => { disposed = true; };
  }, [finish]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const forced = window.matchMedia('(forced-colors: active)');
    const update = () => {
      const next = motionAllowed(enabled);
      setAllowed(next);
      if (!next) finish();
    };
    update();
    reduced.addEventListener('change', update);
    forced.addEventListener('change', update);
    return () => {
      reduced.removeEventListener('change', update);
      forced.removeEventListener('change', update);
    };
  }, [enabled, finish]);

  useEffect(() => {
    const update = () => {
      setVisible(!document.hidden);
      if (document.hidden && ['enter', 'hold', 'exit'].includes(phaseRef.current)) finish();
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [finish]);

  useEffect(() => {
    if (error) finish();
  }, [error, finish]);

  useEffect(() => {
    if (phase !== 'pending' || !claimed || !visible || !ready || !settled || !allowed) return;
    setSceneTheme(theme);
    setSceneAtmosphere(latestAtmosphere.current);
    previousFocus.current ||= document.activeElement;
    setPhase('enter');
  }, [phase, claimed, visible, ready, settled, allowed, theme]);

  useEffect(() => {
    if (phase !== 'enter') return;
    const timer = setTimeout(() => setPhase('hold'), 520);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'hold') return;
    const timer = setTimeout(dismiss, HOLD_MS - 520);
    return () => clearTimeout(timer);
  }, [phase, dismiss]);
  useEffect(() => {
    if (phase !== 'exit') return;
    const timer = setTimeout(finish, EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase, finish]);
  // Bound weather loading without cutting an animation off halfway through.
  useEffect(() => {
    if (!visible || phase !== 'pending') { pendingDeadline.current = null; return; }
    pendingDeadline.current ??= performance.now() + DEADLINE_MS;
    const timer = setTimeout(() => {
      if (ready && claimed && allowed) { setSceneTheme(theme); setSceneAtmosphere(latestAtmosphere.current); setPhase('enter'); }
      else finish();
    }, Math.max(0, pendingDeadline.current - performance.now()));
    return () => clearTimeout(timer);
  }, [visible, cycle, phase, ready, claimed, allowed, theme, finish]);

  const active = phase !== 'done' && allowed;
  useLayoutEffect(() => {
    if (!active) {
      const previous = previousFocus.current;
      if (previous?.isConnected && previous !== document.body && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      else if (previous) document.querySelector('button.theme-toggle')?.focus({ preventScroll: true });
      previousFocus.current = null;
      return;
    }
    document.querySelector('.startup-scene button')?.focus({ preventScroll: true });
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        document.querySelector('.startup-scene button')?.focus({ preventScroll: true });
      }
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, dismiss]);

  return { active, phase, motion: allowed && phase !== 'pending', theme: sceneTheme, atmosphere: sceneAtmosphere, dismiss, replay, cycle };
}
