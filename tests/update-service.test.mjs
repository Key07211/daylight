import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createDesktopUpdates } = require('../desktop/update-service.cjs');
const installedOnly = { skip: process.platform !== 'win32' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await pause(10);
  }
  assert.fail(`Timed out: ${label}`);
}

function fixture(t, options = {}) {
  const previousPortable = process.env.PORTABLE_EXECUTABLE_DIR;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  const calls = { checks: 0, downloads: 0, installs: [], external: [], events: [], trace: [] };
  const info = { version: '0.4.0', releaseNotes: 'Update service test' };
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { calls.checks++; return { updateInfo: info }; };
  updater.downloadUpdate = async () => { calls.downloads++; updater.emit('update-downloaded', info); return ['isolated-installer']; };
  updater.quitAndInstall = (...args) => { calls.installs.push(args); calls.trace.push('install'); };
  const document = { documentElement: { dataset: { updateBusy: 'false' } }, body: { inert: false } };
  const renderer = { present: true, destroyed: false, rejectPrepare: false };
  const window = {
    isDestroyed: () => renderer.destroyed,
    webContents: {
      send: (channel, status) => calls.events.push({ channel, status }),
      executeJavaScript: async source => {
        const preparing = source.includes('document.body.inert = true');
        calls.trace.push(preparing ? 'renderer:prepare' : 'renderer:release');
        if (preparing && renderer.rejectPrepare) throw new Error('Renderer is navigating');
        return vm.runInNewContext(source, { document });
      },
    },
  };
  const service = {
    scheduler: { activeRun: null }, updatePending: false, bridges: 0,
    setUpdatePending(value) { this.updatePending = value; calls.trace.push(`gate:${value}`); },
    get pendingUpdateBridges() { return this.bridges; },
  };
  const mcp = { checking: false };
  const updates = createDesktopUpdates({
    app: { isPackaged: true, getVersion: () => '0.3.0' },
    shell: { openExternal: async url => calls.external.push(url) },
    getWindow: () => renderer.present ? window : null,
    service, updater, getMcpStatus: () => mcp, ...options,
  });
  t.after(() => {
    service.bridges = 0;
    updates.dispose();
    if (previousPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = previousPortable;
  });
  return { updates, updater, service, calls, document, renderer, mcp };
}

test('smoke and development services cannot check, download or install updates', async t => {
  for (const options of [{ smoke: true }, { app: { isPackaged: false, getVersion: () => '0.3.0' } }]) {
    const { updates, updater, calls, service } = fixture(t, options);
    updates.start();
    updates.setEditing(false);
    await updates.check();
    await updates.download();
    await updates.resume();
    assert.equal(updates.getStatus().state, 'disabled');
    assert.equal(updates.getStatus().mode, 'disabled');
    assert.equal(calls.checks, 0);
    assert.equal(calls.downloads, 0);
    assert.deepEqual(calls.installs, []);
    assert.equal(service.updatePending, false);
    assert.equal(updater.eventNames().length, 0);
    updates.dispose();
  }
});

test('setEditing only accepts booleans and defaults to blocking until renderer reports readiness', installedOnly, async t => {
  const { updates, calls, service } = fixture(t);
  for (const value of [undefined, null, 0, 1, 'false', {}, []]) {
    assert.throws(() => updates.setEditing(value), TypeError);
  }
  await updates.check();
  await updates.download();
  assert.deepEqual(updates.getStatus().reasons, ['editing']);
  assert.equal(updates.getStatus().state, 'waiting');
  assert.equal(service.updatePending, false);
  assert.equal(calls.installs.length, 0);
  updates.setEditing(false);
  await updates.resume();
  assert.deepEqual(calls.installs, [[true, true]], 'Ready updates install silently and force relaunch immediately');
});

test('the real DOM busy flag defeats a stale editing IPC and releases the API gate', installedOnly, async t => {
  const { updates, calls, service, document } = fixture(t);
  updates.setEditing(false);
  document.documentElement.dataset.updateBusy = 'true';
  await updates.check();
  await updates.download();
  assert.deepEqual(updates.getStatus().reasons, ['editing']);
  assert.equal(updates.getStatus().state, 'waiting');
  assert.equal(calls.installs.length, 0);
  assert.equal(service.updatePending, false);
  assert.equal(document.body.inert, false);
  assert.equal(updates.isPreparing(), false);
  assert.deepEqual(calls.trace, ['gate:true', 'renderer:prepare', 'gate:false', 'renderer:release']);
  document.documentElement.dataset.updateBusy = 'false';
  updates.setEditing(false);
  await updates.resume();
  assert.equal(calls.installs.length, 1);
  assert.equal(calls.downloads, 1, 'A ready cached update does not download again');
});

test('a missing renderer busy flag fails closed instead of installing', installedOnly, async t => {
  const { updates, calls, document, service } = fixture(t);
  updates.setEditing(false);
  delete document.documentElement.dataset.updateBusy;
  await updates.check();
  await updates.download();
  assert.equal(calls.installs.length, 0);
  assert.deepEqual(updates.getStatus().reasons, ['editing']);
  assert.equal(service.updatePending, false);
});

test('installation waits for every MCP bridge lease after freezing UI and API writes', installedOnly, async t => {
  const { updates, calls, service, document, updater } = fixture(t);
  assert.equal(updater.disableWebInstaller, true);
  assert.equal(updater.autoRunAppAfterInstall, true);
  updates.setEditing(false);
  service.bridges = 2;
  await updates.check();
  const download = updates.download();
  await until(() => document.body.inert, 'renderer frozen while bridges release');
  assert.equal(service.updatePending, true);
  assert.equal(updates.isPreparing(), true);
  assert.equal(calls.installs.length, 0);
  service.bridges = 1;
  await pause(130);
  assert.equal(calls.installs.length, 0, 'One remaining bridge is sufficient to block installation');
  service.bridges = 0;
  await download;
  assert.deepEqual(calls.installs, [[true, true]]);
  assert.equal(updates.getStatus().state, 'installing');
  assert.equal(calls.trace.indexOf('gate:true') < calls.trace.indexOf('renderer:prepare'), true);
  assert.equal(calls.trace.indexOf('renderer:prepare') < calls.trace.indexOf('install'), true);
});

test('renderer navigation while leases drain cancels preparation and unfreezes the surviving UI', installedOnly, async t => {
  const { updates, calls, service, document } = fixture(t);
  updates.setEditing(false);
  service.bridges = 1;
  await updates.check();
  const download = updates.download();
  await until(() => document.body.inert, 'preparation before navigation');
  updates.rendererLoading();
  service.bridges = 0;
  await download;
  assert.equal(calls.installs.length, 0);
  assert.equal(updates.isPreparing(), false);
  assert.equal(service.updatePending, false);
  assert.equal(document.body.inert, false);
  assert.deepEqual(updates.getStatus().reasons, ['editing']);
});

test('active Codex work and MCP connection checks block installation before freezing UI', installedOnly, async t => {
  const { updates, calls, service, document, mcp } = fixture(t);
  updates.setEditing(false);
  service.scheduler.activeRun = { id: 'isolated-run' };
  mcp.checking = true;
  await updates.check();
  await updates.download();
  assert.deepEqual(updates.getStatus().reasons, ['running', 'mcp']);
  assert.equal(calls.installs.length, 0);
  assert.equal(service.updatePending, false);
  assert.equal(document.body.inert, false);
  service.scheduler.activeRun = null;
  mcp.checking = false;
  await updates.resume();
  assert.equal(calls.installs.length, 1);
});

test('a renderer execution failure releases the gate and exposes a retryable installation error', installedOnly, async t => {
  const { updates, calls, service, document, renderer } = fixture(t);
  updates.setEditing(false);
  renderer.rejectPrepare = true;
  await updates.check();
  await updates.download();
  await until(() => !service.updatePending, 'gate cleanup after renderer failure');
  assert.equal(updates.getStatus().state, 'error');
  assert.equal(updates.getStatus().errorCode, 'install_failed');
  assert.equal(document.body.inert, false);
  assert.equal(updates.isPreparing(), false);
  assert.equal(calls.installs.length, 0);
  renderer.rejectPrepare = false;
  await updates.download();
  assert.equal(calls.downloads, 1);
  assert.equal(calls.installs.length, 1);
});

test('an installer error unfreezes UI and API writes before a user retries the cached installer', installedOnly, async t => {
  const { updates, updater, calls, service, document } = fixture(t);
  updates.setEditing(false);
  await updates.check();
  await updates.download();
  assert.equal(document.body.inert, true);
  updater.emit('error', new Error('Isolated installer launch failed'));
  await until(() => !document.body.inert && !service.updatePending, 'failed installation cleanup');
  assert.equal(updates.getStatus().errorCode, 'install_failed');
  assert.equal(updates.isPreparing(), false);
  await updates.download();
  assert.equal(calls.downloads, 1);
  assert.equal(calls.installs.length, 2);
});

test('disposal while a bridge holds its lease prevents installation and releases preparation', installedOnly, async t => {
  const { updates, calls, service, document } = fixture(t);
  updates.setEditing(false);
  service.bridges = 1;
  await updates.check();
  const download = updates.download();
  await until(() => document.body.inert, 'preparation before disposal');
  updates.dispose();
  await download;
  assert.equal(calls.installs.length, 0);
  assert.equal(document.body.inert, false);
  assert.equal(service.updatePending, false);
  assert.equal(updates.isPreparing(), false);
});
