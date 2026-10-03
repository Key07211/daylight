// Apply the real clock's palette before styles paint. Weather previews never
// participate in this schedule. A manual choice, including day after 19:00,
// lasts until the next boundary within this window session. A fresh app launch
// follows the device clock. Keep period keys aligned with theme-schedule.js.
(() => {
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const now = Date.now();
  const preferences = read('daylight-weather');
  // Older demos persisted simulated rain/noon. Active previews now live only
  // in sessionStorage, so a new app window always starts from real conditions.
  if (preferences?.mode === 'preview') {
    try { localStorage.setItem('daylight-weather', JSON.stringify({ ...preferences, mode: 'live' })); } catch {}
  }
  // A persisted override from 0.2.1 can keep a newly installed app in daylight
  // all night. Only deliberate choices made in this session may override now.
  try { localStorage.removeItem('daylight-theme-override'); } catch {}
  let timezone = 'UTC';
  for (const candidate of [Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC']) {
    if (typeof candidate !== 'string') continue;
    try { timezone = new Intl.DateTimeFormat('en', { timeZone: candidate }).resolvedOptions().timeZone; break; } catch {}
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  let theme = hour >= 19 || hour < 7 ? 'night' : 'day';
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - (hour < 7 ? 1 : 0))).toISOString().slice(0, 10);
  const periodKey = `${timezone}|${date}|${theme === 'day' ? '07' : '19'}`;
  let override;
  try { override = JSON.parse(sessionStorage.getItem('daylight-theme-override')); } catch {}
  if ((override?.theme === 'day' || override?.theme === 'night') && override.periodKey === periodKey) theme = override.theme;
  else if (override) { try { sessionStorage.removeItem('daylight-theme-override'); } catch {} }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  try { localStorage.setItem('daylight-theme', theme); } catch {}
})();
