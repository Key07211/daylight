import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { deriveAtmosphere } from './weather-model.js';

const PREFS = 'daylight-weather';
const AUTO_CITY = 'daylight-weather-location';
const CACHE = 'daylight-weather-cache';
export const WEATHER_PREVIEW_SESSION = 'daylight-weather-preview-session';
const CONDITIONS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];
const CITY_TTL = 24 * 3600000;
const WEATHER_TTL = 6 * 3600000;
function browserStorage(name) { try { return window[name]; } catch { return null; } }
function read(storage, key) { try { return JSON.parse(storage?.getItem(key) ?? 'null'); } catch { return null; } }
function save(storage, key, value) { try { storage?.setItem(key, JSON.stringify(value)); } catch {} }
function remove(storage, key) { try { storage?.removeItem(key); } catch {} }
function city(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)
    || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return null;
  let timezone = 'auto';
  if (typeof value.timezone === 'string') {
    try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(0); timezone = value.timezone; } catch {}
  }
  return { name: value.name.trim().slice(0, 120), region: String(value.region || '').slice(0, 120), country: String(value.country || '').slice(0, 120),
    latitude: value.latitude, longitude: value.longitude, timezone };
}

export function normalizeWeatherPreferences(value, { allowPreview = false } = {}) {
  const location = city(value?.location);
  return { mode: allowPreview && value?.mode === 'preview' ? 'preview' : 'live',
    locationMode: value?.locationMode === 'manual' && location ? 'manual' : 'auto', location,
    preview: { condition: CONDITIONS.includes(value?.preview?.condition) ? value.preview.condition : 'clear',
      minutes: Number.isFinite(value?.preview?.minutes) ? Math.max(0, Math.min(1439, Math.round(value.preview.minutes))) : 720 } };
}

export function weatherLocationKey(location) { return location ? `${location.latitude},${location.longitude},${location.timezone}` : ''; }
function validWeather(data, location) {
  return !!data && !!location && data.source === 'Open-Meteo' && data.latitude === location.latitude && data.longitude === location.longitude
    && Number.isFinite(data.weatherCode) && Number.isFinite(Date.parse(data.fetchedAt));
}
function cachedWeather(storage, location, now = Date.now()) {
  const cached = read(storage, CACHE);
  const age = now - Date.parse(cached?.data?.fetchedAt);
  return cached?.key === weatherLocationKey(location) && validWeather(cached.data, location)
    && Number.isFinite(age) && age >= 0 && age <= WEATHER_TTL ? { ...cached.data, stale: true } : null;
}

/** Persistent cities survive upgrades; a preview belongs only to this window's session. */
export function loadWeatherState({ storage, session, now = Date.now() } = {}) {
  const saved = read(storage, PREFS);
  const preview = read(session, WEATHER_PREVIEW_SESSION);
  const validPreview = preview?.mode === 'preview' && CONDITIONS.includes(preview.preview?.condition) && Number.isFinite(preview.preview?.minutes);
  const preferences = normalizeWeatherPreferences(validPreview ? { ...saved, mode: 'preview', preview: preview.preview } : saved,
    { allowPreview: validPreview });
  const cached = read(storage, AUTO_CITY);
  const age = now - cached?.at;
  const automaticCity = Number.isFinite(age) && age >= 0 && age < CITY_TTL ? city(cached?.location) : null;
  const location = preferences.locationMode === 'manual' ? preferences.location : automaticCity;
  return { preferences, automaticCity, location, weather: cachedWeather(storage, location, now) };
}

export function persistWeatherPreferences(preferences, { storage, session } = {}) {
  save(storage, PREFS, { ...preferences, mode: 'live' });
  if (preferences.mode === 'preview') save(session, WEATHER_PREVIEW_SESSION, { mode: 'preview', preview: preferences.preview });
  else remove(session, WEATHER_PREVIEW_SESSION);
}

