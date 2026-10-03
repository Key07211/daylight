// Developer-only public media capture. Never opens a user's Daylight profile.
// Run after building: electron desktop/product-demo.cjs [--english]
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtime, 'product-demo-'));
const english = process.argv.includes('--english');
const captureLanguage = english ? 'en' : 'zh';
const mediaRoot = path.join(root, 'docs', 'media');
const media = english ? path.join(mediaRoot, 'en') : mediaRoot;
fs.mkdirSync(media, { recursive: true });
app.setName('Daylight Product Demo');
app.setPath('userData', profile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let service, window, origin, injection;
const report = { language: captureLanguage, isolated: true, externalRequests: 0, mcpConfigured: false, schedulerStarted: false, screenshots: [], checks: [] };
setTimeout(() => { console.error('Product capture exceeded its three-minute deadline.'); app.exit(1); }, 180000).unref();

app.whenReady().then(async () => {
  if (process.argv.includes('--verify-docs')) return verifyDocs();
  const { createApp } = await import(pathToFileURL(path.join(root, 'server', 'app.mjs')));
  service = await createApp({ dataDir: path.join(profile, 'data'), distDir: path.join(root, 'dist'),
    codexInfo: { available: false }, startScheduler: false, allowedOrigins: [],
    weatherFetch: async () => { throw new Error('External weather disabled in public capture'); } });
  origin = await service.listen(0);
  const initial = await fetch(`${origin}/api/bootstrap`).then(response => response.json());
  assert.equal(initial.tasks.length, 0);
  const request = async (route, method, value) => {
    const response = await fetch(`${origin}/api${route}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': initial.csrfToken }, body: JSON.stringify(value) });
    assert.ok(response.ok, `${method} ${route}: ${response.status}`);
    return response.json();
  };
  const project = await request('/projects', 'POST', { name: english ? 'Ideas & projects' : '灵感与创作', color: '#688c79' });
  const date = (day, hour) => `2026-10-${day}T${hour}:00:00-07:00`;
  const sampleTasks = [
    { title: '整理下一版产品的三个重点', priority: 'high', projectId: project.id, dueAt: date('07','15'), reminderAt: date('07','14'), notes: '梳理反馈、确认最重要的改进，再把下一步拆成可执行的小任务。' },
    { title: '准备周五的创意分享', priority: 'medium', projectId: project.id, dueAt: date('07','17'), reminderAt: date('07','16'), notes: '挑选三个喜欢的设计，写下每个细节值得学习的原因。' },
    { title: '傍晚出去走一走', priority: 'low', dueAt: date('07','18'), notes: '带上相机，留一点时间观察日落。' },
    { title: '读完收藏的长文章', priority: 'medium', dueAt: date('08','10'), notes: '记下一个能在下次项目里用到的想法。' },
    { title: '整理本周进展', priority: 'low', dueAt: date('09','16'), notes: 'Codex 调度草稿；公共演示中保持暂停，不执行。', automation: { enabled: false, prompt: '阅读项目笔记，整理本周已完成事项与下一步建议。仅提供文字总结，不修改文件。', workspace: '', runAt: null, repeat: 'weekly', sandbox: 'read-only' } },
    { title: '完成工作区整理', priority: 'low', completed: true, notes: '归档已经完成的想法，为新一周留出空间。' },
  ];
  if (english) {
    const examples = [
      ['Choose three priorities for the next release', 'Review feedback, choose the most useful improvements, and break the next steps into manageable tasks.'],
      ["Prepare Friday's design share", 'Pick three inspiring designs and note one detail worth learning from each.'],
      ['Take a sunset walk', 'Bring a camera and leave a little time to watch the light change.'],
      ['Read a saved long-form article', 'Write down one idea to try in the next project.'],
      ["Summarize this week's progress", 'Paused Codex scheduling draft. This public demo does not execute it.'],
      ['Clear the workspace', 'Archive finished ideas and make room for the week ahead.'],
    ];
    sampleTasks.forEach((task, index) => {
      [task.title, task.notes] = examples[index];
      if (task.automation) task.automation.prompt = 'Read the project notes and summarize completed work and next steps. Provide a text summary only; do not modify files.';
    });
  }
  for (const task of sampleTasks) await request('/tasks', 'POST', task);
  const verify = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Demo window required');
  };
  window = new BrowserWindow({ width: 1440, height: 960, show: false, backgroundColor: '#f6f5ef',
    webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } });
  window.webContents.setFrameRate(30);
  window.setContentSize(1440, 960);
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/.test(details.url) && new URL(details.url).origin !== origin) { report.externalRequests++; return callback({ cancel: true }); }
    callback({});
  });
  ipcMain.handle('daylight:get-info', event => { verify(event); return { version: 'Product demo', dataPath: english ? 'Isolated sample data' : '隔离的示例数据', autoLaunch: false, alwaysOnTop: window.isAlwaysOnTop(), isPackaged: false }; });
  ipcMain.handle('daylight:claim-startup', event => { verify(event); return false; });
  ipcMain.handle('daylight:set-theme', (event, theme) => { verify(event); assert.ok(['day','night'].includes(theme)); nativeTheme.themeSource = theme === 'night' ? 'dark' : 'light'; return { theme }; });
  ipcMain.handle('daylight:set-always-on-top', (event, value) => { verify(event); assert.equal(typeof value, 'boolean'); window.setAlwaysOnTop(value); return { alwaysOnTop: value }; });
  ipcMain.handle('daylight:mcp-status', event => { verify(event); return { state: 'missing', registered: false, toolCount: 0, autoConnect: false, canConfigure: false, preview: true }; });
  for (const channel of ['daylight:install-mcp','daylight:check-mcp','daylight:set-mcp-auto-connect','daylight:set-auto-launch','daylight:open-data-folder']) {
    ipcMain.handle(channel, event => { verify(event); throw new Error('System changes are disabled in this public demo.'); });
  }
  await window.loadURL('about:blank');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
  await scenario('day');
  await click('[data-view="all"]');
  await capture('tasks-day');
  await click('.task-main');
  await until('!!document.querySelector(".task-form")');
  await capture('task-editor');
  await dismiss();
  await click('.task-checkbox');
  await until('!!document.querySelector(".completion-confirm")');
  await capture('complete-confirm');
  await dismiss();
  assert.equal((await request('/tasks', 'GET')).filter(item => item.completed).length, 1);
  await click('.sidebar-bottom button');
  await until('!!document.querySelector(".glass-settings")');
  await evaluate('document.querySelector(".glass-settings").scrollIntoView({block:"start"}); document.querySelector(".settings-body").scrollTop -= 68');
  await capture('glass-settings');
  await dismiss();
  await click('[data-view="automation"]');
  await capture('codex-workflow');
  assert.equal(await evaluate('document.querySelector(".mcp-connection").dataset.state'), 'missing');
  await click('[data-view="all"]');
  await click('[data-language="en"]');
  await click('.window-pin');
  await until('document.querySelector(".window-pin")?.getAttribute("aria-pressed")==="true"');
  await capture('tasks-english');
  await click('.window-pin');
  await click(`[data-language="${captureLanguage}"]`);
  await intro('opening-day');
  await scenario('night');
  await click('[data-view="all"]');
  await capture('tasks-night');
  await intro('opening-night');
  await scenario('rain');
  await click('[data-view="all"]');
  await capture('tasks-rain');
  await intro('opening-rain');
  assert.equal(report.externalRequests, 0);
  assert.equal(service.store.data.runs.length, 0);
  report.checks.push('Fresh isolated profile', 'Six synthetic tasks only', 'No external requests', 'No Codex registration or execution', 'Completion cancelled without a write', 'Native pin control verified', 'Actual application screenshots');
  fs.writeFileSync(path.join(runtime, `product-demo-report${english ? '-en' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ screenshots: report.screenshots.length, checks: report.checks, externalRequests: report.externalRequests }));
  await service.close(); window.destroy(); app.quit();
}).catch(async error => { console.error(error.message); try { await service?.close(); } catch {} app.exit(1); });

function evaluate(code) { return window.webContents.executeJavaScript(code); }
async function until(code) { for (let i = 0; i < 120; i++) { if (await evaluate(code)) return; await delay(75); } throw new Error(`Timed out: ${code}`); }
async function click(selector) { await evaluate(`(() => { const button=document.querySelector(${JSON.stringify(selector)}); if(!button)throw new Error('Control not found'); button.click(); })()`); await delay(320); }
async function dismiss() { await click('.modal [data-modal-dismiss], .modal-header button'); await until('!document.querySelector(".modal")'); }
async function capture(name) {
  console.log(`Capturing ${name}`);
  await delay(600);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const text = await evaluate('document.body.innerText');
  // The language switch intentionally keeps the native-language label 中文.
  if (english) assert.ok(!/\p{Script=Han}/u.test(text.replaceAll('中文', '')), `Unexpected Chinese content in English capture: ${name}`);
  const username = require('node:os').userInfo().username;
  assert.ok(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}|AppData[\\/]|[\\/]Users[\\/]|[\\/]home[\\/]/i.test(text)
    && (!username || !text.toLowerCase().includes(username.toLowerCase())), `Private content in ${name}`);
  const image = (await window.webContents.capturePage()).toPNG();
  await sharp(image).resize({ width: 1440 }).webp({ quality: 90 }).toFile(path.join(media, `${name}.webp`));
  report.screenshots.push(name);
}
async function scenario(mode) {
  console.log(`Loading ${mode}`);
  const night = mode === 'night', rain = mode === 'rain';
  const stamp = Date.parse(`2026-10-07T${night ? '21:30' : '09:30'}:00-07:00`);
  const city = { name: english ? 'Demo City' : '演示城市', region: '', country: '', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' };
  const weather = { ...city, fetchedAt: new Date(stamp).toISOString(), observedAt: new Date(stamp).toISOString(), source: 'Open-Meteo', stale: false, temperature: rain ? 17 : 22,
    weatherCode: rain ? 63 : 0, cloudCover: rain ? 90 : 10, rain: rain ? 2 : 0, precipitation: rain ? 2 : 0, showers: 0, isDay: !night,
    days: [{ date: '2026-10-07', sunrise: '2026-10-07T07:10:00-07:00', sunset: '2026-10-07T18:45:00-07:00' }] };
  if (injection) await window.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection });
  ({ identifier: injection } = await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const NativeDate=Date; window.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[${stamp}]))}static now(){return ${stamp}}};
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}); Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
    localStorage.setItem('daylight-language',${JSON.stringify(captureLanguage)}); localStorage.setItem('daylight-weather',JSON.stringify({mode:'live',locationMode:'manual',location:${JSON.stringify(city)}}));
    for(const key of ['daylight-weather-cache','daylight-weather-location','daylight-theme-override'])localStorage.removeItem(key);
    sessionStorage.removeItem('daylight-theme-override');sessionStorage.removeItem('daylight-weather-preview-session');
    const original=fetch.bind(window);window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.pathname==='/api/weather')return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(weather)})));
      if(url.pathname==='/api/weather/location')return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(city)})));
      return original(input,options)};
  })()` }));
  await window.loadURL(origin);
  console.log(`Loaded ${mode}`);
  await until(`document.documentElement.dataset.theme===${JSON.stringify(night ? 'night' : 'day')} && document.documentElement.dataset.weather===${JSON.stringify(rain ? 'rain' : 'clear')} && !!document.querySelector('.task-row') && !document.querySelector('.startup-scene')`);
  await delay(550);
  await until('!document.querySelector(".startup-scene") && !document.querySelector(".app-shell").inert');
  assert.equal(await evaluate('Date.now()'), stamp);
}
async function intro(name) {
  await click('.sidebar-bottom button'); await click('[data-replay-startup]');
  await until('document.querySelector(".startup-scene")?.dataset.phase === "enter"');
  if (english) assert.ok(!/\p{Script=Han}/u.test(await evaluate('document.querySelector(".startup-scene").innerText')), `Unexpected Chinese opening: ${name}`);
  const frames = [], delays = [], width = 960, height = 640, start = Date.now();
  for (let index = 0; index < 21; index++) {
    await delay(Math.max(0, start + index * 150 - Date.now()));
    if (!await evaluate('["enter","hold"].includes(document.querySelector(".startup-scene")?.dataset.phase)')) break;
    const image = (await window.webContents.capturePage()).toPNG();
    if (!await evaluate('["enter","hold"].includes(document.querySelector(".startup-scene")?.dataset.phase)')) break;
    frames.push(await sharp(image).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer()); delays.push(150);
  }
  assert.ok(frames.length >= 4, `Insufficient opening frames: ${name}`);
  // Stop on the settled illustration; no incidental app text enters the movie.
  delays[delays.length - 1] = 800;
  await sharp(Buffer.concat(frames), { raw: { width, height: height * frames.length, channels: 4, pageHeight: height } })
    .webp({ quality: 76, loop: 0, delay: delays }).toFile(path.join(media, `${name}.webp`));
  await sharp(frames.at(-1), { raw: { width, height, channels: 4 } }).webp({ quality: 88 }).toFile(path.join(media, `${name}-still.webp`));
  await until('!document.querySelector(".startup-scene")');
  report.screenshots.push(name);
  report.checks.push(`${name}: ${frames.length} verified introduction-only frames`);
}

async function verifyDocs() {
  window = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true } });
  const errors = [], network = [];
  window.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 3) errors.push(event.message);
  });
  window.webContents.on('did-fail-load', (_event, code, description) => errors.push(`${code}: ${description}`));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => { if (/^https?:/.test(details.url)) network.push(details.url); callback({cancel:/^https?:/.test(details.url)}); });
  await window.loadFile(path.join(root, 'docs', 'demo.html'));
  await delay(400);
  await until('document.querySelector("#scene-image")?.complete && document.querySelector("#scene-image")?.naturalWidth > 0');
  assert.equal(await evaluate('document.documentElement.lang'), 'en', 'English is the default tour');
  assert.ok(await evaluate('document.querySelector("#scene-image").src.includes("/media/en/")'), 'Default image must use English assets');
  const chineseAssets = fs.readdirSync(mediaRoot).filter(name => name.endsWith('.webp')).sort();
  const englishAssets = fs.readdirSync(path.join(mediaRoot, 'en')).filter(name => name.endsWith('.webp')).sort();
  assert.equal(chineseAssets.length, 14, 'All Chinese screenshots, movies and posters must exist');
  assert.deepEqual(englishAssets, chineseAssets, 'The English capture set must match the Chinese set');
  const assets = [...chineseAssets, ...englishAssets.map(name => `en/${name}`)];
  const imageResults = await evaluate(`Promise.all(${JSON.stringify(assets)}.map(name=>new Promise(resolve=>{const image=new Image(); image.onload=()=>resolve({name,width:image.naturalWidth});image.onerror=()=>resolve({name,width:0});image.src='media/'+name})))`);
  for (const image of imageResults) assert.ok(image.width > 0, `Broken media: ${image.name}`);
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  await click('[data-chapter="tasks"]'); await click('[data-shot="complete-confirm"]');
  assert.ok(await evaluate('document.querySelector("#scene-image").src.includes("complete-confirm.webp")'));
  await click('[data-lang="en"]');
  assert.equal(await evaluate('document.documentElement.lang'), 'en');
  await click('[data-chapter="atmosphere"]'); await click('[data-shot="tasks-night"]');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'night');
  await click('[data-chapter="opening"]'); await click('#play-opening');
  assert.equal(await evaluate('document.querySelector("#play-opening").getAttribute("aria-pressed")'), 'true');
  await click('#play-opening');
  await click('[data-chapter="tasks"]');
  await until('document.querySelector("#scene-image").complete && document.querySelector("#scene-image").naturalWidth > 0');
  fs.writeFileSync(path.join(runtime, 'product-demo-page-desktop.png'), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(390, 844); await delay(400);
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  fs.writeFileSync(path.join(runtime, 'product-demo-page-mobile.png'), (await window.webContents.capturePage()).toPNG());
  await click('[data-lang="zh"]');
  assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN');
  assert.equal(await evaluate('document.querySelector("#scene-image").src.includes("/media/en/")'), false);
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  fs.writeFileSync(path.join(runtime, 'product-demo-page-mobile-zh.png'), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(1440, 1000); await delay(400);
  for (const language of ['zh', 'en']) {
    await window.loadURL(`${pathToFileURL(path.join(root, 'docs', 'demo.html')).href}?lang=${language}`);
    await until('document.querySelector("#scene-image").complete && document.querySelector("#scene-image").naturalWidth > 0');
    assert.equal(await evaluate('document.documentElement.lang'), language === 'zh' ? 'zh-CN' : 'en');
    for (const chapter of ['tasks', 'atmosphere', 'desktop', 'codex', 'opening', 'local']) {
      await click(`[data-chapter="${chapter}"]`);
      await until('document.querySelector("#scene-image").complete && document.querySelector("#scene-image").naturalWidth > 0');
      assert.equal(await evaluate('document.querySelector("#scene-image").src.includes("/media/en/")'), language === 'en');
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    }
  }
  assert.equal(network.length, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ offline: true, desktop: true, mobile: true, defaultEnglish: true, queryLanguages: true, languageSwitch: true, assets: assets.length, chapters: true, gallery: true, openingPlayback: true, errors }));
  window.destroy(); app.quit();
}
