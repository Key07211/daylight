import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAtmosphere, conditionFromWeatherCode } from '../src/weather-model.js';

const location = { timezone: 'America/Los_Angeles' };
const weather = {
  timezone: 'America/Los_Angeles', weatherCode: 0, cloudCover: 0, rain: 0, showers: 0, isDay: true,
  days: [{ date: '2026-10-02', sunrise: '2026-10-02T13:00:00.000Z', sunset: '2026-10-03T01:00:00.000Z' }],
};
const at = (time, overrides = {}) => deriveAtmosphere({ now: `2026-10-02T${time}:00-07:00`, weather, location, ...overrides });

test('an explicit device timezone keeps midnight dark even when the weather city is in daytime', () => {
  const foreign = { ...weather, timezone: 'Asia/Tokyo', isDay: true,
    days: [{ date: '2026-10-03', sunrise: '2026-10-03T06:00:00+09:00', sunset: '2026-10-03T18:00:00+09:00' }] };
  const actual = deriveAtmosphere({ now: '2026-10-03T00:30:00-07:00', weather: foreign,
    location: { timezone: 'Asia/Tokyo' }, timezone: 'America/Los_Angeles' });
  assert.equal(actual.timezone, 'America/Los_Angeles');
  assert.equal(actual.timeLabel, '00:30');
  assert.equal(actual.phase, 'night');
  assert.equal(actual.sunVisible, false);
  assert.equal(actual.solarEstimated, true);
});

test('device clock retains matching local sunrise data and accepts equivalent timezone aliases', () => {
  const actual = at('12:00', { timezone: 'US/Pacific' });
  assert.equal(actual.timeLabel, '12:00');
  assert.equal(actual.solarEstimated, false);
  assert.equal(actual.sunX, 50);
});

test('solar arc progresses from sunrise through noon to sunset with smooth light and warmth', () => {
  const before = at('05:45'), sunrise = at('06:00'), morning = at('09:00'), noon = at('12:00'), afternoon = at('16:00'), sunset = at('18:00'), twilight = at('18:25'), night = at('19:00');
  assert.deepEqual([before.phase, sunrise.phase, morning.phase, noon.phase, afternoon.phase, sunset.phase, twilight.phase, night.phase],
    ['dawn', 'dawn', 'morning', 'noon', 'afternoon', 'sunset', 'twilight', 'night']);
  assert.equal(sunrise.sunX, 10);
  assert.equal(noon.sunX, 50);
  assert.equal(sunset.sunX, 90);
  assert.equal(sunrise.sunY, 82);
  assert.equal(noon.sunY, 14);
  assert.ok(Math.abs(sunset.sunY - 82) < 0.0001);
  assert.equal(before.sunVisible, false);
  assert.equal(noon.sunVisible, true);
  assert.equal(twilight.sunVisible, false);
  assert.ok(before.daylight < sunrise.daylight && sunrise.daylight < morning.daylight && morning.daylight <= noon.daylight);
  assert.ok(sunset.daylight > twilight.daylight && twilight.daylight > night.daylight);
  assert.ok(sunrise.warmth > noon.warmth && sunset.warmth > noon.warmth);
  assert.ok(Math.abs(at('05:59').daylight - sunrise.daylight) < 0.03);
  assert.equal(noon.solarEstimated, false);
  assert.equal(noon.sunriseLabel, '06:00');
  assert.equal(noon.sunsetLabel, '18:00');
});

test('clouds and rain reduce illumination while preserving the clock-driven sun position', () => {
  const clear = at('12:00');
  const cloudy = at('12:00', { weather: { ...weather, weatherCode: 3, cloudCover: 95 } });
  const rain = at('12:00', { weather: { ...weather, weatherCode: 65, cloudCover: 95, rain: 3 } });
  assert.ok(rain.daylight < cloudy.daylight && cloudy.daylight < clear.daylight);
  assert.equal(clear.sunX, rain.sunX);
  assert.equal(clear.sunY, cloudy.sunY);
  assert.equal(rain.condition, 'rain');
  assert.ok(rain.rainIntensity >= 0.85 && rain.rainIntensity <= 1);
});

test('WMO freezing rain stays rain, snowfall stays snow, and unknown conditions are not called clear', () => {
  for (const code of [56, 57, 66, 67]) assert.equal(conditionFromWeatherCode(code), 'rain');
  for (const code of [71, 73, 75, 77, 85, 86]) {
    const value = at('12:00', { weather: { ...weather, weatherCode: code, precipitation: 8, rain: 0, showers: 0 } });
    assert.equal(value.condition, 'snow');
    assert.equal(value.rainIntensity, 0);
  }
  for (const code of [95, 96, 97, 99]) assert.equal(conditionFromWeatherCode(code), 'storm');
  assert.equal(conditionFromWeatherCode(45), 'fog');
  assert.equal(conditionFromWeatherCode(null), 'unknown');
  const unknown = at('12:00', { weather: null });
  assert.equal(unknown.condition, 'unknown');
  assert.equal(unknown.rainIntensity, 0);
  assert.equal(unknown.solarEstimated, true);
});

