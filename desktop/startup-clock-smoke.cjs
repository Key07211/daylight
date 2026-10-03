// Electron-only, isolated renderer regression: local midnight must use a night intro.
// Run: electron desktop/startup-clock-smoke.cjs [absolute-report.json]
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '.runtime', 'startup-clock-smoke.json'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-startup-clock-'));
const copiedDist = path.join(temporaryRoot, 'dist');
fs.cpSync(path.join(root, 'dist'), copiedDist, { recursive: true });
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(copiedDist, 'index.html'))).digest('hex');
const deviceTimezone = 'America/Los_Angeles';
const instant = Date.parse('2026-10-03T00:30:00-07:00');
const cities = {
  local: { name: 'Berkeley', latitude: 37.8715, longitude: -122.273, timezone: deviceTimezone },
  foreign: { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
};
app.setName('Daylight Startup Clock Smoke');
app.setPath('userData', path.join(temporaryRoot, 'profile'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const contexts = new Map(), scenarios = [], checks = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function verify(event) {
  const context = contexts.get(event.sender.id);
  assert.ok(context && event.senderFrame === event.sender.mainFrame);
  assert.equal(new URL(event.senderFrame.url).origin, context.origin);
  return context;
}
function installBridge() {
  ipcMain.handle('daylight:claim-startup', event => {
    const context = verify(event), first = !context.claimed;
    context.claimed = true;
    return first;
  });
  ipcMain.handle('daylight:get-info', event => ({ version: 'isolated-clock-smoke', dataPath: verify(event).dataDir,
    autoLaunch: false, alwaysOnTop: false, isPackaged: false }));
  ipcMain.handle('daylight:set-theme', (event, theme) => { verify(event); assert.ok(['day', 'night'].includes(theme)); return { theme }; });
  const unavailable = event => { verify(event); return { state: 'unavailable', registered: false, toolCount: 0, autoConnect: false, canConfigure: false }; };
  ipcMain.handle('daylight:mcp-status', unavailable);
  ipcMain.handle('daylight:check-mcp', unavailable);
  for (const channel of ['daylight:set-always-on-top', 'daylight:set-auto-launch', 'daylight:open-data-folder', 'daylight:install-mcp', 'daylight:set-mcp-auto-connect']) {
    ipcMain.handle(channel, event => { verify(event); throw new Error('Native writes are disabled in the isolated clock test.'); });
  }
}
function forecast(city, stamp) {
  const start = Date.parse(`2026-10-03T00:00:00${city.timezone === deviceTimezone ? '-07:00' : '+09:00'}`);
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: city.timezone, hour: '2-digit', hourCycle: 'h23' }).format(stamp));
  return { latitude: city.latitude, longitude: city.longitude, timezone: city.timezone,
    utc_offset_seconds: city.timezone === deviceTimezone ? -7 * 3600 : 9 * 3600,
    current: { time: stamp / 1000, temperature_2m: 20, is_day: hour >= 6 && hour < 18 ? 1 : 0,
      precipitation: 0, rain: 0, showers: 0, weather_code: 0, cloud_cover: 0 },
    daily: { time: [0, 1, 2].map(day => (start + day * 86400000) / 1000),
      sunrise: [0, 1, 2].map(day => (start + day * 86400000 + 6 * 3600000) / 1000),
      sunset: [0, 1, 2].map(day => (start + day * 86400000 + 18 * 3600000) / 1000) } };
}
const instrument = (stamp, sessionLifecycle = false) => `(() => {
  const OriginalDate = Date;
  class FixtureDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [${stamp}])); }
    static now() { return ${stamp}; }
  }
  window.Date = FixtureDate;
  // This fixture checks preference lifetime. The complete UI smoke separately
  // exercises real view transitions, which need a visible compositor surface.
  if (${sessionLifecycle}) document.startViewTransition = undefined;
  window.__clockSavedThemeAtStart = localStorage.getItem('daylight-theme');
  window.__clockEvents = [];
  let previous = '';
  const record = () => {
    const scene = document.querySelector('.startup-scene');
    const state = { phase:scene?.dataset.phase || 'absent', theme:scene?.dataset.theme,
      palette:document.documentElement.dataset.theme, time:scene?.dataset.time,
      timezone:scene?.dataset.timezone, solarProgress:scene?.dataset.solarProgress, at:performance.now() };
    const key = [state.phase,state.theme,state.palette,state.time,state.timezone].join('|');
    if (key === previous) return;
    previous = key; window.__clockEvents.push(state);
  };
  new MutationObserver(record).observe(document,{childList:true,subtree:true,attributes:true,
    attributeFilter:['data-phase','data-theme','data-time','data-timezone','data-solar-progress']});
})();`;

