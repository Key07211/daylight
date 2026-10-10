// Run after npm run build: electron desktop/project-filter-smoke.cjs
// Uses synthetic tasks, an isolated profile and port, with no real MCP or jobs.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtime, 'project-filter-'));
app.setPath('userData', profile);
const report = { isolated: true, checks: [], externalRequests: 0 };
let service, window, origin, token;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Project filter smoke timed out.'); app.exit(1); }, 90000);
deadline.unref();
const evaluate = source => window.webContents.executeJavaScript(source, true);
async function until(source, label) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (await evaluate(source)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function check(label, source) {
  assert.ok(await evaluate(source), label);
  report.checks.push(label);
}
async function click(selector) {
  await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    node.click();
  })()`);
}
async function setField(selector, value) {
  await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('Missing field: ' + ${JSON.stringify(selector)});
    node.focus();
    const select = node.tagName === 'SELECT';
    Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')
      .set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }));
  })()`);
}
async function request(route, method = 'GET', value) {
  const response = await fetch(`${origin}/api${route}`, { method,
    headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': token },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.ok(response.ok, `${method} ${route}: ${response.status}`);
  return response.json();
}
async function rows(label, expected) {
  const ids = expected.map(task => task.id).sort();
  await until(`JSON.stringify([...document.querySelectorAll('.task-row')].map(row => row.dataset.taskId).sort()) === ${JSON.stringify(JSON.stringify(ids))}`, label);
  await check(`${label}: task count`, `document.querySelector('.item-count').textContent.trim().startsWith(${JSON.stringify(String(ids.length) + ' ')})`);
}
async function capture(name) {
  await pause(250);
  fs.writeFileSync(path.join(runtime, `project-filter-${name}.png`), (await window.webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  const { createApp } = await import(pathToFileURL(path.join(root, 'server', 'app.mjs')));
  service = await createApp({ dataDir: path.join(profile, 'data'), distDir: path.join(root, 'dist'),
    codexInfo: { available: false }, startScheduler: false,
    weatherFetch: async () => { throw new Error('Weather networking disabled in project filter smoke.'); } });
  origin = await service.listen(0);
  const initial = await request('/bootstrap');
  assert.equal(initial.tasks.length, 0);
  token = initial.csrfToken;
  const alpha = await request('/projects', 'POST', { name: 'Alpha project', color: '#668a76' });
  const beta = await request('/projects', 'POST', { name: 'Beta project', color: '#9a7599' });
  const empty = await request('/projects', 'POST', { name: 'Empty project', color: '#6786aa' });
  const due = days => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(18, 0, 0, 0); return date.toISOString(); };
  const aToday = await request('/tasks', 'POST', { title: 'Alpha today', projectId: alpha.id, priority: 'high', dueAt: due(0) });
  const aLater = await request('/tasks', 'POST', { title: 'Alpha later', projectId: alpha.id, priority: 'low', dueAt: due(1) });
  const aDone = await request('/tasks', 'POST', { title: 'Alpha complete', projectId: alpha.id, completed: true, dueAt: due(0) });
  const bToday = await request('/tasks', 'POST', { title: 'Beta today', projectId: beta.id, priority: 'medium', dueAt: due(0) });
  const gToday = await request('/tasks', 'POST', { title: 'General today', priority: 'high', dueAt: due(0) });
  const gLater = await request('/tasks', 'POST', { title: 'General later', priority: 'low', dueAt: due(1) });
  const orphan = await request('/tasks', 'POST', { title: 'Orphaned project', dueAt: due(0) });
  // Simulate an older local store that still refers to a removed project.
  service.store.data.tasks.find(task => task.id === orphan.id).projectId = 'removed-project';
  service.store.save();
  const active = [aToday, aLater, bToday, gToday, gLater, orphan];
  window = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/.test(details.url) && new URL(details.url).origin !== origin) {
      report.externalRequests++; return callback({ cancel: true });
    }
    callback({});
  });
  await window.loadURL('about:blank');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Page.enable');
  await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (location.origin === ${JSON.stringify(origin)}) {
      localStorage.setItem('daylight-language', 'en');
      window.daylightDesktop = Object.freeze({
        claimStartup: async () => false,
        getInfo: async () => ({ version: 'Isolated project filter check', autoLaunch: false, alwaysOnTop: false }),
        setTheme: async () => ({}),
        getMcpStatus: async () => ({ state: 'disabled', autoConnect: false, canConfigure: false, registered: false }),
        onMcpStatus: () => () => {}
      });
    }
  ` });
  await window.loadURL(origin);
  await until(`!!document.querySelector('#task-project-filter') && !document.querySelector('.app-shell').inert`, 'app ready');
  await click('[data-view="all"]');
  await rows('All projects', active);
  await check('English options and accessible name', `document.querySelector('#task-project-filter').getAttribute('aria-label') === 'Filter by project' && document.querySelector('#task-project-filter option[value="general"]').textContent === 'General'`);
  await setField('#task-project-filter', alpha.id);
  await rows('Alpha project', [aToday, aLater]);
  await setField('.search-wrap input', 'today');
  await rows('Project plus search', [aToday]);
  await click('[aria-controls="task-filters"]');
  await setField('.filter-bar select', 'low');
  await rows('Project plus search plus priority empty', []);
  await setField('#task-project-filter', beta.id);
  await rows('Selector available during empty results', []);
  await check('Project selector retains focus across results', `document.activeElement.id === 'task-project-filter'`);
  await setField('.filter-bar select', 'all');
  await rows('Search and priority remain combined', [bToday]);
  await setField('.search-wrap input', '');
  await setField('#task-project-filter', 'general');
  await rows('General includes unassigned and orphaned tasks', [gToday, gLater, orphan]);
  await check('General task labels', `[...document.querySelectorAll('.task-project-label')].every(label => label.textContent.trim() === 'General')`);
  await setField('#task-project-filter', empty.id);
  await rows('Empty project stays selectable', []);
  await setField('#task-project-filter', 'all');
  await rows('Reset from empty project', active);
  await setField('#task-project-filter', alpha.id);
  await click('.page-heading .primary');
  await until(`!!document.querySelector('.task-form')`, 'new-task editor');
  await check('New task inherits filtered project', `document.querySelector('.task-form select').value === ${JSON.stringify(alpha.id)}`);
  await click('[aria-label="Close"]');
  await click('[data-view="completed"]');
  await rows('Completed navigation resets project filter', [aDone]);
  await check('Navigation resets selection', `document.querySelector('#task-project-filter').value === 'all'`);
  await setField('#task-project-filter', beta.id);
  await rows('Completed plus project empty', []);
  await setField('#task-project-filter', alpha.id);
  await rows('Completed plus project', [aDone]);
  await click('[data-view="today"]');
  await setField('#task-project-filter', 'general');
  await rows('Today plus General', [gToday, orphan]);
  await click('[data-view="upcoming"]');
  await setField('#task-project-filter', 'general');
  await rows('Upcoming plus General', [gLater]);
  await click('[data-language="zh"]');
  await check('Chinese filter labels', `document.querySelector('#task-project-filter').getAttribute('aria-label') === '按项目筛选' && document.querySelector('#task-project-filter option[value="general"]').textContent === '常规' && document.querySelector('.task-project-label').textContent.trim() === '常规'`);
  await click('[data-language="en"]');
  await evaluate(`[...document.querySelectorAll('.project-nav button')].find(button => button.textContent.includes('Beta project')).click()`);
  await rows('Sidebar project navigation', [bToday]);
  await check('Sidebar and selector agree', `document.querySelector('#task-project-filter').value === ${JSON.stringify(beta.id)}`);
  await setField('#task-project-filter', 'general');
  await rows('Changing sidebar project to General', [gToday, gLater, orphan]);
  await check('Sidebar switch returns to All tasks', `document.querySelector('[data-view="all"]').getAttribute('aria-current') === 'page'`);
  await setField('#task-project-filter', alpha.id);
  await request(`/projects/${alpha.id}`, 'DELETE');
  await until(`document.querySelector('#task-project-filter').value === 'all'`, 'deleted filter resets after polling');
  await rows('Deleted project recovers All tasks', active);
  await setField('#task-project-filter', 'general');
  await rows('Deleted project tasks move to General', [aToday, aLater, gToday, gLater, orphan]);
  await evaluate(`[...document.querySelectorAll('.project-nav button')].find(button => button.textContent.includes('Beta project')).click()`);
  await request(`/projects/${beta.id}`, 'DELETE');
  await until(`document.querySelector('[data-view="all"]').getAttribute('aria-current') === 'page'`, 'deleted sidebar project resets after polling');
  await rows('Deleted sidebar project recovers All tasks', active);
  await capture('desktop');
  await click('.theme-toggle');
  await pause(700);
  await capture('alternate-theme');
  window.setContentSize(440, 900);
  await pause(300);
  await check('Project control fits narrow window', `(() => {const box=document.querySelector('#task-project-filter').getBoundingClientRect();return box.left >= 0 && box.right <= innerWidth;})()`);
  await capture('narrow');
  assert.equal(service.store.data.runs.length, 0);
  assert.equal(report.externalRequests, 0);
  report.checks.push('No jobs or external requests');
  report.pass = true;
}).catch(error => {
  report.pass = false;
  report.error = error.stack;
  console.error(error.stack);
}).finally(async () => {
  clearTimeout(deadline);
  if (window && !window.isDestroyed()) window.destroy();
  if (service) await service.close();
  // Chromium can hold the profile open until process exit on Windows. Keep this
  // isolated profile in ignored .runtime, just like the other capture checks.
  fs.writeFileSync(path.join(runtime, 'project-filter-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, externalRequests: report.externalRequests }));
  app.exit(report.pass ? 0 : 1);
});
