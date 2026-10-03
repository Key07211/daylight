// Run with Electron, after `npm run build`. All storage and provider responses are isolated.
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const nativeOnly = process.argv.includes('--native-only');
const output = path.resolve(process.argv.slice(2).find(argument => !argument.startsWith('--')) || path.join(root, '.runtime', nativeOnly ? 'startup-native-visibility.json' : 'startup-smoke.json'));
const expectedIntroMs = Number(process.env.DAYLIGHT_STARTUP_EXPECTED_MS || 3840);
assert.ok(Number.isFinite(expectedIntroMs) && expectedIntroMs >= 1000 && expectedIntroMs <= 15000, 'Expected intro duration must be 1000–15000 ms.');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-startup-smoke-'));
app.setName('Daylight Startup Smoke');
app.setPath('userData', path.join(temporaryRoot, 'profile'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const contexts = new Map();
const checks = {};
const scenarios = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cities = [
  { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { name: 'Berkeley', latitude: 37.8715, longitude: -122.273, timezone: 'America/Los_Angeles' },
  { name: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  { name: 'Honolulu', latitude: 21.3099, longitude: -157.8581, timezone: 'Pacific/Honolulu' },
];
const hourAt = (timezone, stamp = Date.now()) => Number(new Intl.DateTimeFormat('en', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(stamp));
const themeAt = (timezone, stamp) => { const hour = hourAt(timezone, stamp); return hour >= 19 || hour < 7 ? 'night' : 'day'; };
const providerResponse = body => ({ ok: true, status: 200, json: async () => structuredClone(body) });
function forecast(city) {
  const now = Date.now(), midnight = Math.floor(now / 86400000) * 86400000;
  return { latitude: city.latitude, longitude: city.longitude, timezone: city.timezone, utc_offset_seconds: 0,
    current: { time: now / 1000, temperature_2m: 17, is_day: themeAt(city.timezone) === 'day' ? 1 : 0,
      precipitation: 1.2, rain: 1.2, showers: 0, weather_code: 61, cloud_cover: 87 },
    daily: { time: [0, 1, 2].map(offset => (midnight + offset * 86400000) / 1000),
      sunrise: [null, null, null], sunset: [null, null, null] } };
}
function stampAtHour(timezone, hour, minute) {
  const start = Math.floor(Date.now() / 86400000) * 86400000;
  for (let step = -96; step < 192; step++) {
    const stamp = start + step * 15 * 60000;
    if (hourAt(timezone, stamp) === hour) {
      const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, minute: '2-digit' }).formatToParts(stamp);
      if (Number(parts.find(part => part.type === 'minute').value) === 0) return stamp + minute * 60000;
    }
  }
  throw new Error('Could not choose fixture local hour.');
}
function verify(event) {
  const context = contexts.get(event.sender.id);
  assert.ok(context && event.senderFrame === event.sender.mainFrame, 'Only the isolated renderer may call its bridge.');
  assert.equal(new URL(event.senderFrame.url).origin, context.origin);
  return context;
}
function installBridge() {
  ipcMain.handle('daylight:claim-startup', event => {
    const context = verify(event), first = !context.claimed;
    context.claimed = true; context.claimCalls++;
    if (first) context.successfulClaims++;
    return first;
  });
  ipcMain.handle('daylight:get-info', event => {
    const context = verify(event);
    return { version: 'startup-smoke', dataPath: context.dataDir, autoLaunch: false, alwaysOnTop: false, isPackaged: false };
  });
  ipcMain.handle('daylight:set-theme', (event, theme) => {
    verify(event); assert.ok(['day', 'night'].includes(theme));
    nativeTheme.themeSource = theme === 'night' ? 'dark' : 'light';
    return { theme };
  });
  const unavailable = event => { verify(event); return { state: 'unavailable', registered: false, toolCount: 0, autoConnect: false, canConfigure: false, preview: true }; };
  ipcMain.handle('daylight:mcp-status', unavailable);
  ipcMain.handle('daylight:check-mcp', unavailable);
  for (const channel of ['daylight:set-always-on-top', 'daylight:set-auto-launch', 'daylight:open-data-folder', 'daylight:install-mcp', 'daylight:set-mcp-auto-connect']) {
    ipcMain.handle(channel, event => { verify(event); throw new Error('System and connection writes are disabled in startup smoke tests.'); });
  }
}
const instrumentation = (emulate = true, now = null) => `(() => {
  if (${Number.isFinite(now)}) Date.now = () => ${Number.isFinite(now) ? now : 0};
  window.__nativeVisibilityAtStart={hidden:document.hidden,state:document.visibilityState};
  window.__startupVisible = false;
  if (${emulate}) {
    Object.defineProperty(document, 'hidden', {configurable:true,get:()=>!window.__startupVisible});
    Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=>window.__startupVisible?'visible':'hidden'});
  }
  window.__startupEvents = [];
  let previous = null, seen = false;
  const record = () => {
    const scene = document.querySelector('.startup-scene');
    const phase = scene?.dataset.phase || (seen ? 'done' : 'absent');
    if (scene) seen = true;
    if (phase === previous) return;
    previous = phase;
    window.__startupEvents.push({phase,theme:scene?.dataset.theme,at:performance.now()});
  };
  new MutationObserver(record).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-phase']});
})();`;

async function scenario(name, options, action) {
  const { createApp } = await import(pathToFileURL(path.join(root, 'server/app.mjs')).href);
  const city = options.city || cities[0];
  const dataDir = path.join(temporaryRoot, name, 'data');
  const calls = { location: 0, forecast: 0, mutations: 0 };
  const providerTimers = new Set();
  const service = await createApp({ dataDir, distDir: path.join(root, 'dist'), startScheduler: false,
    codexInfo: { available: false, version: null }, weatherFetch: async (url, config) => {
      const location = url.startsWith('https://ipwho.is/');
      assert.ok(location || url.startsWith('https://api.open-meteo.com/v1/forecast'), 'Unexpected provider request.');
      calls[location ? 'location' : 'forecast']++;
      const wait = options.weatherDelay || (location ? 80 : 140);
      await new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); providerTimers.delete(timer); config.signal?.removeEventListener('abort', abort); resolve(); };
        const abort = () => { clearTimeout(timer); providerTimers.delete(timer); reject(new Error('Fixture request aborted.')); };
        const timer = setTimeout(finish, wait); providerTimers.add(timer);
        config.signal?.addEventListener('abort', abort, { once: true });
      });
      return providerResponse(location ? { success: true, city: city.name, region: 'Fixture region', country: 'Fixture country',
        latitude: city.latitude, longitude: city.longitude, timezone: { id: city.timezone } } : forecast(city));
    } });
  const route = service.server.listeners('request')[0];
  service.server.removeAllListeners('request');
  service.server.on('request', (request, response) => {
    const pathname = new URL(request.url, 'http://fixture').pathname;
    if (!['GET', 'HEAD'].includes(request.method)) calls.mutations++;
    if (pathname === '/__startup-smoke-seed') {
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Isolated startup fixture</title>'); return;
    }
    if (pathname === '/api/bootstrap' && options.bootstrap === 'error') {
      response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"Fixture unavailable"}'); return;
    }
    if (pathname === '/api/bootstrap' && options.bootstrap === 'slow') return;
    if (pathname === '/api/bootstrap' && options.bootstrap === 'delayed') {
      const timer = setTimeout(() => { providerTimers.delete(timer); if (!response.destroyed) route(request, response); }, 2900);
      providerTimers.add(timer);
      response.once('close', () => { clearTimeout(timer); providerTimers.delete(timer); });
      return;
    }
    route(request, response);
  });
  // One isolated sentinel makes unintended task changes observable; no user store is opened.
  service.store.data.tasks.push({ id: 'startup-preservation-fixture', title: 'Startup preservation fixture', notes: '', completed: false,
    priority: 'low', projectId: null, dueAt: null, reminderAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    automation: { enabled: false, prompt: '', workspace: '', runAt: null, repeat: 'none', sandbox: 'read-only' } });
  service.store.save();
  const baseline = fs.readFileSync(service.store.filename, 'utf8');
  const origin = await service.listen(0);
  const window = new BrowserWindow({ show: false, width: 1360, height: 900, paintWhenInitiallyHidden: false,
    ...(options.nativeVisibility ? { x: -20000, y: -20000, opacity: 0, skipTaskbar: true } : {}),
    webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: !!options.nativeVisibility, partition: `startup-smoke-${name}` } });
  const context = { origin, dataDir, claimed: false, claimCalls: 0, successfulClaims: 0 };
  contexts.set(window.webContents.id, context);
  const evaluate = source => window.webContents.executeJavaScript(source);
  const waitFor = async (expression, label, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(40);
    }
    throw new Error(`${name}: ${label} timed out.`);
  };
  try {
    await window.loadURL(origin + '/__startup-smoke-seed');
    await evaluate(`localStorage.setItem('daylight-language','en');
      localStorage.setItem('daylight-weather',JSON.stringify({mode:'preview',locationMode:'auto',preview:{condition:'snow',minutes:720}}));
      localStorage.setItem('daylight-theme','day'); localStorage.removeItem('daylight-theme-override');`);
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.enable');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'forced-colors', value: 'none' }] });
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation(!options.nativeVisibility, options.now) });
    await window.loadURL(origin);
    await waitFor("Boolean(document.querySelector('.startup-scene'))", 'cold pending scene');
    checks[`${name}.pendingIsQuiet`] = await evaluate("document.querySelector('.startup-scene').dataset.phase==='pending' && getComputedStyle(document.querySelector('.startup-content')).opacity==='0' && document.querySelector('.startup-content').getAttribute('aria-hidden')==='true'");
    await action({ window, evaluate, waitFor, calls, city, context, origin });
    checks[`${name}.tasksUnchanged`] = fs.readFileSync(service.store.filename, 'utf8') === baseline && calls.mutations === 0 && service.store.data.tasks.length === 1;
    checks[`${name}.oneNativeClaim`] = context.successfulClaims === 1;
    scenarios.push({ name, city: city.name, timezone: city.timezone, calls, successfulClaims: context.successfulClaims, nativeVisibility: !!options.nativeVisibility,
      nativeVisibilityAtStart: await evaluate('window.__nativeVisibilityAtStart'), events: await evaluate('window.__startupEvents') });
  } catch (error) {
    scenarios.push({ name, failed: error.message, state: await evaluate("({visibility:document.visibilityState,phase:document.querySelector('.startup-scene')?.dataset.phase,events:window.__startupEvents||[]})").catch(() => null) });
    throw error;
  } finally {
    contexts.delete(window.webContents.id);
    if (!window.isDestroyed()) window.destroy();
    for (const timer of providerTimers) clearTimeout(timer);
    service.server.closeAllConnections();
    await service.close();
  }
}
const show = evaluate => evaluate("window.__startupVisible=true; window.__visibleAt=performance.now(); document.dispatchEvent(new Event('visibilitychange'))");
const sceneGone = "!document.querySelector('.startup-scene')";

