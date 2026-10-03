import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWeatherService } from '../server/weather.mjs';
import { createApp } from '../server/app.mjs';

const epoch = value => new Date(value).getTime() / 1000;
const city = { latitude: '37.8715', longitude: '-122.273', timezone: 'America/Los_Angeles' };
const baseTime = '2026-10-02T17:00:00.000Z';
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
function forecast() {
  return {
    latitude: 37.875, longitude: -122.25, timezone: 'America/Los_Angeles', utc_offset_seconds: -25200,
    current: { time: epoch(baseTime), interval: 900, temperature_2m: 21.4, is_day: 1, precipitation: 0.2, rain: 0.1, showers: 0.1, weather_code: 80, cloud_cover: 67 },
    daily: {
      time: [2, 3, 4].map(day => epoch(`2026-10-0${day}T07:00:00Z`)),
      sunrise: [2, 3, 4].map(day => epoch(`2026-10-0${day}T14:06:00Z`)),
      sunset: [2, 3, 4].map(day => epoch(`2026-10-0${day + 1}T01:48:00Z`)),
    },
  };
}
function fixture(options = {}) {
  const state = { now: new Date(baseTime), calls: [], body: forecast(), fail: false };
  const service = createWeatherService({ now: () => state.now, fetch: async (url, config) => {
    state.calls.push({ url: new URL(url), config });
    if (state.fail) throw new Error('offline');
    return response(state.body);
  }, ...options });
  return { state, service };
}

test('forecast adapter requests fixed provider parameters and preserves UTC solar instants', async () => {
  const { state, service } = fixture();
  assert.equal(state.calls.length, 0, 'constructing service makes no network request');
  const value = await service.getWeather(city);
  assert.deepEqual(value, {
    latitude: 37.8715, longitude: -122.273, timezone: 'America/Los_Angeles', utcOffsetSeconds: -25200,
    observedAt: baseTime, temperature: 21.4, weatherCode: 80, cloudCover: 67, precipitation: 0.2, rain: 0.1, showers: 0.1, isDay: true,
    days: [2, 3, 4].map(day => ({ date: `2026-10-0${day}`, sunrise: `2026-10-0${day}T14:06:00.000Z`, sunset: `2026-10-0${day + 1}T01:48:00.000Z` })),
    fetchedAt: baseTime, stale: false, source: 'Open-Meteo',
  });
  const { url, config } = state.calls[0];
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('forecast_days'), '3');
  assert.equal(url.searchParams.get('daily'), 'sunrise,sunset');
  assert.equal(url.searchParams.get('current'), 'temperature_2m,weather_code,cloud_cover,precipitation,rain,showers,is_day');
  assert.equal(config.redirect, 'error');
});

test('daily dates cross DST in the city time zone and polar solar values stay null', async () => {
  const { state, service } = fixture();
  state.body.daily.time = ['2026-10-31T07:00:00Z', '2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'].map(epoch);
  state.body.daily.sunrise = ['2026-10-31T14:33:00Z', '2026-11-01T14:34:00Z', '2026-11-02T14:35:00Z'].map(epoch);
  state.body.daily.sunset = [null, 0, epoch('2026-11-03T01:07:00Z')];
  state.body.current.temperature_2m = null;
  state.body.current.is_day = 0;
  const value = await service.getWeather(city);
  assert.deepEqual(value.days.map(day => day.date), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(value.days.map(day => day.sunset), [null, null, '2026-11-03T01:07:00.000Z']);
  assert.equal(value.days[1].sunrise, '2026-11-01T14:34:00.000Z');
  assert.equal(value.temperature, null);
  assert.equal(value.isDay, false);
});

test('forecast requests deduplicate, cache for fifteen minutes and cannot be mutated by a caller', async () => {
  let calls = 0, finish;
  let now = new Date(baseTime);
  const service = createWeatherService({ now: () => now, fetch: async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { finish = resolve; });
    return response(forecast());
  } });
  const first = service.getWeather(city), second = service.getWeather(city);
  assert.equal(calls, 1);
  finish();
  const [a, b] = await Promise.all([first, second]);
  a.days[0].sunrise = null;
  assert.notEqual(b.days[0].sunrise, null);
  now = new Date(new Date(baseTime).getTime() + 14 * 60_000);
  assert.notEqual((await service.getWeather(city)).days[0].sunrise, null);
  assert.equal(calls, 1);
  now = new Date(new Date(baseTime).getTime() + 15 * 60_000);
  assert.equal((await service.getWeather(city)).fetchedAt, now.toISOString());
  assert.equal(calls, 2);
});