/** Every request, including response-body reading, has an offline completion path. */
export async function getWeatherJson(path, { signal, fetch: fetcher = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  let timer;
  let abort;
  try {
    return await Promise.race([
      new Promise((_, reject) => {
        abort = () => { controller.abort(); reject(new Error('Weather request cancelled')); };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, timeoutMs);
      }),
      Promise.resolve().then(async () => {
        if (controller.signal.aborted) throw new Error('Weather request cancelled');
        const response = await fetcher(path, { signal: controller.signal });
        if (!response.ok) throw new Error('Weather service unavailable');
        return response.json();
      }),
    ]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}

export function weatherStartupPhase({ preferences, locationStatus, location, weatherState }) {
  if (preferences.mode === 'preview') return 'resolved';
  if (preferences.locationMode === 'auto' && locationStatus === 'loading') return 'location';
  if (!location) return 'resolved';
  return weatherState.key === weatherLocationKey(location) && weatherState.settled ? 'resolved' : 'weather';
}

export function useWeather() {
  const [initial] = useState(() => loadWeatherState({ storage: browserStorage('localStorage'), session: browserStorage('sessionStorage') }));
  const [preferences, update] = useState(initial.preferences);
  const [automaticCity, setAutomaticCity] = useState(initial.automaticCity);
  const [automaticStatus, setAutomaticStatus] = useState('loading');
  const [weatherState, setWeatherState] = useState(() => ({ key: weatherLocationKey(initial.location), data: initial.weather,
    status: initial.weather ? 'cached' : 'loading', settled: false }));
  const [initialResolved, setInitialResolved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(Date.now);
  // Re-read on each clock tick so a changed Windows timezone is picked up too.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const location = preferences.locationMode === 'manual' ? preferences.location : automaticCity;
  const locationStatus = preferences.locationMode === 'manual' ? 'ready' : automaticStatus;
  const key = weatherLocationKey(location);
  const currentWeather = weatherState.key === key && validWeather(weatherState.data, location) ? weatherState.data : null;
  const status = !location ? locationStatus === 'loading' ? 'loading' : 'unavailable'
    : weatherState.key === key ? weatherState.status : 'loading';
  const initialPhase = weatherStartupPhase({ preferences, locationStatus, location, weatherState });
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  const setPreferences = useCallback(patch => update(previous => normalizeWeatherPreferences({ ...previous, ...patch,
    preview: { ...previous.preview, ...(patch.preview || {}) } }, { allowPreview: true })), []);

  useEffect(() => { persistWeatherPreferences(preferences, { storage: browserStorage('localStorage'), session: browserStorage('sessionStorage') }); }, [preferences]);
  useEffect(() => { if (initialPhase === 'resolved') setInitialResolved(true); }, [initialPhase]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const clock = setInterval(tick, 30000);
    const refreshTimer = setInterval(refresh, 15 * 60000);
    const resume = () => { if (!document.hidden) { tick(); refresh(); } };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('focus', tick);
    return () => { clearInterval(clock); clearInterval(refreshTimer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('focus', tick); };
  }, [refresh]);

  useEffect(() => {
    if (preferences.mode !== 'live' || preferences.locationMode !== 'auto') return;
    const controller = new AbortController();
    let active = true;
    setAutomaticStatus('loading');
    getWeatherJson('/api/weather/location', { signal: controller.signal }).then(result => {
      const resolved = city(result);
      if (!resolved) throw new Error('No city');
      if (!active) return;
      setAutomaticCity(resolved); setAutomaticStatus('ready');
      save(browserStorage('localStorage'), AUTO_CITY, { location: resolved, at: Date.now() });
    }).catch(() => { if (active) setAutomaticStatus('unavailable'); });
    return () => { active = false; controller.abort(); };
  }, [preferences.mode, preferences.locationMode, refreshKey]);

  useEffect(() => {
    if (preferences.mode !== 'live') return;
    if (!location) { setWeatherState({ key, data: null, status: 'unavailable', settled: true }); return; }
    const controller = new AbortController();
    let active = true;
    const cached = cachedWeather(browserStorage('localStorage'), location);
    setWeatherState({ key, data: cached, status: cached ? 'cached' : 'loading', settled: false });
    const query = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude, timezone: location.timezone });
    getWeatherJson(`/api/weather?${query}`, { signal: controller.signal }).then(result => {
      if (!validWeather(result, location)) throw new Error('Invalid weather response');
      if (!active) return;
      setWeatherState({ key, data: result, status: result.stale ? 'cached' : 'ready', settled: true });
      save(browserStorage('localStorage'), CACHE, { key, data: result });
    }).catch(() => { if (active) setWeatherState({ key, data: cached, status: cached ? 'cached' : 'unavailable', settled: true }); });
    return () => { active = false; controller.abort(); };
  }, [key, preferences.mode, refreshKey]);

  const atmosphere = useMemo(() => deriveAtmosphere({ now, timezone, weather: currentWeather, location,
    preview: preferences.mode === 'preview' ? preferences.preview : null }), [now, timezone, currentWeather, location, preferences.mode, preferences.preview]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.weather = atmosphere.condition;
    root.dataset.skyPhase = atmosphere.phase;
    root.style.setProperty('--solar-light', atmosphere.daylight);
    root.style.setProperty('--solar-warmth', atmosphere.warmth);
  }, [atmosphere]);
  return { preferences, setPreferences, location, locationStatus, weather: currentWeather, status, refresh, atmosphere, initialResolved, initialPhase };
}
