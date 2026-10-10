import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdateController } = require('../desktop/update-controller.cjs');
const info = { version: '0.4.0', releaseNotes: '<p>Faster &amp; clearer.</p><script>bad()</script>' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const updater = new EventEmitter();
  const calls = { checks: 0, downloads: 0, installs: 0, prepares: 0, releases: 0, notifications: [] };
  updater.checkForUpdates = async () => { calls.checks += 1; updater.emit('update-available', info); return { updateInfo: info }; };
  updater.downloadUpdate = async () => { calls.downloads += 1; updater.emit('update-downloaded', info); return ['private-installer-path']; };
  const controller = createUpdateController({
    updater, currentVersion: '0.3.0', notify: (status) => calls.notifications.push(status),
    prepareInstall: async () => { calls.prepares += 1; },
    releaseInstall: () => { calls.releases += 1; },
    install: () => { calls.installs += 1; return true; },
    now: () => Date.parse('2026-10-09T12:00:00Z'), ...overrides,
  });
  return { controller, updater, calls };
}

test('checks discover stable updates but never download or install without a click, even from cache', async () => {
  const { controller, updater, calls } = fixture();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  updater.emit('update-downloaded', info);
  await controller.check();
  updater.emit('update-downloaded', info);
  assert.equal(controller.getStatus().state, 'available');
  assert.equal(controller.getStatus().releaseNotes, 'Faster & clearer.');
  assert.equal(controller.getStatus().checkedAt, '2026-10-09T12:00:00.000Z');
  assert.equal(calls.downloads, 0);
  assert.equal(calls.installs, 0);
  controller.dispose();
});

test('one user download installs immediately, without a restart timer, and ignores duplicate or stale events', async () => {
  const { controller, updater, calls } = fixture({ setTimeout: () => { throw new Error('No install delay allowed'); } });
  await controller.check();
  const first = controller.download();
  assert.equal(first, controller.download());
  await first;
  updater.emit('update-downloaded', info);
  updater.emit('download-progress', { percent: 10 });
  updater.emit('update-not-available');
  await controller.resume();
  await controller.download();
  assert.equal(calls.downloads, 1);
  assert.equal(calls.installs, 1);
  assert.equal(controller.getStatus().state, 'installing');
  assert.equal(controller.getStatus().progress.percent, 100);
  controller.dispose();
});

test('editing and running work defer installation; clearing both resumes immediately exactly once', async () => {
  let blockers = ['editing', 'running', 'editing', 'unknown'];
  const { controller, calls } = fixture({ getBlockers: async () => blockers });
  await controller.check();
  await controller.download();
  assert.deepEqual(controller.getStatus().reasons, ['editing', 'running']);
  assert.equal(calls.installs, 0);
  blockers = ['running'];
  await controller.resume();
  assert.deepEqual(controller.getStatus().reasons, ['running']);
  blockers = [];
  await Promise.all([controller.resume(), controller.resume(), controller.check()]);
  assert.equal(calls.installs, 1);
  assert.equal(calls.prepares, 1);
  assert.equal(calls.checks, 1);
  controller.dispose();
});

test('prepareInstall closes the blocker race and releases preparation before trying again', async () => {
  let canPrepare = false;
  const { controller, calls } = fixture({ prepareInstall: async () => canPrepare ? true : { blocked: ['running'] } });
  await controller.check();
  await controller.download();
  assert.equal(controller.getStatus().state, 'waiting');
  assert.deepEqual(controller.getStatus().reasons, ['running']);
  assert.equal(calls.installs, 0);
  assert.equal(calls.releases, 1);
  canPrepare = true;
  await controller.resume();
  assert.equal(calls.installs, 1);
  controller.dispose();
});

