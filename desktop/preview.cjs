const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
const profile = path.join(runtime, 'ui-preview-profile');
app.setName('Daylight UI Preview');
app.setPath('userData', profile);
let service, window, origin;
let quitting = false;
let startupClaimed = false;
const verify = event => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== origin) throw new Error('Preview window required.');
};
app.whenReady().then(async () => {
  const { createApp } = await import(pathToFileURL(path.join(root, 'server', 'app.mjs')).href);
  service = await createApp({ dataDir: path.join(profile, 'data'), distDir: path.join(root, 'dist'),
    codexInfo: { available: false }, startScheduler: false, allowedOrigins: [] });
  origin = await service.listen(14320);
  const state = await (await fetch(`${origin}/api/bootstrap`)).json();
  if (!state.tasks.length) {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
    const todayAt = hour => { const d = new Date(); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    const examples = [
      { title: '整理今天的课堂笔记', priority: 'high', dueAt: todayAt(23), notes: '回顾课堂重点，整理需要进一步理解的问题。' },
      { title: '完成本周学习计划', priority: 'high', dueAt: todayAt(23), notes: '列出这周的重点安排，确认每项任务的下一步。' },
      { title: '准备小组讨论提纲', priority: 'medium', dueAt: todayAt(23), notes: '整理讨论主题，记录想与小组分享的观点。' },
      { title: '复查项目进度', priority: 'low', dueAt: tomorrow.toISOString(), notes: '示例任务，可自由编辑、完成和删除。' },
    ];
    for (const example of examples) await fetch(`${origin}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': state.csrfToken },
      body: JSON.stringify(example),
    });
  }
  window = new BrowserWindow({ width: 1400, height: 950, minWidth: 960, minHeight: 680, show: false, paintWhenInitiallyHidden: false,
    backgroundColor: '#f7f5ef', autoHideMenuBar: true, icon: path.join(root, 'desktop', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.on('page-title-updated', (event, title) => { event.preventDefault(); window.setTitle(`${title} · 界面预览（示例数据）`); });
  ipcMain.handle('daylight:get-info', event => { verify(event); return { version: '0.2.0 预览', dataPath: path.join(profile, 'data'), autoLaunch: false, alwaysOnTop: window.isAlwaysOnTop(), isPackaged: false }; });
  ipcMain.handle('daylight:claim-startup', event => { verify(event); const first = !startupClaimed; startupClaimed = true; return first; });
  ipcMain.handle('daylight:set-theme', (event, theme) => { verify(event); if (!['day', 'night'].includes(theme)) throw new Error('Invalid theme'); nativeTheme.themeSource = theme === 'night' ? 'dark' : 'light'; window.setBackgroundColor(theme === 'night' ? '#111827' : '#f7f5ef'); return { theme }; });
  ipcMain.handle('daylight:set-always-on-top', (event, value) => { verify(event); if (typeof value !== 'boolean') throw new Error('Invalid pin'); window.setAlwaysOnTop(value); return { alwaysOnTop: value }; });
  ipcMain.handle('daylight:mcp-status', event => { verify(event); return { state:'missing',registered:false,toolCount:0,autoConnect:false,canConfigure:false,preview:true }; });
  for (const channel of ['daylight:set-auto-launch', 'daylight:install-mcp', 'daylight:open-data-folder']) {
    ipcMain.handle(channel, event => { verify(event); throw new Error('界面预览不修改正式应用的系统设置。'); });
  }
  await window.loadURL(origin);
  const demoWeather = process.argv[process.argv.indexOf('--demo-weather') + 1];
  const demoTheme = process.argv[process.argv.indexOf('--demo-theme') + 1];
  if (process.argv.includes('--demo-weather') && ['clear', 'rain', 'snow', 'fog', 'cloudy', 'storm'].includes(demoWeather)) {
    const { resolveScheduledTheme } = await import(pathToFileURL(path.join(root, 'src', 'theme-schedule.js')).href);
    const periodKey = resolveScheduledTheme().periodKey;
    await window.webContents.executeJavaScript(`(() => {
      let prefs; try { prefs = JSON.parse(localStorage.getItem('daylight-weather')); } catch {}
      localStorage.setItem('daylight-weather', JSON.stringify({...prefs, mode:'live'}));
      sessionStorage.setItem('daylight-weather-preview-session',
        JSON.stringify({mode:'preview',preview:{condition:${JSON.stringify(demoWeather)},minutes:${demoTheme === 'night' ? 1260 : 840}}}));
      const theme = ${JSON.stringify(demoTheme)};
      if (theme === 'night' || theme === 'day') sessionStorage.setItem('daylight-theme-override',
        JSON.stringify({theme,periodKey:${JSON.stringify(periodKey)}}));
    })()`);
    await window.loadURL(origin);
  }
  const startingTheme = await window.webContents.executeJavaScript('document.documentElement.dataset.theme');
  window.setBackgroundColor(startingTheme === 'night' ? '#101a2a' : '#f6f5ee');
  window.show(); window.focus();
  fs.writeFileSync(path.join(runtime, 'ui-preview-process.json'), JSON.stringify({ pid: process.pid, origin, profile }));
  if (process.argv.includes('--demo-startup')) await require('./startup-demo.cjs')({ window, origin, root });
  if (process.argv.includes('--verify-animation')) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await window.webContents.executeJavaScript("Boolean(document.querySelector('.liquid-ribbon [data-sheet], .milky-way .galaxy-drift'))")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const animation = await window.webContents.executeJavaScript(`(async () => {
      const ribbon = document.querySelector('.liquid-ribbon');
      const sheet = ribbon?.querySelector('[data-sheet]');
      const galaxy = document.querySelector('.milky-way');
      const drift = galaxy?.querySelector('.galaxy-drift');
      const sky = document.querySelector('.hanging-star, .sky-cloud');
      const rain = document.querySelector('.rain-field-canvas');
      const bead = document.querySelector('.rain-trail');
      const rainBefore = rain?.toDataURL();
      const beadBefore = bead && getComputedStyle(bead).transform;
      const before = sheet?.getAttribute('d');
      const beforeTransform = drift && getComputedStyle(drift).transform;
      const skyBefore = sky && getComputedStyle(sky).transform;
      await new Promise(resolve => setTimeout(resolve, 750));
      return { renderer: ribbon?.dataset.renderer || 'milky-way', motion: ribbon?.dataset.motion || galaxy?.dataset.animated,
        geometryChanges: sheet ? before !== sheet.getAttribute('d') : beforeTransform !== (drift && getComputedStyle(drift).transform),
        skyMotionChanges: skyBefore !== (sky && getComputedStyle(sky).transform),
        rainMotionChanges: rain ? rainBefore !== rain.toDataURL() : null,
        glassWaterMoves: bead ? beadBefore !== getComputedStyle(bead).transform : null,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        theme: document.documentElement.dataset.theme,
        weather: document.documentElement.dataset.weather,
        skyPhase: document.documentElement.dataset.skyPhase,
        sunflowersPresent: Boolean(document.querySelector('.sidebar-sunflower')) };
    })()`);
    fs.writeFileSync(path.join(runtime, 'preview-animation-check.json'), JSON.stringify(animation, null, 2));
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  Promise.resolve(service?.close()).finally(() => app.quit());
});
