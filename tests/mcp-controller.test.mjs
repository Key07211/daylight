import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDesktopMcp } from '../desktop/mcp-controller.cjs';

const ready = { state: 'ready', registered: true, toolCount: 14,
  serviceUrl: 'http://127.0.0.1:4317', checkedAt: '2026-10-02T18:00:00.000Z' };

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-mcp-controller-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('daylight-mcp-controller-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const preferencesPath = path.join(directory, 'preferences', 'mcp-preferences.json');
  const calls = [];
  const events = [];
  const manager = {
    async check() { calls.push('check'); return { ...ready }; },
    async ensure() { calls.push('ensure'); return { ...ready }; },
  };
  const create = overrides => createDesktopMcp({
    origin: ready.serviceUrl, preferencesPath, manager,
    notify: status => events.push(status), ...options, ...overrides,
  });
  return { preferencesPath, directory, calls, events, manager, create };
}

test('startup automatically ensures a connection by default and publishes pending then verified status', async t => {
  const { create, calls, events, preferencesPath } = fixture(t);
  const controller = create();
  assert.equal(controller.getStatus().autoConnect, true);
  assert.equal(controller.getStatus().checking, false);
  const result = await controller.start();
  assert.deepEqual(calls, ['ensure']);
  assert.equal(events[0].checking, true);
  assert.equal(events.at(-1).checking, false);
  assert.ok(events.at(-1).revision > events[0].revision);
  assert.equal(result.state, 'ready');
  assert.equal(result.canConfigure, true);
  assert.equal(fs.existsSync(preferencesPath), false);
});

test('opting out persists across controller instances and startup only checks without registering', async t => {
  const { create, calls, preferencesPath } = fixture(t);
  const controller = create();
  const disabled = await controller.setAutoConnect(false);
  assert.equal(disabled.autoConnect, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')), { autoConnect: false });
  assert.deepEqual(calls, []);
  const restarted = create();
  assert.equal(restarted.getStatus().autoConnect, false);
  await restarted.start();
  assert.deepEqual(calls, ['check']);
  await restarted.connect();
  assert.deepEqual(calls, ['check', 'ensure']);
  assert.equal(restarted.getStatus().autoConnect, false);
});

test('enabling auto-connect persists preference and immediately ensures a connection', async t => {
  const { create, calls, preferencesPath } = fixture(t, { defaultAutoConnect: false });
  const controller = create();
  assert.equal(controller.getStatus().autoConnect, false);
  const result = await controller.setAutoConnect(true);
  assert.equal(result.state, 'ready');
  assert.equal(result.autoConnect, true);
  assert.deepEqual(calls, ['ensure']);
  assert.equal(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).autoConnect, true);
  assert.equal(create().getStatus().autoConnect, true);
});

test('smoke or portable disabled mode cannot check, register, or write preferences', async t => {
  const { create, calls, preferencesPath, events } = fixture(t, { disabled: true });
  const controller = create();
  for (const method of ['start', 'check', 'connect']) {
    const result = await controller[method]();
    assert.equal(result.state, 'unavailable');
    assert.equal(result.canConfigure, false);
    assert.equal(result.checking, false);
  }
  await assert.rejects(controller.setAutoConnect(true), /disabled/i);
  await assert.rejects(controller.setAutoConnect(false), /disabled/i);
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
  assert.equal(fs.existsSync(preferencesPath), false);
});

test('non-boolean IPC preference input is rejected without persistence or connection side effects', async t => {
  const { create, calls, preferencesPath } = fixture(t);
  const controller = create();
  for (const value of [undefined, null, 'false', 'true', 0, 1, {}, []]) {
    await assert.rejects(controller.setAutoConnect(value), /true or false/);
  }
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(preferencesPath), false);
  assert.equal(controller.getStatus().autoConnect, true);
});

test('explicit connection check is read-only even with auto-connect enabled', async t => {
  const { create, calls } = fixture(t);
  const controller = create();
  await controller.check();
  assert.deepEqual(calls, ['check']);
});

test('manager failures cannot retain a ready state and always clear pending', async t => {
  let failure = false;
  const { create, events } = fixture(t, { manager: {
    async check() { if (failure) throw new Error('sensitive debug details'); return { ...ready }; },
    async ensure() { throw new Error('sensitive debug details'); },
  } });
  const controller = create();
  assert.equal((await controller.check()).state, 'ready');
  failure = true;
  for (const method of ['check', 'connect']) {
    const result = await controller[method]();
    assert.equal(result.state, 'error');
    assert.equal(result.checking, false);
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  }
  assert.equal(events.at(-1).state, 'error');
  assert.equal(events.at(-1).checking, false);
});

test('manager conflict, disabled, missing and unavailable statuses are preserved', async t => {
  const { create } = fixture(t);
  for (const state of ['conflict', 'disabled', 'missing', 'unavailable', 'error']) {
    const manager = { ensure: async () => ({ ...ready, state, toolCount: 0 }) };
    const controller = create({ manager });
    const result = await controller.connect();
    assert.equal(result.state, state);
    assert.equal(result.toolCount, 0);
    assert.equal(result.checking, false);
  }
});

test('malformed preferences fall back to default without changing the file', async t => {
  const { create, preferencesPath } = fixture(t, { defaultAutoConnect: false });
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  for (const content of ['{ broken', '{"autoConnect":"true"}', '{"autoConnect":1}']) {
    fs.writeFileSync(preferencesPath, content);
    assert.equal(create().getStatus().autoConnect, false);
    assert.equal(fs.readFileSync(preferencesPath, 'utf8'), content);
  }
});

test('preference write failure retains previous opt-out and never starts registration', async t => {
  const { create, directory, calls } = fixture(t, { defaultAutoConnect: false });
  const blocked = path.join(directory, 'regular-file');
  fs.writeFileSync(blocked, 'fixture');
  const controller = create({ preferencesPath: path.join(blocked, 'preferences.json') });
  await assert.rejects(controller.setAutoConnect(true));
  assert.equal(controller.getStatus().autoConnect, false);
  assert.deepEqual(calls, []);
});

test('overlapping requests keep checking true until all requests settle', async t => {
  let finishCheck;
  let finishConnect;
  const { create } = fixture(t, { manager: {
    check: () => new Promise(resolve => { finishCheck = resolve; }),
    ensure: () => new Promise(resolve => { finishConnect = resolve; }),
  } });
  const controller = create();
  const initial = controller.getStatus();
  const check = controller.check();
  const connect = controller.connect();
  assert.equal(controller.getStatus().checking, true);
  finishCheck({ ...ready });
  const firstReply = await check;
  assert.equal(firstReply.checking, true);
  finishConnect({ ...ready });
  const finalReply = await connect;
  assert.equal(finalReply.checking, false);
  assert.equal(controller.getStatus().checking, false);
  assert.ok(firstReply.revision > initial.revision);
  assert.ok(finalReply.revision > firstReply.revision, 'UI can reject a stale pending IPC reply using revision');
});