test('concurrent checks are coalesced and failed rechecks preserve a known available version', async () => {
  const { controller, updater, calls } = fixture();
  await controller.check();
  const pending = deferred();
  updater.checkForUpdates = () => { calls.checks += 1; return pending.promise; };
  const first = controller.check();
  assert.equal(first, controller.check());
  await tick();
  pending.reject(new Error('C:\\private\\secret-token.json'));
  await first;
  assert.equal(calls.checks, 2);
  assert.equal(controller.getStatus().state, 'error');
  assert.equal(controller.getStatus().version, info.version);
  assert.equal(controller.getStatus().errorCode, 'check_failed');
  assert.ok(!JSON.stringify(controller.getStatus()).includes('private'));
  await controller.download();
  assert.equal(calls.installs, 1);
  controller.dispose();
});

test('download errors allow a manual retry and reject late cached-download events', async () => {
  const { controller, updater, calls } = fixture();
  await controller.check();
  const pending = deferred();
  updater.downloadUpdate = () => { calls.downloads += 1; return pending.promise; };
  const first = controller.download();
  await tick();
  updater.emit('download-progress', { percent: 137, transferred: -1, total: Infinity, bytesPerSecond: NaN });
  assert.deepEqual(controller.getStatus().progress, { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 });
  updater.emit('error', new Error('download failed with private path'));
  updater.emit('update-downloaded', info);
  pending.reject(new Error('network disconnected'));
  await first;
  assert.equal(controller.getStatus().errorCode, 'download_failed');
  assert.equal(calls.installs, 0);
  updater.downloadUpdate = async () => { calls.downloads += 1; updater.emit('update-downloaded', info); };
  await controller.download();
  assert.equal(calls.downloads, 2);
  assert.equal(calls.installs, 1);
  controller.dispose();
});

test('downloaded events for another version cannot install the wrong update', async () => {
  const { controller, updater, calls } = fixture();
  await controller.check();
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '0.2.0' });
  await controller.download();
  assert.equal(controller.getStatus().errorCode, 'download_failed');
  assert.equal(calls.installs, 0);
  controller.dispose();
});

test('install failures release the app, do not loop automatically, and can retry without redownloading', async () => {
  let succeed = false;
  let attempts = 0;
  const { controller, calls } = fixture({ install: () => { attempts += 1; return succeed; } });
  await controller.check();
  await controller.download();
  assert.equal(controller.getStatus().errorCode, 'install_failed');
  assert.equal(calls.releases, 1);
  await controller.resume();
  assert.equal(attempts, 1);
  succeed = true;
  await controller.download();
  assert.equal(attempts, 2);
  assert.equal(calls.downloads, 1);
  assert.equal(controller.getStatus().state, 'installing');
  controller.dispose();
});

test('an asynchronous installer error also releases the app and preserves explicit retry', async () => {
  const { controller, updater, calls } = fixture();
  await controller.check();
  await controller.download();
  updater.emit('error', new Error('installer could not launch'));
  await tick();
  assert.equal(controller.getStatus().errorCode, 'install_failed');
  assert.equal(calls.releases, 1);
  await controller.resume();
  assert.equal(calls.installs, 1);
  await controller.download();
  assert.equal(calls.installs, 2);
  controller.dispose();
});

test('a quick installation retry waits for the previous preparation to be released', async () => {
  const release = deferred();
  let attempts = 0;
  const { controller, calls } = fixture({
    install: () => ++attempts > 1,
    releaseInstall: () => release.promise,
  });
  await controller.check();
  await controller.download();
  const retry = controller.download();
  await tick();
  assert.equal(attempts, 1);
  assert.equal(calls.prepares, 1);
  release.resolve();
  await retry;
  assert.equal(attempts, 2);
  assert.equal(calls.prepares, 2);
  controller.dispose();
});

test('current, older, malformed and prerelease results never expose an installable update', async () => {
  for (const version of ['0.3.0', '0.2.9', '0.4.0-beta.1', 'invalid']) {
    const { controller, updater, calls } = fixture();
    updater.checkForUpdates = async () => ({ updateInfo: { version } });
    await controller.check();
    await controller.download();
    assert.equal(controller.getStatus().state, 'current', version);
    assert.equal(calls.installs, 0, version);
    controller.dispose();
  }
});

