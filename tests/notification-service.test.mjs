import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { APP_ID, createDesktopNotifications, readWindowsNotificationSetting } = require('../desktop/notification-service.cjs');

function fixture(t, options = {}) {
  const state = { enabled: true, system: 'enabled', supported: true, behavior: 'show',
    queryCount: 0, nativeChecks: 0, toasts: [], statuses: [], opened: [], activated: [] };
  class NativeNotification extends EventEmitter {
    static isSupported() { state.nativeChecks++; return state.supported; }
    static handleActivation(callback) { state.activation = callback; }
    constructor(config) { super(); this.config = config; state.toasts.push(this); }
    show() {
      if (state.behavior === 'throw') throw new Error('Native show failed');
      if (state.behavior === 'show') this.emit('show');
      if (state.behavior === 'failed') this.emit('failed', {}, 'Windows rejected the notification');
    }
    close() { assert.fail('The service must not erase Windows notifications'); }
  }
  const service = createDesktopNotifications({
    app: { isPackaged: true }, Notification: NativeNotification,
    shell: { openExternal: async uri => state.opened.push(uri) }, icon: 'isolated/icon.png',
    platform: 'win32', portable: false, getEnabled: () => state.enabled,
    readSystemSetting: async () => { state.queryCount++; return state.system; },
    onActivate: id => state.activated.push(id), onStatusChange: status => state.statuses.push(status),
    now: () => Date.parse('2026-10-12T10:00:00Z'), deliveryWaitMs: 15, ...options,
  });
  t.after(() => service.dispose());
  return { service, state };
}