async function probeNativeVisibility() {
  const observations = [];
  for (const { backgroundThrottling, paintWhenInitiallyHidden } of [
    { backgroundThrottling: true, paintWhenInitiallyHidden: true },
    { backgroundThrottling: false, paintWhenInitiallyHidden: true },
    { backgroundThrottling: true, paintWhenInitiallyHidden: false },
    { backgroundThrottling: false, paintWhenInitiallyHidden: false },
  ]) {
    // Transparent, off-screen windows test native show/hide without disturbing the desktop.
    const window = new BrowserWindow({ show: false, x: -20000, y: -20000, width: 320, height: 240, frame: false,
      opacity: 0, skipTaskbar: true, paintWhenInitiallyHidden,
      webPreferences: { backgroundThrottling, sandbox: true, nodeIntegration: false } });
    try {
      await window.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><script>window.nativeEvents=[{event:"initial",hidden:document.hidden,state:document.visibilityState}];document.addEventListener("visibilitychange",()=>nativeEvents.push({event:"visibilitychange",hidden:document.hidden,state:document.visibilityState}));</script>'));
      const read = () => window.webContents.executeJavaScript('({hidden:document.hidden,state:document.visibilityState,events:window.nativeEvents})');
      const hidden = await read();
      window.showInactive(); await delay(150);
      const shown = await read();
      window.hide(); await delay(150);
      const hiddenAgain = await read();
      observations.push({ backgroundThrottling, paintWhenInitiallyHidden, hidden, shown, hiddenAgain });
    } finally { window.destroy(); }
  }
  return observations;
}

