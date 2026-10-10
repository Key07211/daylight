// Isolated UI contract test. No update downloads, installers, real app data or MCP calls.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtime, 'update-ui-'));
app.setPath('userData', profile);
const report = { isolated: true, checks: [], externalRequests: 0 };
let window;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = source => window.webContents.executeJavaScript(source, true);
const deadline = setTimeout(() => { console.error('Update UI smoke timed out.'); app.exit(1); }, 60000);
deadline.unref();
async function until(source, label) {
  for (let n = 0; n < 120; n++) {
    if (await evaluate(source)) return;
    await pause(25);
  }
  throw new Error(`Timed out: ${label}`);
}
async function check(label, source) {
  assert.ok(await evaluate(source), label);
  report.checks.push(label);
}
async function click(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); node.click(); })()`);
  await pause(35);
}
async function emit(state, extra = {}) {
  await evaluate(`window.sendStatus(${JSON.stringify({ state, ...extra })})`);
  await pause(35);
}

esbuild.buildSync({ absWorkingDir: root, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(profile, 'fixture.js'),
  stdin: { resolveDir: root, sourcefile: 'update-ui-fixture.jsx', loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { I18nProvider, useI18n } from './src/i18n.jsx';
    import { useAppUpdate, UpdateIndicator, UpdateSettings } from './src/UpdateControl.jsx';
    import './src/styles.css';
    import './src/liquid-material.css';
    localStorage.setItem('daylight-language', 'en');
    window.calls = { check: 0, download: 0 };
    const subscribers = new Set();
    let snapshot = { state: 'current', mode: 'installed', currentVersion: '0.3.0', revision: 1 };
    window.sendStatus = value => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, ...value };
      for (const listener of subscribers) listener(snapshot);
    };
    window.daylightDesktop = {
      getUpdateStatus: async () => snapshot,
      onUpdateStatus: callback => { subscribers.add(callback); return () => subscribers.delete(callback); },
      checkForUpdates: async () => { window.calls.check++; window.sendStatus({ state: 'checking' }); return snapshot; },
      downloadUpdate: async () => { window.calls.download++; window.sendStatus({ state: snapshot.mode === 'portable' ? 'available' : 'downloading', progress: { percent: 22.4 } }); return snapshot; },
    };
    function Fixture() {
      const update = useAppUpdate();
      const { setLang } = useI18n();
      return <main style={{ padding: 20 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button id="pin" className="window-pin">Pin</button><UpdateIndicator update={update} />
        </header>
        <div className="settings-body"><UpdateSettings update={update} /></div>
        <button id="english" onClick={() => setLang('en')}>English</button>
        <button id="chinese" onClick={() => setLang('zh')}>中文</button>
      </main>;
    }
    const root = createRoot(document.getElementById('root'));
    let generation = 0;
    window.mountFixture = () => root.render(<I18nProvider key={generation++}><Fixture /></I18nProvider>);
    window.mountFixture();
  ` }, logLevel: 'silent' });