test('offline fallback is explicitly stale, does not renew its age, and expires after six hours', async () => {
  const { state, service } = fixture();
  await service.getWeather(city);
  state.fail = true;
  state.now = new Date(new Date(baseTime).getTime() + 16 * 60_000);
  const fallback = await service.getWeather(city);
  assert.equal(fallback.stale, true);
  assert.equal(fallback.fetchedAt, baseTime);
  state.now = new Date(new Date(baseTime).getTime() + 6 * 60 * 60_000 + 1);
  await assert.rejects(service.getWeather(city), { status: 503 });
  await assert.rejects(service.getWeather({ ...city, latitude: 12 }), { status: 503 });
});

test('malformed provider data and non-2xx responses fail instead of inventing weather', async () => {
  for (const body of [{ error: true, reason: 'bad query' }, {}, { ...forecast(), current: { time: epoch(baseTime) } },
    { ...forecast(), daily: { time: [1], sunrise: [null], sunset: [null] } }, { ...forecast(), timezone: 'Fake/Zone' }]) {
    const service = createWeatherService({ fetch: async () => response(body) });
    await assert.rejects(service.getWeather(city), { status: 503 });
  }
  const service = createWeatherService({ fetch: async () => response({}, 429) });
  await assert.rejects(service.getWeather(city), { status: 503 });
});

test('weather input rejects ambiguous coordinates, unsupported zones, duplicate keys and arbitrary URLs before fetch', async () => {
  const { state, service } = fixture();
  for (const input of [{}, { ...city, latitude: '' }, { ...city, latitude: ' ' }, { ...city, latitude: '0x20' },
    { ...city, latitude: 'NaN' }, { ...city, latitude: Infinity }, { ...city, latitude: 91 }, { ...city, longitude: '-181' },
    { ...city, latitude: '1,2' }, { ...city, timezone: 'Fake/Zone' }, { ...city, timezone: 'https://example.com' },
    { ...city, url: 'http://127.0.0.1/private' }, new URLSearchParams('latitude=1&latitude=2&longitude=3')]) {
    await assert.rejects(service.getWeather(input), { status: 400 });
  }
  assert.equal(state.calls.length, 0);
  await service.getWeather({ latitude: '-90', longitude: '180' });
  assert.equal(state.calls[0].url.searchParams.get('timezone'), 'auto');
});

test('cache remains bounded and evicts least recently used locations', async () => {
  const { state, service } = fixture({ cacheLimit: 2 });
  await service.getWeather({ ...city, latitude: 1 });
  await service.getWeather({ ...city, latitude: 2 });
  await service.getWeather({ ...city, latitude: 1 });
  await service.getWeather({ ...city, latitude: 3 });
  await service.getWeather({ ...city, latitude: 2 });
  assert.equal(state.calls.length, 4);
});

test('weather timeout aborts the request and releases its inflight slot', async () => {
  let signal, calls = 0;
  const service = createWeatherService({ timeoutMs: 15, fetch: async (_, config) => {
    signal = config.signal; calls++;
    return new Promise(() => {});
  } });
  await assert.rejects(service.getWeather(city), { status: 503 });
  assert.equal(signal.aborted, true);
  await assert.rejects(service.getWeather(city), { status: 503 });
  assert.equal(calls, 2);
});