test('rain visual intensity is graded from drizzle through showers and storms', () => {
  const levels = [51, 61, 81, 65, 99].map(weatherCode => at('12:00', { weather: { ...weather, weatherCode } }).rainIntensity);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1]);
  assert.equal(at('12:00', { weather: { ...weather, weatherCode: 65, rain: 100 } }).rainIntensity, 1);
});

test('preview overrides weather and wall clock without mutating the real observation', () => {
  const snapshot = JSON.stringify(weather);
  const preview = { condition: 'storm', minutes: 1080 };
  const value = at('12:00', { preview });
  assert.equal(value.timeLabel, '18:00');
  assert.equal(value.condition, 'storm');
  assert.equal(value.phase, 'sunset');
  assert.equal(value.rainIntensity, 0.95);
  assert.equal(value.cloudCover, 99);
  assert.equal(JSON.stringify(weather), snapshot);
  assert.deepEqual(preview, { condition: 'storm', minutes: 1080 });
  assert.equal(at('12:00', { preview: { condition: 'snow', minutes: 800 } }).rainIntensity, 0);
  assert.equal(at('12:00', { preview: { condition: 'clear', minutes: 5000 } }).timeLabel, '23:59');
});

test('city time zone controls date and clock, and actual solar calculations remain valid across DST', () => {
  const tokyo = deriveAtmosphere({ now: '2026-10-02T16:00:00Z', location: { timezone: 'Asia/Tokyo' } });
  assert.equal(tokyo.dateKey, '2026-10-03');
  assert.equal(tokyo.timeLabel, '01:00');
  assert.equal(tokyo.phase, 'night');
  const dstWeather = { ...weather, days: [{ date: '2026-11-01', sunrise: '2026-11-01T14:34:00Z', sunset: '2026-11-02T01:07:00Z' }] };
  const first = deriveAtmosphere({ now: '2026-11-01T08:30:00Z', weather: dstWeather });
  const second = deriveAtmosphere({ now: '2026-11-01T09:30:00Z', weather: dstWeather });
  assert.equal(first.timeLabel, '01:30');
  assert.equal(second.timeLabel, '01:30');
  assert.equal(first.phase, 'night');
  assert.equal(second.phase, 'night');
  const sunrise = deriveAtmosphere({ now: '2026-11-01T14:34:00Z', weather: dstWeather });
  assert.equal(sunrise.sunX, 10);
  assert.equal(sunrise.sunriseLabel, '06:34');
  assert.equal(sunrise.sunsetLabel, '17:07');
});

test('polar day and night use observed daylight without inventing sunrise or producing NaN', () => {
  const polarWeather = { ...weather, timezone: 'Arctic/Longyearbyen', days: [{ date: '2026-06-21', sunrise: null, sunset: null }] };
  const day = deriveAtmosphere({ now: '2026-06-21T21:00:00Z', weather: polarWeather });
  assert.equal(day.sunVisible, true);
  assert.equal(day.sunriseLabel, '—');
  assert.equal(day.sunsetLabel, '—');
  assert.equal(day.solarEstimated, false);
  const night = deriveAtmosphere({ now: '2026-06-21T10:00:00Z', weather: { ...polarWeather, isDay: false } });
  assert.equal(night.phase, 'night');
  assert.equal(night.sunVisible, false);
  for (const value of [day, night]) {
    for (const key of ['sunX', 'sunY', 'daylight', 'warmth', 'cloudCover', 'rainIntensity', 'minutes']) assert.ok(Number.isFinite(value[key]), key);
  }
});

test('invalid zones and malformed solar data fall back safely without ambiguous local date parsing', () => {
  const value = deriveAtmosphere({ now: '2026-10-02T19:00:00Z', location, weather: { ...weather, timezone: 'Bad/Zone',
    days: [{ date: '2026-10-02', sunrise: '2026-10-02T06:00:00', sunset: '2026-10-02T18:00:00' }] } });
  assert.equal(value.timezone, 'America/Los_Angeles');
  assert.equal(value.timeLabel, '12:00');
  assert.equal(value.solarEstimated, true);
  assert.equal(value.sunriseLabel, '06:00');
  const fallback = deriveAtmosphere({ now: NaN, location: { timezone: 'Bad/Zone' }, preview: { condition: 'rain', minutes: -10 } });
  assert.equal(fallback.timeLabel, '00:00');
  assert.ok(Number.isFinite(fallback.daylight));
  assert.ok(Number.isFinite(fallback.sunX));
});
