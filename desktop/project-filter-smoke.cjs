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
async function key(keyCode) {
  // Electron input key codes use Down/Up rather than the DOM ArrowDown/ArrowUp.
  const nativeKey = { ArrowDown: 'Down', ArrowUp: 'Up' }[keyCode] || keyCode;
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: nativeKey });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: nativeKey });
  await pause(30);
}
async function openProjects() {
  if (!await evaluate(`document.querySelector('#task-project-filter').getAttribute('aria-expanded') === 'true'`)) {
    await click('#task-project-filter');
  }
  await until(`document.querySelector('.project-filter-popover[data-open="true"]') && getComputedStyle(document.querySelector('.project-filter-popover')).visibility !== 'hidden'`, 'project menu visible');
  await pause(60); // Let React install outside-focus listeners after the opening paint.
}
async function closedProjects() {
  await until(`document.querySelector('#task-project-filter').getAttribute('aria-expanded') === 'false' && !document.querySelector('.project-filter-popover')`, 'project menu dismissed');
}
async function setProject(value) {
  await openProjects();
  await click(`[data-project-option="${value}"]`);
  await closedProjects();
  await check(`Project selection ${value}: focus restored`, `document.activeElement.id === 'task-project-filter'`);
}
async function highlighted(value) {
  await until(`(() => { const trigger = document.querySelector('#task-project-filter'); const active = document.getElementById(trigger.getAttribute('aria-activedescendant')); return active?.dataset.projectOption === ${JSON.stringify(value)} && active.dataset.highlighted === 'true'; })()`, `highlight ${value}`);
}
async function menuFits(label) {
  await pause(260);
  await check(label, `(() => { const box=document.querySelector('.project-filter-popover').getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; })()`);
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
  const empty = await request('/projects', 'POST', { name: 'Empty project with a deliberately long name for a narrow window', color: '#6786aa' });
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
  await openProjects();
  await check('English options and accessible name', `document.querySelector('#task-project-filter').getAttribute('aria-label') === 'Filter by project' && document.querySelector('[data-project-option="general"] .project-filter-option-name').textContent === 'General'`);
  await check('Accessible combobox/listbox relationship', `(() => { const trigger=document.querySelector('#task-project-filter'); const list=document.getElementById(trigger.getAttribute('aria-controls')); return trigger.getAttribute('role') === 'combobox' && list?.getAttribute('role') === 'listbox' && list.querySelectorAll('[role="option"]').length === 5 && list.querySelectorAll('[aria-selected="true"]').length === 1; })()`);
  await key('Escape');
  await closedProjects();
  await check('Escape restores focus without selecting', `document.activeElement.id === 'task-project-filter' && document.activeElement.value === 'all'`);
  await key('ArrowDown');
  await highlighted('all');
  await key('ArrowDown');
  await highlighted('general');
  await key('ArrowDown');
  await highlighted(alpha.id);
  await check('Keyboard highlight does not prematurely filter', `document.querySelector('#task-project-filter').value === 'all' && document.querySelectorAll('.task-row').length === ${active.length}`);
  await key('Enter');
  await closedProjects();
  await rows('Alpha project', [aToday, aLater]);
  await key('Space');
  await highlighted(alpha.id);
  await key('End');
  await highlighted(empty.id);
  await key('Home');
  await highlighted('all');
  await key('ArrowUp');
  await highlighted(empty.id);
  await key('Escape');
  await closedProjects();
  await check('Home End and wrapping do not commit on Escape', `document.querySelector('#task-project-filter').value === ${JSON.stringify(alpha.id)}`);
  await key('b');
  await highlighted(beta.id);
  await key('Escape');
  await closedProjects();
  await openProjects();
  await evaluate(`document.querySelector('.page-heading').dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerType:'mouse', button:0 }))`);
  await closedProjects();
  await check('Outside click closes without changing selection', `document.querySelector('#task-project-filter').value === ${JSON.stringify(alpha.id)}`);
  await openProjects();
  // Hidden offscreen windows change activeElement without emitting focusin.
  await evaluate(`(() => { const input=document.querySelector('.search-wrap input'); input.focus(); input.dispatchEvent(new FocusEvent('focusin', {bubbles:true})); })()`);
  await closedProjects();
  await check('Moving focus outside preserves new focus', `document.activeElement.matches('.search-wrap input')`);
  await openProjects();
  await key('Tab');
  await closedProjects();
  await check('Tab dismisses and leaves the trigger', `document.activeElement.id !== 'task-project-filter'`);
  await openProjects();
  await check('Project colors remain distinct in the menu', `(() => { const a=document.querySelector('[data-project-option="${alpha.id}"]'), b=document.querySelector('[data-project-option="${beta.id}"]'); return getComputedStyle(a).getPropertyValue('--project-accent').trim() === '#668a76' && getComputedStyle(b).getPropertyValue('--project-accent').trim() === '#9a7599' && getComputedStyle(a.querySelector('.project-filter-mark')).backgroundColor !== getComputedStyle(b.querySelector('.project-filter-mark')).backgroundColor; })()`);
  await check('Selected option has its own visible surface', `getComputedStyle(document.querySelector('[data-project-option="${alpha.id}"]')).backgroundImage !== getComputedStyle(document.querySelector('[data-project-option="${beta.id}"]')).backgroundImage`);
  await menuFits('Project menu fits desktop viewport');
  await capture('desktop-menu');
  await key('Escape');
  await closedProjects();
  await setField('.search-wrap input', 'today');
  await rows('Project plus search', [aToday]);
  await click('[aria-controls="task-filters"]');
  await setField('.filter-bar select', 'low');
  await rows('Project plus search plus priority empty', []);
  await setProject(beta.id);
  await rows('Selector available during empty results', []);
  await check('Project selector retains focus across results', `document.activeElement.id === 'task-project-filter'`);
  await setField('.filter-bar select', 'all');
  await rows('Search and priority remain combined', [bToday]);
  await setField('.search-wrap input', '');
  await setProject('general');
  await rows('General includes unassigned and orphaned tasks', [gToday, gLater, orphan]);
  await check('General task labels', `[...document.querySelectorAll('.task-project-label')].every(label => label.textContent.trim() === 'General')`);
  await setProject(empty.id);
  await rows('Empty project stays selectable', []);
  await setProject('all');
  await rows('Reset from empty project', active);
  await setProject(alpha.id);
  await click('.page-heading .primary');
  await until(`!!document.querySelector('.task-form')`, 'new-task editor');
  await check('New task inherits filtered project', `document.querySelector('.task-form select').value === ${JSON.stringify(alpha.id)}`);
  await click('[aria-label="Close"]');
  await until(`!document.querySelector('.modal')`, 'task editor exit and focus restoration');
  await click('[data-view="completed"]');
  await rows('Completed navigation resets project filter', [aDone]);
  await check('Navigation resets selection', `document.querySelector('#task-project-filter').value === 'all'`);
  await setProject(beta.id);
  await rows('Completed plus project empty', []);
  await setProject(alpha.id);
  await rows('Completed plus project', [aDone]);
  await click('[data-view="today"]');
  await setProject('general');
  await rows('Today plus General', [gToday, orphan]);
  await click('[data-view="upcoming"]');
  await setProject('general');
  await rows('Upcoming plus General', [gLater]);
  await click('[data-language="zh"]');
  await openProjects();
  await check('Chinese filter labels', `document.querySelector('#task-project-filter').getAttribute('aria-label') === '按项目筛选' && document.querySelector('[data-project-option="general"] .project-filter-option-name').textContent === '常规' && document.querySelector('.task-project-label').textContent.trim() === '常规'`);
  await key('Escape');
  await closedProjects();
  await click('[data-language="en"]');
  await evaluate(`[...document.querySelectorAll('.project-nav button')].find(button => button.textContent.includes('Beta project')).click()`);
  await rows('Sidebar project navigation', [bToday]);
  await check('Sidebar and selector agree', `document.querySelector('#task-project-filter').value === ${JSON.stringify(beta.id)}`);
  await setProject('general');
  await rows('Changing sidebar project to General', [gToday, gLater, orphan]);
  await check('Sidebar switch returns to All tasks', `document.querySelector('[data-view="all"]').getAttribute('aria-current') === 'page'`);
  await setProject(alpha.id);
  await request(`/projects/${alpha.id}`, 'DELETE');
  await until(`document.querySelector('#task-project-filter').value === 'all'`, 'deleted filter resets after polling');
  await rows('Deleted project recovers All tasks', active);
  await setProject('general');
  await rows('Deleted project tasks move to General', [aToday, aLater, gToday, gLater, orphan]);
  await evaluate(`[...document.querySelectorAll('.project-nav button')].find(button => button.textContent.includes('Beta project')).click()`);
  await request(`/projects/${beta.id}`, 'DELETE');
  await until(`document.querySelector('[data-view="all"]').getAttribute('aria-current') === 'page'`, 'deleted sidebar project resets after polling');
  await rows('Deleted sidebar project recovers All tasks', active);
  await capture('desktop');
  await openProjects();
  const originalTheme = await evaluate(`document.documentElement.dataset.theme`);
  const originalSurface = await evaluate(`getComputedStyle(document.querySelector('.project-filter-popover')).backgroundImage`);
  await key('Escape');
  await closedProjects();
  await click('.theme-toggle');
  await until(`document.documentElement.dataset.theme !== ${JSON.stringify(originalTheme)} && document.documentElement.dataset.themeTransition !== 'running'`, 'alternate theme settled');
  await openProjects();
  await check('Glass menu adapts to the active theme', `getComputedStyle(document.querySelector('.project-filter-popover')).backgroundImage !== ${JSON.stringify(originalSurface)}`);
  await capture('alternate-theme');
  await key('Escape');
  await closedProjects();
  await evaluate(`document.documentElement.dataset.glassMotion = 'off'`);
  await openProjects();
  await check('App motion preference disables menu and label animation', `['.project-filter-popover','.project-filter-label','.project-filter-option'].every(selector => { const style=getComputedStyle(document.querySelector(selector)); return style.animationName === 'none' && style.transitionDuration.split(',').every(duration => parseFloat(duration) === 0); })`);
  await key('Escape');
  await closedProjects();
  await evaluate(`document.documentElement.dataset.glassMotion = 'on'`);
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await openProjects();
  await check('Operating system reduced-motion preference is respected', `matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('.project-filter-popover')).animationName === 'none' && getComputedStyle(document.querySelector('.project-filter-trigger')).transitionDuration.split(',').every(duration => parseFloat(duration) === 0)`);
  await key('Escape');
  await closedProjects();
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  window.setContentSize(440, 900);
  await pause(300);
  await check('Project control fits narrow window', `(() => {const box=document.querySelector('#task-project-filter').getBoundingClientRect();return box.left >= 0 && box.right <= innerWidth;})()`);
  await setProject(empty.id);
  await openProjects();
  await menuFits('Long project name and menu fit narrow viewport');
  await check('Long project name does not cause horizontal overflow', `document.documentElement.scrollWidth <= innerWidth && document.querySelector('.project-filter-options').scrollWidth <= document.querySelector('.project-filter-options').clientWidth`);
  await capture('narrow');
  await key('Escape');
  await closedProjects();
  window.setContentSize(960, 410);
  await pause(300);
  await openProjects();
  await menuFits('Project menu stays within short viewport');
  await key('End');
  await highlighted(empty.id);
  await check('Keyboard highlight remains visible in short menu', `(() => { const option=document.querySelector('[data-project-option="${empty.id}"]').getBoundingClientRect(), list=document.querySelector('.project-filter-options').getBoundingClientRect(); return option.top >= list.top - 1 && option.bottom <= list.bottom + 1; })()`);
  await key('Escape');
  await closedProjects();
  assert.equal(service.store.data.runs.length, 0);
  assert.equal(report.externalRequests, 0);
  report.checks.push('No jobs or external requests');
  report.pass = true;
}).catch(async error => {
  report.pass = false;
  report.error = error.stack;
  if (window && !window.isDestroyed()) {
    report.uiAtFailure = await evaluate(`({activeElement:document.activeElement?.outerHTML,trigger:document.querySelector('#task-project-filter')?.outerHTML,popover:document.querySelector('.project-filter-popover')?.outerHTML})`).catch(() => null);
    await capture('failure').catch(() => {});
  }
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