test('city search maps only the documented fields, caches translations independently and handles no matches', async () => {
  const { state, service } = fixture();
  state.body = { results: [{ id: 2950159, name: 'Berlin', latitude: 52.52437, longitude: 13.41053, timezone: 'Europe/Berlin', admin1: 'Berlin', country: 'Germany', population: 3426354 }] };
  const found = await service.searchLocations({ q: 'Berlin, Germany', language: 'en' });
  assert.deepEqual(found, [{ id: 2950159, name: 'Berlin', region: 'Berlin', country: 'Germany', latitude: 52.52437, longitude: 13.41053, timezone: 'Europe/Berlin' }]);
  assert.equal(state.calls[0].url.origin + state.calls[0].url.pathname, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.equal(state.calls[0].url.searchParams.get('name'), 'Berlin, Germany');
  await service.searchLocations({ q: 'Berlin, Germany', language: 'en' });
  await service.searchLocations({ q: 'Berlin, Germany', language: 'zh' });
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[1].url.searchParams.get('language'), 'zh');
  state.body = { generationtime_ms: 0.1 };
  assert.deepEqual(await service.searchLocations({ q: 'NoSuchCity' }), []);
  for (const input of [{ q: 'a' }, { q: 'x'.repeat(101) }, { q: 'ab\n' }, { q: 'city', language: 'xx' }]) {
    await assert.rejects(service.searchLocations(input), { status: 400 });
  }
  assert.equal(state.calls.length, 3);
});

test('network city lookup requests only selected fields and never returns IP or network identity', async () => {
  const { state, service } = fixture();
  state.body = { success: true, city: 'San Jose', region: 'California', country: 'United States', latitude: 37.3361663, longitude: -121.8905913,
    timezone: { id: 'America/Los_Angeles', offset: -25200 }, ip: '192.0.2.1', connection: { org: 'ignored' } };
  assert.deepEqual(await service.getLocation(), { id: 'auto', name: 'San Jose', region: 'California', country: 'United States', latitude: 37.3361663,
    longitude: -121.8905913, timezone: 'America/Los_Angeles', source: 'network' });
  assert.equal(state.calls[0].url.origin + state.calls[0].url.pathname, 'https://ipwho.is/');
  assert.equal(state.calls[0].url.searchParams.get('fields'), 'success,message,city,region,country,latitude,longitude,timezone.id');
  state.now = new Date(new Date(baseTime).getTime() + 29 * 60_000);
  await service.getLocation();
  assert.equal(state.calls.length, 1);
  state.now = new Date(new Date(baseTime).getTime() + 30 * 60_000);
  state.body = { success: false, message: 'Reserved range' };
  await assert.rejects(service.getLocation(), { status: 503 });
  await assert.rejects(service.getLocation({ ip: '192.0.2.2' }), { status: 400 });
  assert.equal(state.calls.length, 2);
});

test('local weather routes are lazy and retain local-origin protection', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'daylight-weather-test-'));
  let calls = 0;
  const app = await createApp({ dataDir: directory, startScheduler: false, codexInfo: { available: false }, now: () => new Date(baseTime),
    weatherFetch: async url => { calls++; return response(url.startsWith('https://geocoding') ? { results: [] } : url.startsWith('https://ipwho')
      ? { success: false } : forecast()); } });
  t.after(async () => {
    await app.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('daylight-weather-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = await app.listen(0);
  await fetch(base + '/api/bootstrap');
  assert.equal(calls, 0);
  const route = '/api/weather?' + new URLSearchParams(city);
  assert.equal((await fetch(base + route, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(base + route, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/api/weather?latitude=oops&longitude=10')).status, 400);
  const forecastResponse = await fetch(base + route);
  assert.equal(forecastResponse.status, 200);
  assert.equal((await forecastResponse.json()).source, 'Open-Meteo');
  assert.deepEqual(await (await fetch(base + '/api/weather/locations?q=city&language=zh')).json(), []);
  assert.equal((await fetch(base + '/api/weather/location')).status, 503);
  assert.equal(calls, 3);
  assert.equal(app.store.data.tasks.length, 0);
});
