const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const pad = value => String(value).padStart(2, '0');
const label = minutes => `${pad(Math.floor(minutes / 60) % 24)}:${pad(Math.floor(minutes) % 60)}`;
const smoothstep = (low, high, value) => { const x = clamp((value - low) / (high - low)); return x * x * (3 - 2 * x); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const CONDITIONS = new Set(['clear', 'cloudy', 'rain', 'snow', 'fog', 'storm']);
const PREVIEW_CLOUDS = { clear: 5, cloudy: 82, rain: 92, snow: 88, fog: 96, storm: 99, unknown: 0 };
const RAIN_LEVELS = { 51: 0.15, 53: 0.25, 55: 0.4, 56: 0.2, 57: 0.4, 61: 0.3, 63: 0.55, 65: 0.85,
  66: 0.4, 67: 0.8, 80: 0.35, 81: 0.6, 82: 0.9, 95: 0.75, 96: 0.9, 97: 0.95, 99: 1 };

export function conditionFromWeatherCode(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 97, 99].includes(code)) return 'storm';
  return 'unknown';
}

function chooseTimezone(weather, location, preferred) {
  for (const candidate of [preferred, weather?.timezone, location?.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC']) {
    if (typeof candidate !== 'string') continue;
    try { return new Intl.DateTimeFormat('en', { timeZone: candidate }).resolvedOptions().timeZone; }
    catch { /* Ignore invalid saved or remote time zones. */ }
  }
  return 'UTC';
}

function clockParts(stamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(stamp).map(part => [part.type, part.value]));
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60 };
}

function solarInstant(value) {
  // Accept explicit-offset ISO values only; never interpret a wall-clock string
  // in the execution machine's zone.
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : null;
}

function phaseAt(elapsed, length) {
  const edge = Math.min(45, length / 3);
  if (elapsed < -30) return 'night';
  if (elapsed < edge) return 'dawn';
  if (elapsed >= length + 50) return 'night';
  if (elapsed > length) return 'twilight';
  if (elapsed >= length - edge) return 'sunset';
  const noon = length / 2;
  if (elapsed < noon - 60) return 'morning';
  if (elapsed < noon + 120) return 'noon';
  return 'afternoon';
}

/** Derive presentation values without changing weather, location or preview state. */
export function deriveAtmosphere({ now = Date.now(), weather = null, location = null, preview = null, timezone: preferredTimezone } = {}) {
  const parsedNow = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  const instant = finite(parsedNow) ? parsedNow : 0;
  const timezone = chooseTimezone(weather, location, preferredTimezone);
  const clock = clockParts(instant, timezone);
  const simulated = !!preview && typeof preview === 'object';
  const minutes = simulated && finite(preview.minutes) ? clamp(preview.minutes, 0, 1439) : clock.minutes;
  const condition = simulated ? (CONDITIONS.has(preview.condition) ? preview.condition : 'unknown') : conditionFromWeatherCode(weather?.weatherCode);
  const cloudCover = simulated ? PREVIEW_CLOUDS[condition] : finite(weather?.cloudCover) ? clamp(weather.cloudCover, 0, 100) : 0;
  let rainIntensity = 0;
  if (condition === 'rain' || condition === 'storm') {
    const amount = Math.max(0, (finite(weather?.rain) ? weather.rain : 0) + (finite(weather?.showers) ? weather.showers : 0));
    rainIntensity = simulated ? (condition === 'storm' ? 0.95 : 0.65) : clamp(Math.max(RAIN_LEVELS[weather?.weatherCode] || 0.3, amount / 4));
  }

  // Weather may belong to a VPN exit or a manually selected distant city.
  // Keep its clouds/rain, but never use its daylight cycle for a different clock.
  const matchingSolarZone = chooseTimezone(weather, location) === timezone;
  const day = matchingSolarZone && Array.isArray(weather?.days) ? weather.days.find(item => item?.date === clock.dateKey) : null;
  const sunrise = solarInstant(day?.sunrise), sunset = solarInstant(day?.sunset);
  const validSolar = sunrise !== null && sunset !== null && sunset > sunrise && sunset - sunrise <= 36 * 60 * 60_000;
  const polar = !!day && !validSolar && day.sunrise === null && day.sunset === null && typeof weather?.isDay === 'boolean';
  const solarEstimated = !validSolar && !polar;
  const sunriseMinutes = validSolar ? clockParts(sunrise, timezone).minutes : 360;
  const sunsetMinutes = validSolar ? clockParts(sunset, timezone).minutes : 1080;
  const sunriseLabel = polar ? '—' : label(sunriseMinutes);
  const sunsetLabel = polar ? '—' : label(sunsetMinutes);
  let length = validSolar ? (sunset - sunrise) / 60_000 : 720;
  let elapsed = validSolar && !simulated ? (instant - sunrise) / 60_000 : minutes - sunriseMinutes;
  if (simulated && validSolar) {
    // A preview is a wall-clock exploration, not a new recorded observation.
    length = sunsetMinutes - sunriseMinutes;
    if (length <= 0) length += 1440;
    if (sunsetMinutes < sunriseMinutes && minutes < sunsetMinutes) elapsed += 1440;
  }

  let phase = phaseAt(elapsed, length);
  let fraction = clamp(elapsed / length);
  let sunVisible = elapsed >= 0 && elapsed <= length;
  let illumination = smoothstep(-35, 75, elapsed) * smoothstep(-50, 80, length - elapsed);
  let warmth = Math.max(Math.exp(-Math.pow((elapsed - 10) / 55, 2)), Math.exp(-Math.pow((length - elapsed - 15) / 65, 2)));
  let sunY = 82 - 68 * Math.sin(Math.PI * fraction);

  if (polar && !simulated) {
    sunVisible = weather.isDay;
    fraction = minutes / 1440;
    sunY = 26 + 16 * (1 - Math.sin(Math.PI * fraction));
    phase = weather.isDay ? (minutes < 660 ? 'morning' : minutes < 840 ? 'noon' : 'afternoon') : 'night';
    illumination = weather.isDay ? 0.82 : 0;
    warmth = 0;
  }
  // In polar previews there is no real sunrise to scrub against. Make the
  // illustrative 06:00–18:00 solar arc explicit through solarEstimated below.
  const attenuation = clamp(1 - cloudCover / 100 * 0.38 - rainIntensity * 0.14 - (condition === 'fog' ? 0.18 : 0), 0.35, 1);
  return {
    phase, sunX: 10 + 80 * fraction, sunY, sunVisible,
    daylight: clamp(illumination * attenuation), warmth: clamp(warmth * (1 - cloudCover / 100 * 0.45)),
    cloudCover, condition, rainIntensity, minutes, timeLabel: label(minutes), timezone, dateKey: clock.dateKey,
    sunriseLabel: polar && simulated ? '06:00' : sunriseLabel,
    sunsetLabel: polar && simulated ? '18:00' : sunsetLabel,
    solarEstimated: solarEstimated || (polar && simulated),
  };
}
