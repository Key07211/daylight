import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAtmosphere } from '../src/weather-model.js';
import { getWeatherJson, loadWeatherState, normalizeWeatherPreferences, persistWeatherPreferences,
  weatherLocationKey, weatherStartupPhase, WEATHER_PREVIEW_SESSION } from '../src/weather-state.js';

const now = Date.parse('2026-10-03T04:00:00Z');
const location = { name: 'San Francisco', region: 'California', country: 'United States',
  latitude: 37.77, longitude: -122.42, timezone: 'America/Los_Angeles' };
const weather = { ...location, source: 'Open-Meteo', weatherCode: 63, cloudCover: 94, rain: 1,
  fetchedAt: new Date(now - 60000).toISOString(), timezone: location.timezone, days: [], isDay: false };
function memory(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key),
    value: key => JSON.parse(data.get(key) ?? 'null') };
}
const stored = extra => memory({ 'daylight-weather': { mode: 'live', locationMode: 'manual', location },
  'daylight-weather-cache': { key: weatherLocationKey(location), data: weather }, ...extra });

test('legacy persistent preview starts live without altering manual city or theme override', () => {
  const override = { theme: 'day', periodKey: 'America/Los_Angeles|2026-10-02|19' };
  const storage = stored({ 'daylight-weather': { mode: 'preview', locationMode: 'manual', location,
    preview: { condition: 'rain', minutes: 720 } }, 'daylight-theme-override': override });
  const initial = loadWeatherState({ storage, session: memory(), now });
  assert.equal(initial.preferences.mode, 'live');
  assert.deepEqual(initial.location, location);
  assert.deepEqual(initial.preferences.preview, { condition: 'rain', minutes: 720 });
  persistWeatherPreferences(initial.preferences, { storage, session: memory() });
  assert.equal(storage.value('daylight-weather').mode, 'live');
  assert.deepEqual(storage.value('daylight-theme-override'), override);
});

test('preview survives reload in the same session but a new window starts live', () => {
  const storage = stored();
  const session = memory();
  const preferences = normalizeWeatherPreferences({ mode: 'preview', locationMode: 'manual', location,
    preview: { condition: 'storm', minutes: 810 } }, { allowPreview: true });
  persistWeatherPreferences(preferences, { storage, session });
  assert.equal(storage.value('daylight-weather').mode, 'live');
  assert.equal(loadWeatherState({ storage, session, now }).preferences.mode, 'preview');
  const cold = loadWeatherState({ storage, session: memory(), now });
  assert.equal(cold.preferences.mode, 'live');
  assert.deepEqual(cold.location, location);
  persistWeatherPreferences({ ...preferences, mode: 'live' }, { storage, session });
  assert.equal(session.getItem(WEATHER_PREVIEW_SESSION), null);
});

test('malformed session preview cannot reactivate persistent demo mode', () => {
  for (const preview of [{ mode: 'preview' }, { mode: 'preview', preview: { condition: 'rain', minutes: '720' } },
    { mode: 'preview', preview: { condition: 'invalid', minutes: 720 } }]) {
    const initial = loadWeatherState({ storage: stored({ 'daylight-weather': { mode: 'preview' } }),
      session: memory({ [WEATHER_PREVIEW_SESSION]: preview }), now });
    assert.equal(initial.preferences.mode, 'live');
  }
});

test('first render uses genuine matching cached weather and the actual city clock', () => {
  const initial = loadWeatherState({ storage: stored(), now });
  assert.equal(initial.weather.stale, true);
  const atmosphere = deriveAtmosphere({ now, weather: initial.weather, location: initial.location });
  assert.equal(atmosphere.timeLabel, '21:00');
  assert.equal(atmosphere.condition, 'rain');
  assert.ok(atmosphere.rainIntensity > 0);
  const offline = deriveAtmosphere({ now, location: initial.location });
  assert.equal(offline.condition, 'unknown');
  assert.equal(offline.rainIntensity, 0);
  assert.equal(offline.timeLabel, '21:00');
});

