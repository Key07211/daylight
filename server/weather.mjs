import { HttpError } from './validation.mjs';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const SEARCH_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const LOCATION_URL = 'https://ipwho.is/';
const FRESH_MS = 15 * 60_000;
const STALE_MS = 6 * 60 * 60_000;
const LOCATION_MS = 30 * 60_000;
const CURRENT = 'temperature_2m,weather_code,cloud_cover,precipitation,rain,showers,is_day';

function parameters(input, allowed) {
  const entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input || {});
  const result = {};
  for (const [key, value] of entries) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new HttpError(400, 'Invalid weather query parameters.');
    result[key] = value;
  }
  return result;
}

function coordinate(value, max, label) {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) {
    throw new HttpError(400, `${label} must be a decimal number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > max) throw new HttpError(400, `${label} is outside its valid range.`);
  return Object.is(number, -0) ? 0 : number;
}

function timezone(value, allowAuto = false) {
  if (value === 'auto' && allowAuto) return value;
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) throw new HttpError(400, 'A valid time zone is required.');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); }
  catch { throw new HttpError(400, 'A valid time zone is required.'); }
  return value;
}

function providerNumber(value, min = -Infinity, max = Infinity, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid provider number.');
  return value;
}

function epochISO(value, nullable = false) {
  if (nullable && (value === null || value === 0)) return null;
  providerNumber(value, 1, 8_640_000_000_000);
  return new Date(value * 1000).toISOString();
}

function providerText(value, required = false) {
  if (!required && value === undefined) return '';
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new Error('Invalid provider text.');
  return value;
}

function parseWeather(body, requested, fetchedAt) {
  if (!body || body.error || !body.current || !body.daily) throw new Error('Incomplete forecast.');
  const zone = timezone(body.timezone);
  const current = body.current;
  const daily = body.daily;
  if (!Array.isArray(daily.time) || daily.time.length !== 3 || !Array.isArray(daily.sunrise) || !Array.isArray(daily.sunset)
      || daily.sunrise.length !== 3 || daily.sunset.length !== 3) throw new Error('Incomplete solar forecast.');
  const dayFormatter = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = daily.time.map((stamp, index) => {
    const iso = epochISO(stamp);
    // The provider's UNIX timestamps are UTC instants. Use the IANA zone for each
    // daily stamp instead of applying today's offset to days across a DST change.
    const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, sunrise: epochISO(daily.sunrise[index], true), sunset: epochISO(daily.sunset[index], true) };
  });
  const weatherCode = providerNumber(current.weather_code, 0, 99);
  if (!Number.isInteger(weatherCode) || ![0, 1].includes(current.is_day)) throw new Error('Invalid weather condition.');
  const offset = providerNumber(body.utc_offset_seconds, -50_400, 50_400);
  if (!Number.isInteger(offset)) throw new Error('Invalid time zone offset.');
  return {
    latitude: requested.latitude, longitude: requested.longitude, timezone: zone, utcOffsetSeconds: offset,
    observedAt: epochISO(current.time), temperature: providerNumber(current.temperature_2m, -150, 100, true),
    weatherCode, cloudCover: providerNumber(current.cloud_cover, 0, 100, true),
    precipitation: providerNumber(current.precipitation, 0, Infinity, true), rain: providerNumber(current.rain, 0, Infinity, true),
    showers: providerNumber(current.showers, 0, Infinity, true), isDay: current.is_day === 1,
    days, fetchedAt, stale: false, source: 'Open-Meteo',
  };
}

function parseLocations(body) {
  if (!body || body.error || (body.results !== undefined && !Array.isArray(body.results))) throw new Error('Invalid location results.');
  return (body.results || []).slice(0, 8).map(item => {
    if (!Number.isSafeInteger(item.id) || item.id < 0) throw new Error('Invalid location identifier.');
    return { id: item.id, name: providerText(item.name, true), region: providerText(item.admin1), country: providerText(item.country),
      latitude: providerNumber(item.latitude, -90, 90), longitude: providerNumber(item.longitude, -180, 180), timezone: timezone(item.timezone) };
  });
}

function parseLocation(body) {
  if (!body || body.success !== true) throw new Error('Location lookup failed.');
  // Explicit selection prevents forwarding IP addresses or network metadata.
  return { id: 'auto', name: providerText(body.city, true), region: providerText(body.region), country: providerText(body.country),
    latitude: providerNumber(body.latitude, -90, 90), longitude: providerNumber(body.longitude, -180, 180),
    timezone: timezone(body.timezone?.id), source: 'network' };
}

export function createWeatherService({ fetch: fetcher = globalThis.fetch, now = () => new Date(), timeoutMs = 8000, cacheLimit = 64 } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const clock = () => new Date(now()).getTime();
  const limit = Math.max(1, Math.min(128, Math.trunc(cacheLimit) || 64));

  async function request(url) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
          if (!response.ok) throw new Error('Provider unavailable.');
          return response.json();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Weather request timed out.')); }, timeoutMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function cached(key, ttl, loader, allowStale = false) {
    const stamp = clock();
    const existing = cache.get(key);
    if (existing && stamp - existing.savedAt >= 0 && stamp - existing.savedAt < ttl) {
      cache.delete(key); cache.set(key, existing);
      return structuredClone(existing.value);
    }
    if (inflight.has(key)) return structuredClone(await inflight.get(key));
    if (inflight.size >= 16) throw new HttpError(503, 'Weather service is busy. Please try again shortly.');
    const pending = (async () => {
      try {
        const value = await loader();
        cache.delete(key); cache.set(key, { value, savedAt: clock() });
        while (cache.size > limit) cache.delete(cache.keys().next().value);
        return value;
      } catch {
        const age = existing ? clock() - existing.savedAt : Infinity;
        if (allowStale && age >= 0 && age <= STALE_MS) return { ...existing.value, stale: true };
        cache.delete(key);
        throw new HttpError(503, 'Weather service is unavailable. Please try again later.');
      } finally { inflight.delete(key); }
    })();
    inflight.set(key, pending);
    return structuredClone(await pending);
  }

  return {
    async getWeather(input) {
      const params = parameters(input, ['latitude', 'longitude', 'timezone']);
      const location = { latitude: coordinate(params.latitude, 90, 'Latitude'), longitude: coordinate(params.longitude, 180, 'Longitude'),
        timezone: timezone(params.timezone ?? 'auto', true) };
      const url = new URL(FORECAST_URL);
      url.search = new URLSearchParams({ ...location, current: CURRENT, daily: 'sunrise,sunset', forecast_days: '3',
        timeformat: 'unixtime', temperature_unit: 'celsius', precipitation_unit: 'mm' }).toString();
      return cached(url.href, FRESH_MS, async () => parseWeather(await request(url.href), location, new Date(clock()).toISOString()), true);
    },
    async searchLocations(input) {
      const params = parameters(input, ['q', 'language']);
      if (typeof params.q !== 'string' || params.q.trim().length < 2 || params.q.length > 100 || /[\u0000-\u001f\u007f]/.test(params.q)) throw new HttpError(400, 'City search must contain 2 to 100 characters.');
      const language = params.language ?? 'en';
      if (!['zh', 'en'].includes(language)) throw new HttpError(400, 'Location language must be zh or en.');
      const url = new URL(SEARCH_URL);
      url.search = new URLSearchParams({ name: params.q.trim(), language, count: '8', format: 'json' }).toString();
      return cached(url.href, FRESH_MS, async () => parseLocations(await request(url.href)));
    },
    async getLocation(input) {
      parameters(input, []);
      const url = new URL(LOCATION_URL);
      url.search = new URLSearchParams({ fields: 'success,message,city,region,country,latitude,longitude,timezone.id' }).toString();
      return cached(url.href, LOCATION_MS, async () => parseLocation(await request(url.href)));
    },
  };
}