async function run() {
  await app.whenReady();
  installBridge();
  scenarios.push({ nativeVisibility: await probeNativeVisibility() });
  if (nativeOnly) return;
  assert.ok(fs.existsSync(path.join(root, 'dist/index.html')), 'Build the app before running startup-smoke.');
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const expectedTheme of ['day', 'night']) {
    const now = stampAtHour(deviceTimezone, expectedTheme === 'day' ? 12 : 0, 30);
    const city = cities.find(candidate => themeAt(candidate.timezone, now) !== expectedTheme);
    assert.ok(city, `No opposite-weather-clock fixture for ${expectedTheme}.`);
    await scenario(`cold-${expectedTheme}`, { city, now }, async ({ evaluate, waitFor, calls, city, context, window, origin }) => {
      await delay(300);
      checks[`cold-${expectedTheme}.waitsWhileHidden`] = await evaluate("document.querySelector('.startup-scene')?.dataset.phase==='pending'");
      await show(evaluate);
      await waitFor("document.querySelector('.startup-scene')?.dataset.phase==='enter'", 'scene enters after city/weather');
      checks[`cold-${expectedTheme}.deviceChoosesTheme`] = await evaluate(`document.querySelector('.startup-scene').dataset.theme===${JSON.stringify(expectedTheme)} && document.documentElement.dataset.theme===${JSON.stringify(expectedTheme)} && document.querySelector('.startup-scene').dataset.timezone===${JSON.stringify(deviceTimezone)}`);
      await waitFor(sceneGone, 'intro finishes', expectedIntroMs + 1500);
      const elapsed = await evaluate("(()=>{const events=window.__startupEvents; return events.find(e=>e.phase==='done').at-events.find(e=>e.phase==='enter').at;})()");
      checks[`cold-${expectedTheme}.fullDuration`] = elapsed >= expectedIntroMs - 300 && elapsed < expectedIntroMs + 1300;
      checks[`cold-${expectedTheme}.migratesLegacyPreview`] = await evaluate("JSON.parse(localStorage.getItem('daylight-weather')).mode==='live' && document.querySelector('.weather-badge').dataset.weatherMode==='live' && !sessionStorage.getItem('daylight-weather-preview-session')");
      checks[`cold-${expectedTheme}.usesProviderCityAndRain`] = calls.location > 0 && calls.forecast > 0 && await evaluate(`document.querySelector('.weather-badge').textContent.includes(${JSON.stringify(city.name)}) && document.querySelector('.weather-badge').textContent.includes('17°') && document.documentElement.dataset.weather==='rain'`);
      if (expectedTheme === 'night') {
        checks.foreignWeatherCannotOverrideDeviceClock = themeAt(city.timezone, now) !== expectedTheme;
        for (const [hour, minute, theme] of [[6, 59, 'night'], [7, 0, 'day'], [18, 59, 'day'], [19, 0, 'night']]) {
          const stamp = stampAtHour(deviceTimezone, hour, minute);
          await evaluate(`window.__realNow ||= Date.now; Date.now=()=>${stamp}; window.dispatchEvent(new Event('focus'))`);
          await waitFor(`document.documentElement.dataset.theme===${JSON.stringify(theme)} && !document.documentElement.dataset.themeTransition`, `device clock ${hour}:${minute}`);
          checks[`deviceClock.${hour}:${String(minute).padStart(2, '0')}`] = true;
        }
        await evaluate("Date.now=window.__realNow; window.dispatchEvent(new Event('focus'))");
      }
      await window.loadURL(origin);
      await waitFor(sceneGone, 'same process reload skips intro');
      await show(evaluate);
      await delay(150);
      checks[`cold-${expectedTheme}.reloadDoesNotReplay`] = context.claimCalls >= 2 && await evaluate("!window.__startupEvents.some(event=>event.phase==='enter')");
    });
  }
  await scenario('native-hidden-launch', { nativeVisibility: true }, async ({ window, evaluate, waitFor }) => {
    await delay(700);
    checks.nativeFirstFrameIsHidden = await evaluate("window.__nativeVisibilityAtStart.hidden && document.hidden && document.visibilityState==='hidden'");
    checks.nativeHiddenLaunchPreservesIntro = await evaluate("document.querySelector('.startup-scene')?.dataset.phase==='pending' && !window.__startupEvents.some(event=>event.phase==='enter')");
    window.showInactive();
    await waitFor("document.visibilityState==='visible' && document.querySelector('.startup-scene')?.dataset.phase==='enter'", 'native show starts intro');
    await waitFor(sceneGone, 'native intro finishes', expectedIntroMs + 1500);
    checks.nativeShowGetsFullIntro = await evaluate(`(()=>{const events=window.__startupEvents;return events.find(e=>e.phase==='done').at-events.find(e=>e.phase==='enter').at>=${expectedIntroMs - 300}})()`);
    window.hide();
    await waitFor("document.hidden && document.visibilityState==='hidden'", 'native hide event');
    window.showInactive();
    await waitFor("document.visibilityState==='visible'", 'native tray-style reopen');
    await delay(180);
    checks.nativeReopenDoesNotReplay = await evaluate("!document.querySelector('.startup-scene') && window.__startupEvents.filter(event=>event.phase==='enter').length===1");
  });
  await scenario('bootstrap-error', { bootstrap: 'error' }, async ({ evaluate, waitFor }) => {
    await show(evaluate);
    await waitFor(sceneGone, 'failure exposes retry', 1500);
    checks.bootstrapErrorIsVisible = await evaluate("Boolean(document.querySelector('.loading-screen button')) && !document.querySelector('.loading-screen').inert && document.querySelector('.loading-screen').textContent.includes('unavailable')");
  });
  await scenario('bootstrap-slow', { bootstrap: 'slow' }, async ({ evaluate, waitFor }) => {
    await show(evaluate);
    await waitFor(sceneGone, 'slow bootstrap exposes loading', 5100);
    checks.slowBootstrapIsBounded = await evaluate("performance.now()-window.__visibleAt<4800 && Boolean(document.querySelector('.loading-screen')) && !document.querySelector('.loading-screen').inert");
  });
  await scenario('weather-slow', { weatherDelay: 7000 }, async ({ evaluate, waitFor }) => {
    await show(evaluate);
    await waitFor("document.querySelector('.startup-scene')?.dataset.phase==='enter'", 'weather deadline starts full intro', 5100);
    checks.slowWeatherDoesNotBlockApp = await evaluate("performance.now()-window.__visibleAt<4800 && Boolean(document.querySelector('.app-shell'))");
    await waitFor(sceneGone, 'weather fallback intro finishes', expectedIntroMs + 1500);
    checks.slowWeatherStillGetsFullIntro = await evaluate(`(()=>{const events=window.__startupEvents;return events.find(e=>e.phase==='done').at-events.find(e=>e.phase==='enter').at>=${expectedIntroMs - 300}})()`);
  });
  await scenario('delayed-bootstrap-weather-slow', { bootstrap: 'delayed', weatherDelay: 7000 }, async ({ evaluate, waitFor }) => {
    await show(evaluate);
    await waitFor("document.querySelector('.startup-scene')?.dataset.phase==='enter'", 'late bootstrap cannot reset the pending deadline', 5100);
    checks.lateBootstrapPreservesAbsoluteDeadline = await evaluate("performance.now()-window.__visibleAt<4800 && Boolean(document.querySelector('.app-shell'))");
    await waitFor(sceneGone, 'late bootstrap full intro finishes', expectedIntroMs + 1500);
    checks.lateBootstrapStillGetsFullIntro = await evaluate(`(()=>{const events=window.__startupEvents;return events.find(e=>e.phase==='done').at-events.find(e=>e.phase==='enter').at>=${expectedIntroMs - 300}})()`);
  });
  assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
}

let exitCode = 0;
const watchdog = setTimeout(() => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ok: false, error: 'Startup smoke exceeded 75 seconds.', checks, scenarios }, null, 2));
  console.error('Startup smoke exceeded 75 seconds.'); app.exit(1);
}, 75000);
run().catch(error => { exitCode = 1; scenarios.push({ failure: error.message, stack: error.stack }); }).finally(async () => {
  clearTimeout(watchdog);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const report = { ok: exitCode === 0, expectedIntroMs, temporaryRoot, visibility: 'native hidden/show/hide cold scenario, plus controlled renderer visibility for timing fixtures', checks, scenarios,
    productionDataAccessed: false, modelRuns: 0, codexConfigurationWrites: 0 };
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, passed: Object.values(checks).filter(Boolean).length, failed: Object.keys(checks).filter(key => !checks[key]), output,
    error: scenarios.find(item => item.failure)?.failure, ...(nativeOnly ? { nativeVisibility: scenarios[0]?.nativeVisibility } : {}) }));
  app.exit(exitCode);
});
app.on('window-all-closed', () => {});