test('cache validation rejects wrong city, source, future time and weather older than six hours', () => {
  for (const cache of [
    { key: 'different-city', data: weather },
    { key: weatherLocationKey(location), data: { ...weather, latitude: 10 } },
    { key: weatherLocationKey(location), data: { ...weather, source: 'preview' } },
    { key: weatherLocationKey(location), data: { ...weather, fetchedAt: new Date(now - 6 * 3600000 - 1).toISOString() } },
    { key: weatherLocationKey(location), data: { ...weather, fetchedAt: new Date(now + 1).toISOString() } },
  ]) {
    assert.equal(loadWeatherState({ storage: stored({ 'daylight-weather-cache': cache }), now }).weather, null);
  }
});

test('automatic city cache expires at24hours while manual cities stay selected', () => {
  for (const [age, expected] of [[0, true], [24 * 3600000 - 1, true], [24 * 3600000, false], [-1, false]]) {
    const storage = stored({ 'daylight-weather': { locationMode: 'auto' }, 'daylight-weather-location': { at: now - age, location } });
    assert.equal(Boolean(loadWeatherState({ storage, now }).location), expected);
  }
  assert.deepEqual(loadWeatherState({ storage: stored(), now: now + 30 * 24 * 3600000 }).location, location);
});

test('invalid manual city falls back to detection and malformed timezone requests use auto', () => {
  const initial = loadWeatherState({ storage: stored({ 'daylight-weather': { locationMode: 'manual', location: { name: 'broken' } },
    'daylight-weather-location': { at: now, location } }), now });
  assert.equal(initial.preferences.locationMode, 'auto');
  assert.deepEqual(initial.location, location);
  assert.equal(normalizeWeatherPreferences({ locationMode: 'manual', location: { ...location, timezone: 'Not/AZone' } }).location.timezone, 'auto');
  assert.doesNotThrow(() => loadWeatherState({ storage: { getItem() { throw new Error('blocked'); } }, now }));
  assert.doesNotThrow(() => persistWeatherPreferences(initial.preferences, { storage: { setItem() { throw new Error('blocked'); } } }));
});

test('startup waits for current city forecast and resolves on bounded failure instead of waiting forever', () => {
  const preferences = { mode: 'live', locationMode: 'auto' };
  const weatherState = { key: weatherLocationKey(location), settled: true, status: 'cached' };
  assert.equal(weatherStartupPhase({ preferences, locationStatus: 'loading', location, weatherState }), 'location');
  assert.equal(weatherStartupPhase({ preferences, locationStatus: 'ready', location, weatherState }), 'resolved');
  assert.equal(weatherStartupPhase({ preferences, locationStatus: 'ready', location: { ...location, latitude: 35 }, weatherState }), 'weather');
  assert.equal(weatherStartupPhase({ preferences, locationStatus: 'unavailable', location: null, weatherState }), 'resolved');
  assert.equal(weatherStartupPhase({ preferences, locationStatus: 'unavailable', location,
    weatherState: { ...weatherState, status: 'unavailable' } }), 'resolved');
  assert.equal(weatherStartupPhase({ preferences: { mode: 'preview' }, locationStatus: 'loading', location: null, weatherState }), 'resolved');
});

test('forecast timeout aborts hanging fetch or body and rejects without network access', async () => {
  for (const hangBody of [false, true]) {
    let requestSignal;
    const start = Date.now();
    await assert.rejects(getWeatherJson('/fixture', { timeoutMs: 20, fetch: async (_path, { signal }) => {
      requestSignal = signal;
      return hangBody ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    } }), /cancelled/);
    assert.equal(requestSignal.aborted, true);
    assert.ok(Date.now() - start < 2000);
  }
});

test('abort before request prevents a fetch and completed requests parse or reject HTTP errors', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getWeatherJson('/fixture', { signal: controller.signal,
    fetch: () => assert.fail('Already cancelled requests must not fetch') }), /cancelled/);
  assert.deepEqual(await getWeatherJson('/fixture', { fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }) }), { ok: true });
  await assert.rejects(getWeatherJson('/fixture', { fetch: async () => ({ ok: false }) }), /unavailable/);
});
