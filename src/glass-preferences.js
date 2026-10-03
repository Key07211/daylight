import { useCallback, useLayoutEffect, useState } from 'react';

const STORAGE_KEY = 'daylight-glass';
export const DEFAULT_GLASS = Object.freeze({ transparency: 58, blur: 12, glow: 55, motion: true });
export function normalizeGlass(value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const number = (key, minimum, maximum) => typeof settings[key] === 'number' && Number.isFinite(settings[key])
    ? Math.min(maximum, Math.max(minimum, Math.round(settings[key]))) : DEFAULT_GLASS[key];
  return { transparency: number('transparency', 0, 100), blur: number('blur', 0, 24),
    glow: number('glow', 0, 100), motion: typeof settings.motion === 'boolean' ? settings.motion : true };
}
export function useGlassPreferences() {
  const [settings, update] = useState(() => {
    try { return normalizeGlass(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch { return { ...DEFAULT_GLASS }; }
  });
  const setSettings = useCallback(patch => update(previous => normalizeGlass({
    ...previous, ...(typeof patch === 'function' ? patch(previous) : patch),
  })), []);
  const resetSettings = useCallback(() => update({ ...DEFAULT_GLASS }), []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--glass-opacity', String(.78 - settings.transparency * .0062));
    root.style.setProperty('--glass-blur', `${settings.blur}px`);
    root.style.setProperty('--glass-glow', String(settings.glow / 100));
    root.dataset.glassMotion = settings.motion ? 'on' : 'off';
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);
  return { settings, setSettings, resetSettings };
}