test('portable mode checks versions and only opens a download page after a click', async () => {
  let opened = 0;
  const { controller, calls } = fixture({ mode: 'portable', portableCheck: async () => info, openPortable: async (status) => { opened += 1; assert.equal(status.version, info.version); } });
  await controller.check();
  assert.equal(opened, 0);
  await controller.download();
  assert.equal(opened, 1);
  assert.equal(calls.installs, 0);
  assert.equal(calls.downloads, 0);
  controller.dispose();
});

test('automatic startup, six-hour checks and waiting retries are scheduled once and cleaned up', async () => {
  const timeouts = [];
  const intervals = [];
  const cleared = [];
  const { controller, updater, calls } = fixture({
    setTimeout: (fn, delay) => { const id = { fn, delay }; timeouts.push(id); return id; },
    setInterval: (fn, delay) => { const id = { fn, delay }; intervals.push(id); return id; },
    clearTimeout: (id) => cleared.push(id), clearInterval: (id) => cleared.push(id),
  });
  controller.start();
  controller.start();
  assert.deepEqual(timeouts.map((timer) => timer.delay), [10000]);
  assert.deepEqual(intervals.map((timer) => timer.delay), [21600000, 1000]);
  timeouts[0].fn();
  await tick();
  assert.equal(calls.checks, 1);
  intervals[0].fn();
  await tick();
  assert.equal(calls.checks, 2);
  controller.dispose();
  assert.equal(updater.listenerCount('update-downloaded'), 0);
  assert.deepEqual(cleared, [timeouts[0], ...intervals]);
  timeouts[0].fn();
  await tick();
  assert.equal(calls.checks, 2);
});

test('disposing during a pending check or preparation never publishes or installs afterwards', async () => {
  const pending = deferred();
  const { controller, updater, calls } = fixture();
  updater.checkForUpdates = () => pending.promise;
  const check = controller.check();
  await tick();
  controller.dispose();
  const count = calls.notifications.length;
  pending.resolve({ updateInfo: info });
  await check;
  assert.equal(calls.notifications.length, count);
  const preparation = deferred();
  const next = fixture({ prepareInstall: () => preparation.promise });
  await next.controller.check();
  const download = next.controller.download();
  await tick();
  next.controller.dispose();
  preparation.resolve(true);
  await download;
  assert.equal(next.calls.installs, 0);
  assert.equal(next.calls.releases, 1);
});

test('snapshots cannot mutate internal state and revisions increase monotonically', async () => {
  const { controller, calls } = fixture({ getBlockers: () => ['editing'] });
  await controller.check();
  await controller.download();
  const snapshot = controller.getStatus();
  snapshot.reasons.length = 0;
  snapshot.progress.percent = 5;
  assert.deepEqual(controller.getStatus().reasons, ['editing']);
  assert.equal(controller.getStatus().progress.percent, 100);
  assert.ok(calls.notifications.every((status, index) => status.revision === index + 1));
  controller.dispose();
});

test('disabled mode does not schedule work or invoke updater', async () => {
  const { controller, calls } = fixture({ mode: 'disabled', setTimeout: () => assert.fail('scheduled'), setInterval: () => assert.fail('scheduled') });
  controller.start();
  await controller.check();
  await controller.download();
  assert.equal(controller.getStatus().state, 'disabled');
  assert.equal(calls.checks + calls.downloads + calls.installs, 0);
  controller.dispose();
});

test('the default installer silently applies the update and explicitly relaunches', async () => {
  const { controller, updater } = fixture({ install: undefined });
  const calls = [];
  updater.quitAndInstall = (...args) => calls.push(args);
  await controller.check();
  await controller.download();
  assert.deepEqual(calls, [[true, true]]);
  controller.dispose();
});