test('Windows setting query uses the fixed Daylight identity and reports each documented block', async () => {
  const mappings = { Enabled: 'enabled', DisabledForApplication: 'disabled-application',
    DisabledForUser: 'disabled-user', DisabledByGroupPolicy: 'disabled-policy', DisabledByManifest: 'disabled-manifest',
    Unknown: 'unknown', 'not an enum value': 'unknown' };
  for (const [raw, expected] of Object.entries(mappings)) {
    const result = await readWindowsNotificationSetting({ platform: 'win32', run: (executable, args, options, done) => {
      assert.match(executable, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
      assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
      const query = Buffer.from(args[3], 'base64').toString('utf16le');
      assert.match(query, /CreateToastNotifier\('com\.daylight\.tasks'\)\.get_Setting\(\)/);
      assert.doesNotMatch(query, /\.Show\(|Set-ItemProperty|New-Item|ExecutionPolicy/);
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 4000);
      assert.equal(options.maxBuffer, 4096);
      done(null, `\r\n${raw}\r\n`);
    } });
    assert.equal(result, expected);
  }
  assert.equal(APP_ID, 'com.daylight.tasks');
});

test('unreadable Windows permissions remain unknown, not implicitly enabled', async () => {
  assert.equal(await readWindowsNotificationSetting({ platform: 'win32', run: (_exe, _args, _options, done) => done(new Error('timeout')) }), 'unknown');
  assert.equal(await readWindowsNotificationSetting({ platform: 'darwin', run: () => assert.fail('No Windows probe on macOS') }), 'unknown');
});

test('smoke, isolated previews and unsupported platforms cannot send or register notifications', async t => {
  for (const options of [{ smoke: true }, { allowNative: false }, { platform: 'darwin' }]) {
    const { service, state } = fixture(t, options);
    const result = await service.sendTest();
    assert.ok(['disabled', 'unsupported'].includes(result.state));
    assert.equal(state.nativeChecks, 0);
    assert.equal(state.queryCount, 0);
    assert.equal(state.toasts.length, 0);
    assert.equal(state.activation, undefined);
  }
});

test('the app preference blocks sends independently of Windows permission', async t => {
  const { service, state } = fixture(t);
  state.enabled = false;
  const result = await service.sendTest();
  assert.equal(result.enabled, false);
  assert.equal(result.systemState, 'enabled');
  assert.equal(result.state, 'off');
  assert.equal(result.lastDelivery.state, 'none');
  assert.equal(state.toasts.length, 0);
});

test('all Windows blocking reasons remain visible and prevent sends', async t => {
  for (const systemState of ['disabled-application', 'disabled-user', 'disabled-policy', 'disabled-manifest']) {
    const { service, state } = fixture(t);
    state.system = systemState;
    const result = await service.sendTest();
    assert.equal(result.state, 'blocked');
    assert.equal(result.systemState, systemState);
    assert.equal(result.enabled, true);
    assert.equal(result.canOpenSettings, true);
    assert.equal(state.toasts.length, 0);
  }
});

test('native support alone does not claim that Windows has enabled notifications', async t => {
  const { service } = fixture(t, { readSystemSetting: async () => { throw new Error('WinRT unavailable'); } });
  const status = await service.getStatus();
  assert.equal(status.supported, true);
  assert.equal(status.state, 'unknown');
  assert.equal(status.systemState, 'unknown');
  const result = await service.sendTest();
  assert.equal(result.lastDelivery.state, 'shown');
  assert.equal(result.systemState, 'unknown');
});

test('a native notification has bounded content and clicking a timed-out banner opens its task', async t => {
  const { service, state } = fixture(t);
  const result = await service.send({ title: 'a'.repeat(250), body: 'b'.repeat(600), taskId: 'task-42' });
  assert.equal(result.lastDelivery.state, 'shown');
  assert.equal(result.lastDelivery.kind, 'reminder');
  assert.equal(result.lastDelivery.at, '2026-10-12T10:00:00.000Z');
  const toast = state.toasts[0];
  assert.equal(toast.config.title.length, 200);
  assert.equal(toast.config.body.length, 500);
  assert.equal(toast.config.icon, 'isolated/icon.png');
  assert.equal(toast.config.urgency, 'normal');
  toast.emit('close', { reason: 'timedOut' });
  toast.emit('click');
  assert.deepEqual(state.activated, ['task-42']);
  state.activation({ type: 'click', arguments: '' });
  assert.deepEqual(state.activated, ['task-42', null]);
});

test('test reminders are bilingual, return delivery evidence and validate renderer input', async t => {
  const { service, state } = fixture(t);
  for (const value of [null, {}, 'fr', 'ms-settings:privacy-notifications']) {
    assert.throws(() => service.sendTest(value), TypeError);
  }
  assert.equal(state.toasts.length, 0);
  assert.equal((await service.sendTest('en')).lastDelivery.kind, 'test');
  assert.match(state.toasts[0].config.body, /Your reminders/);
  await service.sendTest('zh');
  assert.match(state.toasts[1].config.body, /任务提醒/);
  state.toasts[1].emit('click');
  assert.deepEqual(state.activated, [null]);
});

test('lack of a native show event remains requested, and a late failure is surfaced', async t => {
  const { service, state } = fixture(t);
  state.behavior = 'pending';
  assert.equal((await service.sendTest()).lastDelivery.state, 'requested');
  state.toasts[0].emit('failed', {}, 'Windows blocked delivery');
  const result = await service.getStatus();
  assert.equal(result.lastDelivery.state, 'failed');
  assert.equal(result.lastDelivery.error, 'Windows blocked delivery');
  assert.equal(state.statuses.at(-1).lastDelivery.state, 'failed');
});

test('native throws and failure events cannot break task scheduling', async t => {
  for (const behavior of ['throw', 'failed']) {
    const { service, state } = fixture(t);
    state.behavior = behavior;
    const result = await service.send({ title: 'Task reminder', body: 'Due now' });
    assert.equal(result.lastDelivery.state, 'failed');
    assert.ok(result.lastDelivery.error);
  }
});

test('late results from an older reminder cannot overwrite a newer delivery', async t => {
  const { service, state } = fixture(t);
  state.behavior = 'pending';
  await service.send({ title: 'Old' });
  state.behavior = 'show';
  await service.sendTest('en');
  state.toasts[0].emit('failed', {}, 'Older failure');
  const result = await service.getStatus();
  assert.equal(result.lastDelivery.state, 'shown');
  assert.equal(result.lastDelivery.kind, 'test');
});

test('concurrent status reads share one read and a preference change during that read blocks send', async t => {
  let finishRead;
  let reads = 0;
  const { service, state } = fixture(t, { readSystemSetting: () => { reads++; return new Promise(resolve => { finishRead = resolve; }); } });
  const first = service.getStatus();
  const second = service.getStatus();
  const sending = service.sendTest();
  assert.equal(reads, 1);
  state.enabled = false;
  finishRead('enabled');
  const statuses = await Promise.all([first, second, sending]);
  assert.ok(statuses.every(status => status.state === 'off'));
  assert.equal(state.toasts.length, 0);
});

test('manual refresh discovers that Windows notifications were enabled in Settings', async t => {
  const { service, state } = fixture(t);
  state.system = 'disabled-application';
  assert.equal((await service.getStatus()).state, 'blocked');
  state.system = 'enabled';
  assert.equal((await service.getStatus()).state, 'ready');
  assert.equal(state.queryCount, 2);
  await service.sendTest();
  assert.equal(state.queryCount, 3);
});

test('first test delivery refreshes the newly registered Windows notification setting', async t => {
  let reads = 0;
  const { service } = fixture(t, { readSystemSetting: async () => ++reads === 1 ? 'unknown' : 'enabled' });
  const result = await service.sendTest();
  assert.equal(reads, 2);
  assert.equal(result.state, 'ready');
  assert.equal(result.systemState, 'enabled');
  assert.equal(result.lastDelivery.state, 'shown');
  await service.send({ title: 'Routine reminder' });
  assert.equal(reads, 2);
});

test('development and portable builds preserve notification support', async t => {
  for (const [options, mode] of [[{ app: { isPackaged: false } }, 'development'], [{ portable: true }, 'portable']]) {
    const { service, state } = fixture(t, options);
    const result = await service.sendTest();
    assert.equal(result.mode, mode);
    assert.equal(result.lastDelivery.state, 'shown');
    assert.equal(state.toasts.length, 1);
  }
});

test('Settings only opens its fixed Windows URI, while smoke cannot launch Settings', async t => {
  const { service, state } = fixture(t);
  assert.deepEqual(await service.openSettings('https://untrusted.example'), { opened: true });
  assert.deepEqual(state.opened, ['ms-settings:notifications']);
  const smoke = fixture(t, { smoke: true });
  assert.deepEqual(await smoke.service.openSettings(), { opened: false });
  assert.equal(smoke.state.opened.length, 0);
});

test('status snapshots cannot be mutated and disposal silences callbacks without clearing Action Center', async t => {
  const { service, state } = fixture(t);
  const result = await service.sendTest();
  result.lastDelivery.state = 'hacked';
  assert.equal((await service.getStatus()).lastDelivery.state, 'shown');
  service.dispose();
  state.toasts[0].emit('show');
  state.toasts[0].emit('click');
  state.activation({ type: 'click' });
  const count = state.toasts.length;
  assert.equal((await service.sendTest()).state, 'disabled');
  assert.equal(state.toasts.length, count);
  assert.deepEqual(state.activated, []);
});
