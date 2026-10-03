// Development-only visual capture. This uses the separate UI preview profile.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ window, origin, root }) => {
  const runtime = path.join(root, '.runtime');
  const frames = path.join(runtime, 'startup-frames');
  fs.mkdirSync(frames, { recursive: true });
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (expression, label) => {
    for (let i = 0; i < 180; i++) {
      if (await evaluate(expression)) return;
      await wait(100);
    }
    throw new Error(`Startup demo timed out: ${label}`);
  };
  await until("!!document.querySelector('.app-shell') && !document.querySelector('.startup-scene')", 'ready');
  const savedWeather = await evaluate("Object.fromEntries(['daylight-weather','daylight-weather-cache','daylight-weather-location'].map(key=>[key,localStorage.getItem(key)]))");
  const report = { fixtures: true, themes: {}, screenshots: {} };
  let injection;
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  try {
    window.setContentSize(1360, 900);
    window.show(); window.focus();
    const scenes = [
      { name: 'morning', hour: '08:30', rain: false },
      { name: 'noon', hour: '13:00', rain: false },
      { name: 'sunset', hour: '18:40', rain: false },
      { name: 'night', hour: '21:30', rain: false },
      { name: 'rain-day', hour: '10:30', rain: true },
      { name: 'rain-night', hour: '21:30', rain: true },
    ];
    for (const scenario of scenes) {
      const theme = scenario.name;
      const stamp = Date.parse(`2026-10-02T${scenario.hour}:00-07:00`);
      const fixtureCity = { name: '开场演示', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' };
      const fixtureWeather = { latitude: fixtureCity.latitude, longitude: fixtureCity.longitude, timezone: fixtureCity.timezone,
        fetchedAt: new Date(stamp).toISOString(), observedAt: new Date(stamp).toISOString(), source: 'Open-Meteo', stale: false,
        temperature: 16, weatherCode: scenario.rain ? 63 : 0, cloudCover: scenario.rain ? 85 : 10,
        rain: scenario.rain ? 2 : 0, precipitation: scenario.rain ? 2 : 0, showers: 0,
        days: [{ date: '2026-10-02', sunrise: '2026-10-02T07:06:00-07:00', sunset: '2026-10-02T18:50:00-07:00' }] };
      if (injection) await window.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection });
      ({ identifier: injection } = await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          Date.now = () => ${stamp};
          localStorage.setItem('daylight-weather', JSON.stringify({mode:'live',locationMode:'auto'}));
          for (const key of ['daylight-weather-cache','daylight-weather-location','daylight-theme-override']) localStorage.removeItem(key);
          sessionStorage.removeItem('daylight-theme-override');
          sessionStorage.removeItem('daylight-weather-preview-session');
          const originalFetch = window.fetch.bind(window);
          window.fetch = (input, options) => {
            const url = new URL(typeof input === 'string' ? input : input.url, location.href);
            if (url.pathname === '/api/weather/location') return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(fixtureCity)})));
            if (url.pathname === '/api/weather') return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(fixtureWeather)})));
            return originalFetch(input, options);
          };
        })()`
      }));
      await window.loadURL(origin);
      if (await evaluate('Date.now()') !== stamp) throw new Error('Demo clock injection did not apply.');
      await until(`!!document.querySelector('.app-shell') && !document.querySelector('.startup-scene')
        && document.documentElement.dataset.weather === ${JSON.stringify(scenario.rain ? 'rain' : 'clear')}
        && document.querySelector('.weather-badge')?.textContent.includes('开场演示')`, 'scenario ready');
      await until("!document.documentElement.dataset.themeTransition", 'theme settled');
      await evaluate("document.querySelector('.sidebar-bottom button').click()");
      await until("!!document.querySelector('[data-replay-startup]')", 'replay control');
      const enabled = await evaluate("!document.querySelector('[data-replay-startup]').disabled");
      if (!enabled) { report.reducedMotion = true; break; }
      await evaluate("document.querySelector('[data-replay-startup]').click()");
      await until("document.querySelector('.startup-scene')?.dataset.phase === 'enter'", 'intro entered');
      const started = Date.now();
      const samples = [];
      for (let index = 0; index < 70; index++) {
        await wait(Math.max(0, started + index * 90 - Date.now()));
        const file = path.join(frames, `${theme}-${String(index).padStart(2, '0')}.png`);
        const capture = await window.webContents.capturePage();
        fs.writeFileSync(file, capture.resize({ width: 1088 }).toPNG());
        const sample = await evaluate(`(() => {
          const scene = document.querySelector('.startup-scene');
          return { phase: scene?.dataset.phase || 'done', alpha: scene ? Number(getComputedStyle(scene).opacity) : 0,
            contentAlpha: scene ? Number(getComputedStyle(scene.querySelector('.startup-content')).opacity) : 0,
            theme: scene?.dataset.theme, time: scene?.dataset.time, solarProgress: scene?.dataset.solarProgress,
            rain: scene?.dataset.rainIntensity, sunTransform:scene?.querySelector('.startup-solar-arm') ? getComputedStyle(scene.querySelector('.startup-solar-arm')).transform : null,
            moonAlpha:scene?.querySelector('.startup-moon') ? getComputedStyle(scene.querySelector('.startup-moon')).opacity : null,
            starDelays:scene ? [...scene.querySelectorAll('.startup-hanging-star-drop')].map(el=>getComputedStyle(el).animationDelay) : [],
            drops:scene?.querySelectorAll('.startup-rain-lens').length,
            inert: document.querySelector('.app-shell').inert };
        })()`);
        samples.push({ elapsed: Date.now() - started, ...sample });
        if (sample.phase === 'hold' && Date.now() - started > 2850 && !report.screenshots[theme]) {
          const still = path.join(root, 'design', `startup-${theme}.png`);
          fs.writeFileSync(still, capture.toPNG());
          report.screenshots[theme] = still;
        }
        if (sample.phase === 'done' && Date.now() - started > 4250) break;
      }
      report.themes[theme] = samples;
      await until("!document.querySelector('.startup-scene')", 'intro completed');
    }
  } finally {
    if (injection) await window.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection });
    window.webContents.debugger.detach();
    await evaluate(`(() => {
      // This is the isolated demo profile: end in real, automatic city time.
      localStorage.removeItem('daylight-theme-override');
      sessionStorage.removeItem('daylight-theme-override');
      sessionStorage.removeItem('daylight-weather-preview-session');
      for (const [key,value] of Object.entries(${JSON.stringify(savedWeather)})) {
        if(value === null) localStorage.removeItem(key); else localStorage.setItem(key,value);
      }
    })()`);
    await window.loadURL(origin);
    await until("!!document.querySelector('.weather-badge') && !document.querySelector('.startup-scene')", 'live theme restored');
    await until("document.querySelector('.weather-badge')?.dataset.weatherMode === 'live'", 'live weather');
    await wait(1600);
    await evaluate("document.querySelector('[data-view=all]')?.click()");
    report.live = await evaluate(`({theme:document.documentElement.dataset.theme,weather:document.documentElement.dataset.weather,
      badge:document.querySelector('.weather-badge').textContent,mode:document.querySelector('.weather-badge').dataset.weatherMode,
      preferences:JSON.parse(localStorage.getItem('daylight-weather')),city:JSON.parse(localStorage.getItem('daylight-weather-location'))?.location,
      clock:new Date().toISOString(),noIntroOnReload:!document.querySelector('.startup-scene')})`);
    fs.writeFileSync(path.join(runtime, 'startup-demo.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(root, 'design', 'startup-live-theme.png'), (await window.webContents.capturePage()).toPNG());
    window.show(); window.focus();
  }
};
