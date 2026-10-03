import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolveScheduledTheme } from '../src/theme-schedule.js';
import { loadWeatherState, weatherLocationKey } from '../src/weather-state.js';
import { deriveAtmosphere } from '../src/weather-model.js';

const timezone = 'America/Los_Angeles';
const resolve = (now, extra = {}) => resolveScheduledTheme({ now, timezone, ...extra });
const selected = (now, theme) => ({ theme, periodKey: resolve(now).periodKey });

test('real local clock changes to night at19:00 and day at07:00, including after midnight', () => {
  assert.equal(resolve('2026-10-02T18:59:59-07:00').theme, 'day');
  assert.equal(resolve('2026-10-02T19:00:00-07:00').theme, 'night');
  assert.equal(resolve('2026-10-03T00:30:00-07:00').theme, 'night');
  assert.equal(resolve('2026-10-03T06:59:59-07:00').theme, 'night');
  assert.equal(resolve('2026-10-03T07:00:00-07:00').theme, 'day');
  assert.equal(resolve('2026-10-02T19:00:00-07:00').periodKey, resolve('2026-10-03T00:30:00-07:00').periodKey);
  assert.equal(resolve('2026-10-02T18:59:59-07:00').nextBoundary, '2026-10-03T02:00:00.000Z');
  assert.equal(resolve('2026-10-02T19:00:00-07:00').nextBoundary, '2026-10-03T14:00:00.000Z');
});

test('manual choice is honored only in the current07/19period, never carried into the next date', () => {
  const beforeNight = selected('2026-10-02T18:59:00-07:00', 'day');
  assert.equal(resolve('2026-10-02T18:59:30-07:00', { override: beforeNight }).overridden, true);
  assert.equal(resolve('2026-10-02T19:00:00-07:00', { override: beforeNight }).theme, 'night');
  const afterNight = selected('2026-10-02T20:00:00-07:00', 'day');
  assert.equal(resolve('2026-10-03T00:30:00-07:00', { override: afterNight }).theme, 'day');
  assert.equal(resolve('2026-10-03T07:00:00-07:00', { override: afterNight }).overridden, false);
  assert.equal(resolve('2026-10-03T20:00:00-07:00', { override: afterNight }).theme, 'night');
  const manualNight = selected('2026-10-02T11:00:00-07:00', 'night');
  assert.equal(resolve('2026-10-02T11:05:00-07:00', { override: manualNight }).theme, 'night');
  assert.equal(resolve('2026-10-03T08:00:00-07:00', { override: manualNight }).theme, 'day');
});

test('a legacy saved palette and weather preview minutes cannot override the real schedule', () => {
  const result = resolve('2026-10-02T21:00:00-07:00', { savedTheme: 'day', preview: { minutes: 720 }, weather: { isDay: true } });
  assert.equal(result.theme, 'night');
  assert.equal(result.overridden, false);
  assert.equal(resolve('2026-10-02T12:00:00-07:00', { savedTheme: 'night' }).theme, 'day');
  assert.equal(resolve('2026-10-02T12:00:00-07:00', { override: { theme: 'invalid', periodKey: result.periodKey } }).theme, 'day');
});

test('daylight savings changes next-boundary instants without moving the local07:00switch', () => {
  const spring = resolve('2026-03-07T19:00:00-08:00');
  assert.equal(spring.nextBoundary, '2026-03-08T14:00:00.000Z');
  assert.equal((spring.nextBoundaryAt - Date.parse('2026-03-07T19:00:00-08:00')) / 3600000, 11);
  const fall = resolve('2026-10-31T19:00:00-07:00');
  assert.equal(fall.nextBoundary, '2026-11-01T15:00:00.000Z');
  assert.equal((fall.nextBoundaryAt - Date.parse('2026-10-31T19:00:00-07:00')) / 3600000, 13);
  assert.equal(resolve('2026-11-01T15:00:00Z').theme, 'day');
});

test('city timezone is canonical and invalidzones fall back safely', () => {
  const city = resolveScheduledTheme({ now: '2026-10-02T10:00:00Z', timezone: 'Asia/Tokyo' });
  assert.equal(city.theme, 'night');
  assert.equal(city.nextBoundary, '2026-10-02T22:00:00.000Z');
  const alias = resolve('2026-10-02T20:00:00-07:00', { timezone: 'US/Pacific' });
  assert.equal(alias.periodKey, resolve('2026-10-02T20:00:00-07:00').periodKey);
  const fallback = resolve('2026-10-02T20:00:00Z', { timezone: 'Not/AZone' });
  assert.ok(Number.isFinite(fallback.nextBoundaryAt));
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: fallback.timezone }).format(0));
});