fs.writeFileSync(path.join(profile, 'fixture.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 640, height: 680, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/.test(details.url)) { report.externalRequests++; callback({ cancel: true }); }
    else callback({});
  });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  await window.loadFile(path.join(profile, 'fixture.html'));
  await until(`document.querySelector('[data-testid="update-settings"][data-state="current"]')`, 'initial native status');
  await check('No automatic download or duplicate check from React', 'window.calls.check === 0 && window.calls.download === 0');
  await check('Current version hides indicator', '!document.querySelector(".update-indicator")');
  await check('Settings displays current version and status', 'document.body.textContent.includes("0.3.0") && document.body.textContent.includes("You’re up to date")');
  await emit('available', { version: '0.4.0', releaseNotes: 'Improved glass effects.\n<img src=x onerror=alert(1)>' });
  await check('Available update displays blue indicator to the right of Pin', `document.querySelector('.update-indicator').getBoundingClientRect().left >= document.querySelector('#pin').getBoundingClientRect().right`);
  await click('.update-indicator');
  await check('Open popover has accessible title and expanded trigger', `document.querySelector('[role="dialog"]').getAttribute('aria-labelledby') && document.querySelector('.update-indicator').getAttribute('aria-expanded') === 'true'`);
  await check('Release notes render as text only', `document.querySelector('.update-release-notes').textContent.includes('<img') && !document.querySelector('.update-release-notes img')`);
  await check('Immediate restart consent is explicit', `document.querySelector('.update-popover [data-update-action="download"]').textContent.includes('Download & restart immediately')`);
  await check('Opening indicator does not start download', 'window.calls.download === 0');
  await click('.update-popover [data-update-action="download"]');
  await check('Click starts one download and displays progress', `window.calls.download === 1 && document.querySelector('.update-popover [role="progressbar"]').getAttribute('aria-valuenow') === '22'`);
  await emit('downloading', { progress: { percent: 65 }, revision: 20 });
  await emit('available', { revision: 19 });
  await check('Stale event cannot roll back download progress', `document.querySelector('.update-indicator').dataset.state === 'downloading' && document.querySelector('.update-popover [role="progressbar"]').getAttribute('aria-valuenow') === '65'`);
  await emit('waiting', { reasons: ['editing', 'running'], revision: 21 });
  await check('Waiting explains saved edits and active tasks', `document.querySelector('.update-popover').textContent.includes('Save or close your edit and let the active task finish')`);
  await emit('installing');
  await check('Ready status immediately says restarting, with no countdown or confirmation', `document.querySelector('.update-popover').textContent.includes('Restarting to install') && !document.querySelector('.update-popover [data-update-action]')`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pause(35);
  await check('Escape closes popover and restores trigger focus', `!document.querySelector('.update-popover') && document.activeElement.matches('.update-indicator')`);
  await emit('error', { errorCode: 'download' });
  await click('.update-indicator');
  await check('Failed download is retryable', `document.querySelector('.update-popover').textContent.includes('Download did not finish') && !!document.querySelector('.update-popover [data-update-action="download"]')`);
  await click('.update-popover [data-update-action="download"]');
  await check('Retry invokes download only on user click', 'window.calls.download === 2');
  await emit('error', { errorCode: 'install_failed' });
  await check('Installation failure offers installation retry without claiming another download', `document.querySelector('.update-popover').textContent.includes('Installation did not finish') && document.querySelector('.update-popover [data-update-action="download"]').textContent.includes('Retry install & restart')`);
  await click('#chinese');
  await click('.update-indicator');
  await check('Chinese installation failure and retry are explicit', `document.querySelector('.update-popover').textContent.includes('安装未完成') && document.querySelector('.update-popover [data-update-action="download"]').textContent.includes('重试安装并重启')`);
  await click('#english');
  await click('.update-indicator');
  await emit('error', { errorCode: 'check', version: null });
  await check('Offline check failure without an available version hides the blue indicator', `!document.querySelector('.update-indicator') && !document.querySelector('.update-popover') && document.querySelector('.update-settings').textContent.includes('Updates are unavailable')`);
  await click('.update-settings [data-update-action="check"]');
  await check('Check failure offers native recheck', 'window.calls.check === 1');
  await emit('available', { mode: 'portable', version: '0.4.0', releaseNotes: 'Small refinements.' });
  await click('.update-indicator');
  await check('Portable mode explains manual replacement', `document.querySelector('.update-popover').textContent.includes('replace the portable app manually') && document.querySelector('.update-popover [data-update-action="download"]').textContent.includes('Download portable version')`);
  await click('.update-popover [data-update-action="download"]');
  await check('Portable click delegates native download page', 'window.calls.download === 3');
  await click('#chinese');
  await click('.update-indicator');
  await check('Chinese controls translate', `document.querySelector('.update-popover').textContent.includes('下载便携版') && document.querySelector('.update-settings').textContent.includes('检查更新')`);
  await emit('available', { mode: 'installed' });
  await check('Chinese immediate restart action translates', `document.querySelector('.update-popover [data-update-action="download"]').textContent.includes('下载并立即重启')`);
  await evaluate(`document.documentElement.dataset.theme = 'night'`);
  await pause(200);
  fs.writeFileSync(path.join(runtime, 'update-ui-night.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(390, 640);
  await pause(200);
  await check('Popover stays inside narrow viewport', `(() => { const box = document.querySelector('.update-popover').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; })()`);
  fs.writeFileSync(path.join(runtime, 'update-ui-mobile.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await pause(35);
  await check('Outside click closes popover', '!document.querySelector(".update-popover")');
  await emit('disabled', { mode: 'disabled' });
  await check('Development builds hide indicator and disable manual check', `!document.querySelector('.update-indicator') && document.querySelector('.update-settings [data-update-action="check"]').disabled`);
  await evaluate('delete window.daylightDesktop; window.mountFixture()');
  await pause(60);
  await check('Web previews hide native update controls', `!document.querySelector('.update-indicator') && !document.querySelector('.update-settings')`);
  assert.equal(report.externalRequests, 0);
  assert.deepEqual(errors, []);
  report.errors = errors;
  fs.writeFileSync(path.join(runtime, 'update-ui-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  clearTimeout(deadline);
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
