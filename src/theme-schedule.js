import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const OVERRIDE_KEY = 'daylight-theme-override';
const THEME_KEY = 'daylight-theme';
const validTheme = value => value === 'day' || value === 'night';

function resolveTimezone(value) {
  for (const zone of [value, Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC']) {
    if (typeof zone !== 'string') continue;
    try { return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone; }
    catch { /* Saved cities can contain an obsolete or invalid zone. */ }
  }
  return 'UTC';
}

function periodAt(stamp, formatter, timezone) {
  const parts = Object.fromEntries(formatter.formatToParts(stamp).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  const theme = hour >= 19 || hour < 7 ? 'night' : 'day';
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - (hour < 7 ? 1 : 0))).toISOString().slice(0, 10);
  return { theme, key: `${timezone}|${date}|${theme === 'day' ? '07' : '19'}` };
}

function nextPeriodBoundary(stamp, formatter, timezone, currentKey) {
  // Search actual instants instead of adding twelve hours. A DST transition can
  // make a local 19:00–07:00 period eleven or thirteen hours long.
  let before = stamp, after = stamp;
  for (let count = 0; count < 96; count++) {
    after += 30 * 60_000;
    if (periodAt(after, formatter, timezone).key !== currentKey) break;
    before = after;
  }
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (periodAt(middle, formatter, timezone).key === currentKey) before = middle;
    else after = middle;
  }
  return after;
}

export function resolveScheduledTheme({ now = Date.now(), timezone, override = null } = {}) {
  const input = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  const stamp = Number.isFinite(input) && Math.abs(input) < 8_639_999_800_000_000 ? input : 0;
  const zone = resolveTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const period = periodAt(stamp, formatter, zone);
  const overridden = validTheme(override?.theme) && override.periodKey === period.key;
  const nextBoundaryAt = nextPeriodBoundary(stamp, formatter, zone, period.key);
  return {
    theme: overridden ? override.theme : period.theme,
    scheduledTheme: period.theme, periodKey: period.key, timezone: zone, overridden,
    nextBoundaryAt, nextBoundary: new Date(nextBoundaryAt).toISOString(),
  };
}

function readOverride() {
  try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* Migrate the old persistent temporary choice. */ }
  try {
    const value = JSON.parse(sessionStorage.getItem(OVERRIDE_KEY));
    return validTheme(value?.theme) && typeof value.periodKey === 'string' && value.periodKey.length <= 200 ? value : null;
  } catch { return null; }
}

export function useScheduledTheme({ timezone } = {}) {
  const [now, setNow] = useState(Date.now);
  const [override, setOverride] = useState(readOverride);
  // Clicks in one React batch must resolve against the latest selection, not the last render.
  const overrideRef = useRef(override);
  const resolved = useMemo(() => resolveScheduledTheme({ now, timezone, override }), [now, timezone, override]);
  const tick = useCallback(() => setNow(Date.now()), []);

  useEffect(() => {
    const interval = setInterval(tick, 25000);
    const resume = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [tick]);
  useEffect(() => {
    const timer = setTimeout(tick, Math.max(1, Math.min(2_147_483_647, resolved.nextBoundaryAt - Date.now() + 10)));
    return () => clearTimeout(timer);
  }, [resolved.nextBoundaryAt, tick]);
  useLayoutEffect(() => {
    try { localStorage.setItem(THEME_KEY, resolved.theme); } catch { /* Continue without persistent storage. */ }
    if (override && override.periodKey !== resolved.periodKey && overrideRef.current === override) {
      overrideRef.current = null;
      setOverride(current => current === override ? null : current);
      try { sessionStorage.removeItem(OVERRIDE_KEY); } catch {}
    }
  }, [resolved.theme, resolved.periodKey, override]);

  const setTheme = useCallback(next => {
    const actualNow = Date.now();
    const current = resolveScheduledTheme({ now: actualNow, timezone, override: overrideRef.current });
    const theme = typeof next === 'function' ? next(current.theme) : next;
    if (!validTheme(theme)) return;
    const selected = { theme, periodKey: current.periodKey };
    overrideRef.current = selected;
    setOverride(selected);
    setNow(actualNow);
    try {
      sessionStorage.setItem(OVERRIDE_KEY, JSON.stringify(selected));
      localStorage.setItem(THEME_KEY, theme);
    } catch { /* Manual switching still works when storage is unavailable. */ }
  }, [timezone]);

  return { ...resolved, setTheme };
}