test('changing cities reevaluates actualtime and expires an override from another time zone', () => {
  const now = '2026-10-02T10:00:00Z';
  const override = selected(now, 'day');
  assert.equal(resolve(now, { override }).overridden, true);
  const changed = resolveScheduledTheme({ now, timezone: 'Asia/Tokyo', override });
  assert.equal(changed.theme, 'night');
  assert.equal(changed.overridden, false);
  assert.equal(changed.nextBoundary, '2026-10-02T22:00:00.000Z');
});

test('invalid clock inputs return a deterministic safe schedule', () => {
  for (const now of [new Date('invalid'), NaN, Infinity, 'not a date', null]) {
    const actual = resolveScheduledTheme({ now, timezone: 'UTC' });
    const expected = resolveScheduledTheme({ now: 0, timezone: 'UTC' });
    assert.deepEqual(actual, expected);
  }
});

const bootSource = fs.readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
function boot(now, values = {}, sessionValues = {}) {
  const seed = values => new Map([...(values instanceof Map ? values.entries() : Object.entries(values))]
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  const data = seed(values);
  const sessionData = seed(sessionValues);
  const storage = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  const document = { documentElement: { dataset: {}, style: {} } };
  class Clock extends Date { static now() { return Date.parse(now); } }
  // The device is in Los Angeles even when this test runs on a host in UTC.
  // Explicit city zones still work, so accidentally using one remains observable.
  const deviceIntl = Object.create(Intl);
  deviceIntl.DateTimeFormat = function DateTimeFormat(locales, options) {
    return new Intl.DateTimeFormat(locales, { ...options, timeZone: options?.timeZone ?? timezone });
  };
  vm.runInNewContext(bootSource, { Date: Clock, Intl: deviceIntl, document,
    localStorage: storage(data), sessionStorage: storage(sessionData) });
  return { theme: document.documentElement.dataset.theme, scheme: document.documentElement.style.colorScheme, data, sessionData };
}
const validCity = { name: 'San Francisco', latitude: 37.77, longitude: -122.42, timezone };
const tokyo = { name: 'Tokyo', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' };
const overrideKey = 'daylight-theme-override';

test('pre-paint follows device07/19 boundaries regardless of saved palette or weather preview', () => {
  for (const now of ['2026-10-02T18:59:59-07:00', '2026-10-02T19:00:00-07:00', '2026-10-03T00:30:00-07:00', '2026-10-03T07:00:00-07:00']) {
    const value = boot(now, { 'daylight-weather': { locationMode: 'manual', location: tokyo, mode: 'preview', preview: { minutes: 720 } }, 'daylight-theme': 'day' });
    assert.equal(value.theme, resolve(now).theme);
    assert.equal(value.scheme, value.theme === 'night' ? 'dark' : 'light');
    assert.equal(value.data.get('daylight-theme'), value.theme);
  }
});

test('a fresh midnight session ignores persisted daylight and removes a still-valid legacy manual override', () => {
  const now = '2026-10-03T00:30:00-07:00';
  assert.equal(boot(now).theme, 'night');
  const value = boot(now, { 'daylight-theme': 'day', [overrideKey]: selected('2026-10-02T20:00:00-07:00', 'day') });
  assert.equal(value.theme, 'night');
  assert.equal(value.scheme, 'dark');
  assert.equal(value.data.has(overrideKey), false);
  assert.equal(value.sessionData.has(overrideKey), false);
});

test('pre-paint honors only a valid session override and expires it at device07/19 boundaries', () => {
  const evening = selected('2026-10-02T20:00:00-07:00', 'day');
  for (const now of ['2026-10-02T20:05:00-07:00', '2026-10-03T00:30:00-07:00', '2026-10-03T06:59:59-07:00']) {
    const value = boot(now, {}, { [overrideKey]: evening });
    assert.equal(value.theme, 'day');
    assert.deepEqual(JSON.parse(value.sessionData.get(overrideKey)), evening);
    assert.equal(value.data.has(overrideKey), false);
  }
  const morningBoundary = boot('2026-10-03T07:00:00-07:00', {}, { [overrideKey]: evening });
  assert.equal(morningBoundary.theme, 'day');
  assert.equal(morningBoundary.sessionData.has(overrideKey), false);
  const daytime = selected('2026-10-02T12:00:00-07:00', 'night');
  assert.equal(boot('2026-10-02T18:59:59-07:00', {}, { [overrideKey]: daytime }).theme, 'night');
  const nightBoundary = boot('2026-10-02T19:00:00-07:00', {}, { [overrideKey]: daytime });
  assert.equal(nightBoundary.theme, 'night');
  assert.equal(nightBoundary.sessionData.has(overrideKey), false);
});

test('manual session choice survives same-window reload but a new window returns to the device clock', () => {
  const now = '2026-10-02T20:00:00-07:00';
  const first = boot(now, {}, { [overrideKey]: selected(now, 'day') });
  assert.equal(first.theme, 'day');
  const reload = boot('2026-10-03T00:30:00-07:00', first.data, first.sessionData);
  assert.equal(reload.theme, 'day');
  assert.equal(reload.scheme, 'light');
  const newWindow = boot('2026-10-03T00:30:00-07:00', reload.data);
  assert.equal(newWindow.theme, 'night');
  assert.equal(newWindow.scheme, 'dark');
  assert.equal(newWindow.sessionData.has(overrideKey), false);
});

test('a session override wins over conflicting legacy storage and uses the device period key', () => {
  const now = '2026-10-03T00:30:00-07:00';
  const local = { 'daylight-weather': { locationMode: 'manual', location: tokyo }, [overrideKey]: selected(now, 'night') };
  const validSession = boot(now, local, { [overrideKey]: selected(now, 'day') });
  assert.equal(validSession.theme, 'day');
  assert.equal(validSession.data.has(overrideKey), false);
  const foreignSession = boot(now, local, { [overrideKey]: {
    theme: 'day', periodKey: resolveScheduledTheme({ now, timezone: tokyo.timezone }).periodKey,
  } });
  assert.equal(foreignSession.theme, 'night');
  assert.equal(foreignSession.sessionData.has(overrideKey), false);
});

test('pre-paint migrates legacy weather preview while retaining city and current-session manual choice', () => {
  const now = '2026-10-02T20:00:00-07:00';
  const override = selected(now, 'day');
  const value = boot(now, { 'daylight-weather': { mode: 'preview', locationMode: 'manual', location: validCity,
    preview: { condition: 'rain', minutes: 720 } }, [overrideKey]: selected(now, 'night') }, { [overrideKey]: override });
  const preferences = JSON.parse(value.data.get('daylight-weather'));
  assert.equal(preferences.mode, 'live');
  assert.deepEqual(preferences.location, validCity);
  assert.equal(value.theme, 'day');
  assert.equal(value.data.has(overrideKey), false);
  assert.deepEqual(JSON.parse(value.sessionData.get(overrideKey)), override);
});

test('midnight device theme ignores daytime city and forecast caches without altering weather data', () => {
  const now = '2026-10-03T00:30:00-07:00';
  const instant = Date.parse(now);
  for (const age of [60_000, 24 * 3600000, -1]) {
    const values = { 'daylight-weather': { locationMode: 'auto' },
      'daylight-weather-location': { at: instant - age, location: tokyo } };
    const current = boot(now, values);
    assert.equal(current.theme, 'night');
    assert.deepEqual(JSON.parse(current.data.get('daylight-weather-location')), values['daylight-weather-location']);
  }
  const selectedCity = { ...tokyo, timezone: 'auto' };
  const values = { 'daylight-weather': { locationMode: 'manual', location: selectedCity }, 'daylight-weather-cache': {
    key: weatherLocationKey(selectedCity), data: { ...selectedCity, timezone: 'Asia/Tokyo', weatherCode: 0, isDay: true, source: 'Open-Meteo', fetchedAt: now },
  } };
  const current = boot(now, values);
  const initial = loadWeatherState({ now: instant, storage: { getItem: key => current.data.get(key) ?? null } });
  const atmosphere = deriveAtmosphere({ now, weather: initial.weather, location: initial.location });
  assert.equal(atmosphere.timezone, 'Asia/Tokyo');
  assert.equal(resolveScheduledTheme({ now, timezone: atmosphere.timezone }).theme, 'day');
  assert.equal(current.theme, 'night');
  assert.deepEqual(JSON.parse(current.data.get('daylight-weather-cache')), values['daylight-weather-cache']);
});

test('device daytime remains light even when the selected weather city is after midnight', () => {
  const now = '2026-10-02T09:00:00-07:00';
  assert.equal(resolveScheduledTheme({ now, timezone: tokyo.timezone }).theme, 'night');
  const current = boot(now, { 'daylight-weather': { locationMode: 'manual', location: tokyo } });
  assert.equal(current.theme, 'day');
  assert.equal(current.scheme, 'light');
});

test('invalid local and session JSON safely falls back to the fixed device clock', () => {
  const now = '2026-10-03T00:30:00-07:00';
  const fallback = boot(now, { 'daylight-weather': 'not JSON', [overrideKey]: '{bad' }, { [overrideKey]: '{bad' });
  assert.equal(fallback.theme, 'night');
  assert.equal(fallback.scheme, 'dark');
  assert.equal(fallback.data.has(overrideKey), false);
});
