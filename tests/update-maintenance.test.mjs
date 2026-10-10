import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApp } from '../server/app.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'daylight-update-maintenance-'));
  const children = [];
  const app = await createApp({
    dataDir: directory, startScheduler: false,
    codexInfo: { available: true, version: 'isolated-test' },
    now: () => new Date('2026-10-09T12:00:00Z'), notify: () => {},
    spawn: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { child.killed = true; child.emit('close', null, 'SIGTERM'); };
      child.finish = () => child.emit('close', 0, null);
      children.push(child);
      return child;
    },
  });
  const url = await app.listen(0);
  const initial = await (await fetch(`${url}/api/bootstrap`)).json();
  const headers = { 'Content-Type': 'application/json', 'X-Daylight-Token': initial.csrfToken };
  const request = async (method, route, body = {}) => {
    const response = await fetch(url + route, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => {
    await app.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const task = async (overrides = {}) => {
    const result = await request('POST', '/api/tasks', {
      title: 'Isolated update test',
      automation: { enabled: false, workspace: directory, prompt: 'Do not execute anything.', sandbox: 'read-only', repeat: 'none', runAt: null },
      ...overrides,
    });
    assert.equal(result.status, 201);
    return result.data;
  };
  return { app, url, directory, headers, request, task, children };
}

test('maintenance rejects all new API mutations while keeping local reads available, then restores writes', async (t) => {
  const f = await fixture(t);
  const project = (await f.request('POST', '/api/projects', { name: 'Update fixture' })).data;
  const task = await f.task({ projectId: project.id, reminderAt: '2026-10-08T12:00:00Z' });
  f.app.scheduler.tick();
  const notice = f.app.store.data.notifications[0];
  const before = await readFile(join(f.directory, 'store.json'), 'utf8');
  f.app.setUpdatePending(true);
  for (const [method, route, body] of [
    ['POST', '/api/tasks', { title: 'Should not be saved' }],
    ['PATCH', `/api/tasks/${task.id}`, { completed: true }],
    ['DELETE', `/api/tasks/${task.id}`, {}],
    ['POST', `/api/tasks/${task.id}/run`, {}],
    ['POST', '/api/projects', { name: 'Blocked project' }],
    ['DELETE', `/api/projects/${project.id}`, {}],
    ['PATCH', '/api/settings', { desktopNotifications: true }],
    ['POST', '/api/notifications/read-all', {}],
    ['PATCH', `/api/notifications/${notice.id}`, { read: true }],
    ['POST', '/api/runs/nonexistent/cancel', {}],
  ]) {
    const result = await f.request(method, route, body);
    assert.equal(result.status, 503, `${method} ${route}`);
    assert.match(result.data.error, /installing an update/);
  }
  for (const route of ['/api/bootstrap', '/api/tasks', '/api/projects', '/api/runs', '/api/notifications', '/api/export']) {
    assert.equal((await f.request('GET', route)).status, 200, route);
  }
  assert.equal(await readFile(join(f.directory, 'store.json'), 'utf8'), before);
  assert.equal(f.children.length, 0);
  f.app.setUpdatePending(false);
  const changed = await f.request('PATCH', `/api/tasks/${task.id}`, { title: 'Editable again' });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.title, 'Editable again');
});

test('a running Codex task finishes normally while pending schedules and direct runs remain blocked', async (t) => {
  const f = await fixture(t);
  const running = await f.task();
  const pending = await f.task({ automation: {
    enabled: true, workspace: f.directory, prompt: 'No real execution.', sandbox: 'read-only', repeat: 'none', runAt: '2026-10-08T12:00:00Z',
  } });
  const run = (await f.request('POST', `/api/tasks/${running.id}/run`)).data;
  f.app.setUpdatePending(true);
  f.app.scheduler.tick();
  assert.equal(f.app.scheduler.activeRun.id, run.id);
  assert.equal(f.children[0].killed, undefined);
  assert.equal((await f.request('POST', `/api/runs/${run.id}/cancel`)).status, 503);
  f.children[0].stdout.write('Output survives update preparation.');
  f.children[0].finish();
  assert.equal(f.app.scheduler.activeRun, null);
  assert.equal(f.app.store.data.runs[0].status, 'succeeded');
  assert.match(f.app.store.data.runs[0].output, /Output survives/);
  assert.equal(f.children[0].killed, undefined);
  f.app.scheduler.tick();
  assert.equal(f.children.length, 1);
  const pendingTask = f.app.store.data.tasks.find((task) => task.id === pending.id);
  assert.equal(pendingTask.automation.enabled, true);
  assert.equal(pendingTask.automation.runAt, '2026-10-08T12:00:00.000Z');
  assert.throws(() => f.app.scheduler.startRun(pendingTask), (error) => error.status === 503);
  f.app.setUpdatePending(false);
  f.app.scheduler.tick();
  assert.equal(f.children.length, 2);
  assert.equal(f.app.scheduler.activeRun.taskId, pending.id);
  f.children[1].finish();
  assert.equal(f.app.store.data.runs[0].status, 'succeeded');
});

test('a request already streaming its body cannot write after maintenance begins', async (t) => {
  const f = await fixture(t);
  const incoming = once(f.app.server, 'request');
  const response = new Promise((resolveResponse, reject) => {
    const request = httpRequest(`${f.url}/api/tasks`, { method: 'POST', headers: f.headers }, (result) => {
      result.resume();
      result.once('end', () => resolveResponse(result.statusCode));
    });
    request.on('error', reject);
    request.write('{"title":');
    incoming.then(() => {
      f.app.setUpdatePending(true);
      request.end('"Late body"}');
    }, reject);
  });
  assert.equal(await response, 503);
  assert.equal(f.app.store.data.tasks.length, 0);
});

test('bridge leases register once per ID and each updating response releases its lease', async (t) => {
  const f = await fixture(t);
  const first = randomUUID();
  const second = randomUUID();
  for (const bridge of [first, first, second, 'invalid']) {
    const result = await f.request('GET', `/api/update-state?bridge=${bridge}`);
    assert.deepEqual(result.data, { updating: false });
  }
  assert.equal(f.app.pendingUpdateBridges, 2);
  f.app.setUpdatePending(true);
  assert.deepEqual((await f.request('GET', `/api/update-state?bridge=${first}`)).data, { updating: true });
  assert.equal(f.app.pendingUpdateBridges, 1);
  assert.deepEqual((await f.request('GET', `/api/update-state?bridge=${second}`)).data, { updating: true });
  assert.equal(f.app.pendingUpdateBridges, 0);
  f.app.setUpdatePending(false);
  await f.request('GET', `/api/update-state?bridge=${first}`);
  assert.equal(f.app.pendingUpdateBridges, 1);
});

test('expired bridge leases are removed before admitting a new bridge at capacity', async (t) => {
  const f = await fixture(t);
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  await Promise.all(Array.from({ length: 100 }, () => f.request('GET', `/api/update-state?bridge=${randomUUID()}`)));
  assert.equal(f.app.pendingUpdateBridges, 100);
  clock += 10001;
  await f.request('GET', `/api/update-state?bridge=${randomUUID()}`);
  assert.equal(f.app.pendingUpdateBridges, 1, 'A live bridge must not disappear behind expired leases');
  clock += 10001;
  assert.equal(f.app.pendingUpdateBridges, 0);
});

test('an acknowledged bridge with a PID stays pending until its process has actually exited', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  let alive = true;
  const probes = [];
  t.mock.method(process, 'kill', (pid, signal) => {
    probes.push({ pid, signal });
    if (!alive) throw Object.assign(new Error('Process is gone'), { code: 'ESRCH' });
  });
  await f.request('GET', `/api/update-state?bridge=${id}&pid=12345`);
  assert.equal(f.app.pendingUpdateBridges, 1);
  assert.equal(probes.length, 0, 'A normal heartbeat does not signal another process');
  f.app.setUpdatePending(true);
  assert.deepEqual((await f.request('GET', `/api/update-state?bridge=${id}&pid=12345`)).data, { updating: true });
  assert.equal(f.app.pendingUpdateBridges, 1, 'An HTTP acknowledgment does not mean the executable is unlocked');
  assert.ok(probes.length > 0);
  assert.ok(probes.every((probe) => probe.pid === 12345 && probe.signal === 0), 'Only read-only process probes are allowed');
  alive = false;
  assert.equal(f.app.pendingUpdateBridges, 0);
});

test('invalid PIDs cannot become process signals and permission errors keep a live lease pending', async (t) => {
  const f = await fixture(t);
  const probes = [];
  t.mock.method(process, 'kill', (pid, signal) => {
    probes.push({ pid, signal });
    throw Object.assign(new Error('Permission denied'), { code: 'EPERM' });
  });
  f.app.setUpdatePending(true);
  for (const pid of ['0', '-1', '1.5', '999999999999999999999', '2e3', '2147483648']) {
    await f.request('GET', `/api/update-state?bridge=${randomUUID()}&pid=${pid}`);
  }
  assert.equal(f.app.pendingUpdateBridges, 0);
  assert.equal(probes.length, 0);
  await f.request('GET', `/api/update-state?bridge=${randomUUID()}&pid=4321`);
  assert.equal(f.app.pendingUpdateBridges, 1);
  assert.ok(probes.every((probe) => probe.pid === 4321 && probe.signal === 0));
});