async function scenario(name, city, saved = {}, options = {}) {
  console.log(`Checking ${name}`);
  const { createApp } = await import(pathToFileURL(path.join(root, 'server', 'app.mjs')).href);
  const dataDir = path.join(temporaryRoot, name, 'data');
  const stamp = options.now || instant;
  const expectedTheme = options.expectedTheme || 'night';
  const requests = { location: 0, forecast: 0, mutations: 0 };
  const service = await createApp({ dataDir, distDir: copiedDist, startScheduler: false, codexInfo: { available: false },
    weatherFetch: async url => {
      const location = url.startsWith('https://ipwho.is/');
      assert.ok(location || url.startsWith('https://api.open-meteo.com/v1/forecast'));
      requests[location ? 'location' : 'forecast']++;
      await pause(location ? 60 : 100);
      return { ok: true, status: 200, json: async () => location
        ? { success: true, city: city.name, region: 'Fixture', country: 'Fixture', latitude: city.latitude, longitude: city.longitude, timezone: { id: city.timezone } }
        : forecast(city, stamp) };
    } });
  const original = service.server.listeners('request')[0];
  service.server.removeAllListeners('request');
  service.server.on('request', (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) requests.mutations++;
    if (request.url === '/__clock-seed') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Clock fixture</title>'); return; }
    original(request, response);
  });
  const origin = await service.listen(0);
  const baseline = JSON.stringify(service.store.data);
  const makeWindow = () => {
    const window = new BrowserWindow({ show: false, width: 1360, height: 900, paintWhenInitiallyHidden: true,
      webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false, partition: `startup-clock-${name}` } });
    contexts.set(window.webContents.id, { origin, dataDir, claimed: false });
    return window;
  };
  let window = makeWindow();
  const evaluate = expression => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: renderer evaluation stalled during ${stage}`)), 2500);
    window.webContents.executeJavaScript(expression).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const waitFor = async expression => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(25); }
    throw new Error(`${name}: timed out: ${expression}`);
  };
  const attachInstrumentation = async () => {
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.enable');
    await window.webContents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: deviceTimezone });
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'forced-colors', value: 'none' }] });
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: instrument(stamp, !!options.sessionLifecycle) });
  };
  let stage = 'first-window';
  try {
    await window.loadURL(origin + '/__clock-seed');
    await evaluate(`localStorage.clear();sessionStorage.clear();for(const [key,value] of Object.entries(${JSON.stringify(saved)}))localStorage.setItem(key,JSON.stringify(value));`);
    await attachInstrumentation();
    await window.loadURL(origin);
    await waitFor("document.querySelector('.startup-scene')?.dataset.phase==='hold'");
    const observed = await evaluate(`(() => {const scene=document.querySelector('.startup-scene');return {
      systemTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone, systemHour:new Date().getHours(), now:Date.now(),
      introTheme:scene.dataset.theme, palette:document.documentElement.dataset.theme, introTime:scene.dataset.time,
      introTimezone:scene.dataset.timezone, solarProgress:scene.dataset.solarProgress,
      hasSun:Boolean(scene.querySelector('.startup-sun')), hasMoon:Boolean(scene.querySelector('.startup-moon')),
      weatherText:document.querySelector('.weather-badge')?.textContent, override:localStorage.getItem('daylight-theme-override'),
      events:window.__clockEvents};})()`);
    assert.equal(observed.systemTimezone, deviceTimezone);
    assert.equal(observed.systemHour, options.hour ?? 0);
    assert.equal(observed.now, stamp);
    assert.ok(requests.location && requests.forecast, 'Fixture weather must resolve through the actual provider path');
    assert.equal(JSON.stringify(service.store.data), baseline, 'Startup changed the isolated task store');
    assert.equal(requests.mutations, 0);
    checks[`${name}.deviceClockChoosesIntro`] = observed.introTheme === expectedTheme && (expectedTheme === 'night' ? observed.hasMoon && !observed.hasSun : observed.hasSun && !observed.hasMoon);
    checks[`${name}.deviceClockChoosesPalette`] = observed.palette === expectedTheme;
    checks[`${name}.introTimeUsesDeviceZone`] = observed.introTimezone === deviceTimezone;
    if (Object.hasOwn(saved, 'daylight-theme-override')) checks[`${name}.legacyOverrideRemoved`] = observed.override === null;
    if (options.solarAngle !== undefined) {
      const readAngle = `(() => {const arm=document.querySelector('.startup-solar-arm');if(!arm)return null;const style=getComputedStyle(arm);const matrix=new DOMMatrixReadOnly(style.transform);return {angle:Math.atan2(matrix.b,matrix.a)*180/Math.PI, target:getComputedStyle(document.querySelector('.startup-scene')).getPropertyValue('--solar-angle').trim(), transform:style.transform};})()`;
      // Seek the actual renderer CSSAnimation: hidden compositor frame clocks
      // can pause even when DOM visibility and JS timers continue to advance.
      await evaluate("window.__solarAnimation=document.querySelector('.startup-solar-arm').getAnimations().find(animation=>animation.animationName==='startup-sun-journey');window.__solarAnimation.pause();window.__solarAnimation.currentTime=0");
      observed.sunBefore = await evaluate(readAngle);
      await evaluate('window.__solarAnimation.currentTime=1325');
      observed.sunMiddle = await evaluate(readAngle);
      await evaluate('window.__solarAnimation.currentTime=2650');
      observed.sunAfter = await evaluate(readAngle);
      observed.solarSampling = 'Actual CSSAnimation sought at0/1325/2650ms; computed SVG transform matrices recorded';
      checks[`${name}.actualSunTransformReachesClockAngle`] = Math.abs(observed.sunAfter.angle - options.solarAngle) < .15;
      checks[`${name}.sunAnimationInterpolatesTowardClock`] = observed.sunBefore.angle < observed.sunMiddle.angle && observed.sunMiddle.angle < observed.sunAfter.angle;
      checks[`${name}.solarDestinationStyleMatchesClock`] = Math.abs(parseFloat(observed.sunAfter.target) - options.solarAngle) < .01;
    }
    if (options.sessionLifecycle) {
      stage = 'manual-choice';
      await evaluate("document.querySelector('.startup-skip').click()");
      await waitFor("!document.querySelector('.startup-scene') && !document.querySelector('.app-shell')?.inert");
      await evaluate("document.querySelector('button.theme-toggle').click()");
      await waitFor("document.documentElement.dataset.theme==='day' && !document.documentElement.dataset.themeTransition");
      checks.manualChoiceLivesOnlyInSession = await evaluate("JSON.parse(sessionStorage.getItem('daylight-theme-override')).theme==='day' && !localStorage.getItem('daylight-theme-override')");
      // Native hide/show and initial visibility are independently covered by
      // startup-smoke.cjs. Keep this session-lifetime fixture fully unshown.
      stage = 'renderer-reload';
      await window.loadURL(origin);
      await waitFor("Boolean(document.querySelector('.app-shell')) && !document.querySelector('.startup-scene') && document.documentElement.dataset.theme==='day'");
      checks.manualChoiceSurvivesRendererReload = await evaluate("JSON.parse(sessionStorage.getItem('daylight-theme-override')).theme==='day'");
      contexts.delete(window.webContents.id);
      window.destroy();
      // Same origin and Electron partition retain localStorage, while a newly
      // created top-level window gets an empty sessionStorage and a launch claim.
      window = makeWindow();
      stage = 'new-window';
      // Materialize the new renderer before issuing DevTools emulation calls.
      // Do not reseed: this window must inherit only persistent localStorage.
      await window.loadURL(origin + '/__clock-seed');
      await attachInstrumentation();
      await window.loadURL(origin);
      await waitFor("document.querySelector('.startup-scene')?.dataset.phase==='hold'");
      observed.newWindow = await evaluate("({initialSavedTheme:window.__clockSavedThemeAtStart,theme:document.querySelector('.startup-scene').dataset.theme,palette:document.documentElement.dataset.theme,hasMoon:Boolean(document.querySelector('.startup-scene .startup-moon')),override:sessionStorage.getItem('daylight-theme-override')})");
      checks.newWindowPreservesLocalStorageFixture = observed.newWindow.initialSavedTheme === 'day';
      checks.newWindowClearsTemporaryThemeChoice = observed.newWindow.override === null;
      checks.newWindowStartsNightAtLocalMidnight = observed.newWindow.theme === 'night' && observed.newWindow.palette === 'night' && observed.newWindow.hasMoon;
    }
    assert.equal(JSON.stringify(service.store.data), baseline, 'Lifecycle changed the isolated task store');
    assert.equal(requests.mutations, 0);
    scenarios.push({ name, providerCity: city.name, providerTimezone: city.timezone, saved, requests, ...observed });
  } catch (error) {
    scenarios.push({ name, stage, error: error.message,
      state: await evaluate("({hidden:document.hidden,phase:document.querySelector('.startup-scene')?.dataset.phase,palette:document.documentElement.dataset.theme,events:window.__clockEvents})").catch(() => null) });
    throw error;
  } finally {
    if (!window.isDestroyed()) { contexts.delete(window.webContents.id); window.destroy(); }
    service.server.closeAllConnections();
    await service.close();
  }
}

async function run() {
  await app.whenReady();
  installBridge();
  await scenario('fresh-local', cities.local);
  await scenario('fresh-foreign-city', cities.foreign);
  await scenario('valid-persisted-day-override', cities.local, {
    'daylight-theme': 'day', 'daylight-theme-override': { theme: 'day', periodKey: `${deviceTimezone}|2026-10-02|19` },
  });
  await scenario('expired-day-override', cities.local, {
    'daylight-theme': 'day', 'daylight-theme-override': { theme: 'day', periodKey: `${deviceTimezone}|2026-10-02|07` },
  });
  await scenario('bare-saved-day', cities.local, { 'daylight-theme': 'day' });
  for (const [hour, solarAngle] of [[8, -60], [12, 0], [17, 75]]) {
    await scenario(`day-solar-${hour}`, cities.local, {}, { hour, solarAngle, expectedTheme: 'day', now: Date.parse(`2026-10-03T${String(hour).padStart(2, '0')}:00:00-07:00`) });
  }
  await scenario('session-lifecycle', cities.local, {}, { sessionLifecycle: true });
}
app.on('window-all-closed', () => {});
let error;
const watchdog = setTimeout(() => { console.error('Startup clock smoke exceeded45seconds'); app.exit(2); }, 45000);
run().catch(value => { error = value; }).finally(() => {
  clearTimeout(watchdog);
  const failed = Object.keys(checks).filter(key => !checks[key]);
  const report = { ok: !error && !failed.length, checks, failed, sourceIndexSha256: sourceHash,
    deviceTimezone, pinnedInstant: new Date(instant).toISOString(), temporaryRoot, copiedDist, scenarios,
    productionDataAccessed: false, actualNetworkRequests: 0, codexConfigurationWrites: 0,
    ...(error ? { error: error.message, stack: error.stack } : {}) };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, output, failed, scenarios: scenarios.map(({name,introTheme,introTime,introTimezone,palette})=>({name,introTheme,introTime,introTimezone,palette})), ...(error ? { error: error.message } : {}) }, null, 2));
  // The entire fixture tree was freshly allocated by this process. Electron can
  // still hold profile files until exit, so leave it to the OS temp-directory policy.
  app.exit(error ? 2 : failed.length ? 1 : 0);
});
