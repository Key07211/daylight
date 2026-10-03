import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApp } from '../server/app.mjs';
import { nextRunAt } from '../server/scheduler.mjs';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'daylight-test-'));
  const state = { current: new Date('2026-10-02T17:00:00.000Z'), children: [], notifications: [] };
  const spawn = (command, args, config) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.input = ''; child.stdin.on('data', data => { child.input += data.toString(); });
    child.command = command; child.args = args; child.config = config;
    child.finish = (code = 0) => child.emit('close', code, null);
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    state.children.push(child);
    return child;
  };
  const config = { dataDir: directory, startScheduler: false, now: () => new Date(state.current),
    codexInfo: { available: true, version: 'codex-test' }, spawn, notify: item => state.notifications.push(item), ...options };
  const app = await createApp(config);
  const url = await app.listen(0);
  const initial = await (await fetch(url + '/api/bootstrap')).json();
  const request = async (method, route, input = {}, headers = {}) => {
    const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': initial.csrfToken, ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }) });
    const data = await response.json();
    return { status: response.status, data };
  };
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { app, url, request, initial, directory, state, config,
    task: async (overrides = {}) => {
      const result = await request('POST', '/api/tasks', { title: 'Review the plan', ...overrides });
      assert.equal(result.status, 201, JSON.stringify(result.data));
      return result.data;
    },
    automation: (overrides = {}) => ({ enabled: false, prompt: 'Review README; do not change files.', workspace: directory,
      runAt: null, repeat: 'none', sandbox: 'read-only', ...overrides }),
  };
}

test('CRUD, projects, settings and exports persist across restart', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.initial.tasks, []);
  assert.deepEqual(f.initial.settings, { desktopNotifications: false });
  const project = await f.request('POST', '/api/projects', { name: 'Personal', color: '#81916B' });
  assert.equal(project.status, 201);
  const task = await f.task({ projectId: project.data.id, notes: 'Local only', priority: 'high', dueAt: '2026-10-03T10:00:00-07:00' });
  assert.equal(task.dueAt, '2026-10-03T17:00:00.000Z');
  const changed = await f.request('PATCH', `/api/tasks/${task.id}`, { title: 'Review completed', completed: true });
  assert.equal(changed.data.title, 'Review completed');
  assert.equal(changed.data.notes, 'Local only');
  const deleted = await f.request('DELETE', `/api/projects/${project.data.id}`);
  assert.equal(deleted.status, 200);
  assert.equal(f.app.store.data.tasks[0].projectId, null);
  await f.request('PATCH', '/api/settings', { desktopNotifications: true });
  const backup = await f.request('GET', '/api/export');
  assert.equal(backup.data.tasks[0].completed, true);
  assert.equal(backup.data.version, 1);
  assert.equal(backup.data.csrfToken, undefined);
  await f.app.close();
  const restarted = await createApp(f.config);
  t.after(() => restarted.close());
  const restartUrl = await restarted.listen(0);
  const bootstrap = await (await fetch(restartUrl + '/api/bootstrap')).json();
  assert.notEqual(bootstrap.csrfToken, f.initial.csrfToken);
  assert.equal(bootstrap.tasks[0].title, 'Review completed');
  assert.equal(bootstrap.settings.desktopNotifications, true);
  const response = await fetch(restartUrl + `/api/tasks/${task.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': bootstrap.csrfToken }, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal(restarted.store.data.tasks.length, 0);
});

test('local API rejects invalid origins, hosts, token and content types', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('POST', '/api/tasks', { title: 'blocked' }, { 'X-Daylight-Token': '' })).status, 403);
  assert.equal((await f.request('POST', '/api/tasks', { title: 'blocked' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await fetch(f.url + '/api/bootstrap', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await f.request('POST', '/api/tasks', { title: 'blocked' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('POST', '/api/tasks', { title: 'allowed' }, { Origin: 'http://localhost:5173' })).status, 201);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(f.url + '/api/bootstrap', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 403);
  const malformed = await fetch(f.url + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': f.initial.csrfToken }, body: '{' });
  assert.equal(malformed.status, 400);
});

test('task validation rejects malformed dates, unsafe automation, and nonexistent projects', async t => {
  const f = await fixture(t);
  for (const input of [
    { title: '' }, { title: 'x', dueAt: 'tomorrow' }, { title: 'x', dueAt: '2026-10-02T10:00:00' },
    { title: 'x', priority: 'urgent' }, { title: 'x', projectId: 'missing' }, { title: 'x', completed: 'true' },
    { title: 'x', automation: { enabled: true } }, { title: 'x', automation: { sandbox: 'danger-full-access' } },
    { title: 'x', automation: f.automation({ enabled: true, runAt: f.state.current.toISOString(), workspace: 'relative/path' }) },
    { title: 'x', unexpected: true },
  ]) assert.equal((await f.request('POST', '/api/tasks', input)).status, 400, JSON.stringify(input));
  assert.equal((await f.request('PATCH', '/api/settings', { launchAtLogin: true })).status, 400);
  const task = await f.task();
  assert.equal((await f.request('POST', `/api/tasks/${task.id}/run`)).status, 400);
  assert.equal((await f.request('DELETE', '/api/tasks/missing')).status, 404);
  assert.equal(f.app.store.data.tasks.length, 1);
});

test('reminders are durable, deduplicated, editable, and suppressed for completed tasks', async t => {
  const f = await fixture(t);
  await f.request('PATCH', '/api/settings', { desktopNotifications: true });
  const reminder = '2026-10-02T16:59:00.000Z';
  const task = await f.task({ reminderAt: reminder, notes: 'Bring notes' });
  await f.task({ title: 'Already done', reminderAt: reminder, completed: true });
  f.app.scheduler.tick(); f.app.scheduler.tick();
  assert.equal(f.app.store.data.notifications.length, 1);
  assert.equal(f.state.notifications.length, 1);
  const item = f.app.store.data.notifications[0];
  assert.equal(item.type, 'reminder'); assert.equal(item.body, 'Bring notes');
  assert.equal((await f.request('PATCH', `/api/notifications/${item.id}`, { read: true })).data.read, true);
  await f.request('PATCH', `/api/tasks/${task.id}`, { reminderAt: '2026-10-02T16:58:00.000Z' });
  f.app.scheduler.tick();
  assert.equal(f.app.store.data.notifications.length, 2);
  await f.request('POST', '/api/notifications/read-all');
  assert.ok(f.app.store.data.notifications.every(item => item.read));
  await f.app.close();
  const restarted = await createApp(f.config);
  restarted.scheduler.tick();
  assert.equal(restarted.store.data.notifications.length, 2);
  await restarted.close();
});

test('ordinary task edits survive a removed workspace while enabling and execution still validate it', async t => {
  const f = await fixture(t);
  const workspace = path.join(f.directory, 'removed-workspace');
  await fs.mkdir(workspace);
  const task = await f.task({ automation: f.automation({ enabled: true, workspace, runAt: '2026-10-03T17:00:00.000Z' }) });
  await fs.rmdir(workspace);
  const edited = await f.request('PATCH', `/api/tasks/${task.id}`, { title: 'Keep the task editable', notes: 'The folder moved.' });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.notes, 'The folder moved.');
  assert.equal((await f.request('PATCH', `/api/tasks/${task.id}`, { completed: true })).status, 200);
  assert.equal((await f.request('PATCH', `/api/tasks/${task.id}`, { completed: false })).status, 200);
  assert.equal((await f.request('PATCH', `/api/tasks/${task.id}`, { automation: { prompt: 'Check the status.', runAt: '2026-10-04T17:00:00.000Z' } })).status, 200);
  assert.equal((await f.request('PATCH', `/api/tasks/${task.id}`, { automation: { enabled: true } })).status, 400);
  assert.equal((await f.request('PATCH', `/api/tasks/${task.id}`, { automation: { workspace } })).status, 400);
  assert.equal((await f.request('POST', `/api/tasks/${task.id}/run`)).status, 400);
  assert.equal(f.state.children.length, 0);
  assert.equal((await f.request('PATCH', `/api/tasks/${task.id}`, { automation: { enabled: false } })).status, 200);
});

test('scheduler runs enabled tasks once, advances recurrence and serializes execution', async t => {
  const f = await fixture(t);
  await f.task({ title: 'Disabled', automation: f.automation({ runAt: '2026-10-01T12:00:00.000Z' }) });
  await f.task({ title: 'Completed', completed: true, automation: f.automation({ enabled: true, runAt: '2026-10-01T12:00:00.000Z' }) });
  const first = await f.task({ title: 'Recurring', automation: f.automation({ enabled: true, repeat: 'daily', runAt: '2026-09-30T18:00:00.000Z' }) });
  const second = await f.task({ title: 'Once', automation: f.automation({ enabled: true, runAt: '2026-10-01T18:00:00.000Z' }) });
  f.app.scheduler.tick(); f.app.scheduler.tick();
  assert.equal(f.state.children.length, 1);
  assert.equal(f.app.store.data.runs[0].taskId, first.id);
  assert.equal(f.app.store.data.runs[0].trigger, 'schedule');
  const recurring = f.app.store.data.tasks.find(task => task.id === first.id);
  assert.equal(recurring.automation.runAt, '2026-10-02T18:00:00.000Z');
  assert.equal((await f.request('POST', `/api/tasks/${second.id}/run`)).status, 409);
  f.state.children[0].finish();
  f.app.scheduler.tick();
  assert.equal(f.state.children.length, 2);
  assert.equal(f.app.store.data.runs[0].taskId, second.id);
  assert.equal(f.app.store.data.tasks.find(task => task.id === second.id).automation.enabled, false);
  f.state.children[1].finish();
  f.app.scheduler.tick();
  assert.equal(f.state.children.length, 2);
  assert.ok(f.app.store.data.runs.every(run => run.status === 'succeeded'));
});

test('manual runs pass prompts through stdin, constrain sandbox and bound output', async t => {
  const f = await fixture(t);
  const prompt = 'Print literal text: $(touch never) & "quoted"';
  const task = await f.task({ automation: f.automation({ prompt }) });
  const response = await f.request('POST', `/api/tasks/${task.id}/run`);
  assert.equal(response.status, 202);
  const child = f.state.children[0];
  assert.equal(child.input, prompt);
  assert.equal(child.config.shell, false);
  assert.deepEqual(child.args, ['exec', '--skip-git-repo-check', '--color', 'never', '-s', 'read-only', '-C', f.directory, '-']);
  child.stdout.emit('data', 'x'.repeat(200000));
  child.stderr.emit('data', '\nfinal detail');
  child.finish(1);
  const run = (await f.request('GET', `/api/runs/${response.data.id}`)).data;
  assert.equal(run.status, 'failed');
  assert.match(run.error, /code 1/);
  assert.ok(run.output.length < 132000);
  assert.match(run.output, /final detail$/);
  assert.ok(run.finishedAt);
  assert.equal(f.app.store.data.tasks[0].completed, false);
});

test('cancellation and timeout terminate a launched process', async t => {
  const f = await fixture(t, { timeoutMs: 50 });
  const task = await f.task({ automation: f.automation() });
  let response = await f.request('POST', `/api/tasks/${task.id}/run`);
  const cancelled = await f.request('POST', `/api/runs/${response.data.id}/cancel`);
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal(f.state.children[0].killed, true);
  response = await f.request('POST', `/api/tasks/${task.id}/run`);
  await new Promise(resolve => setTimeout(resolve, 90));
  const run = f.app.store.data.runs.find(item => item.id === response.data.id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /run limit/);
  assert.equal(f.state.children[1].killed, true);
});

test('Codex unavailable creates one scheduled failure while reminders continue', async t => {
  const f = await fixture(t, { codexInfo: { available: false, version: null } });
  const task = await f.task({ reminderAt: '2026-10-01T10:00:00.000Z', automation: f.automation({ enabled: true, runAt: '2026-10-01T10:00:00.000Z' }) });
  assert.equal((await f.request('POST', `/api/tasks/${task.id}/run`)).status, 503);
  f.app.scheduler.tick(); f.app.scheduler.tick();
  assert.equal(f.app.store.data.runs.length, 1);
  assert.equal(f.app.store.data.runs[0].status, 'failed');
  assert.equal(f.app.store.data.notifications.length, 2);
  assert.equal(f.state.children.length, 0);
});

test('startup records an interrupted run as failed without replaying it', async t => {
  const f = await fixture(t);
  f.app.store.data.runs.push({ id: 'interrupted', taskId: 'old-task', taskTitle: 'Interrupted', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', output: 'previous output', trigger: 'manual' });
  f.app.store.save(); await f.app.close();
  const restarted = await createApp(f.config);
  assert.equal(restarted.store.data.runs[0].status, 'failed');
  assert.match(restarted.store.data.runs[0].error, /restarted/);
  restarted.scheduler.tick();
  assert.equal(f.state.children.length, 0);
  await restarted.close();
});

test('recurrence preserves local time and skips weekends and missed periods', () => {
  const friday = new Date(2026, 9, 2, 10, 30);
  const monday = new Date(nextRunAt(friday.toISOString(), 'weekdays', friday));
  assert.equal(monday.getDay(), 1); assert.equal(monday.getDate(), 5); assert.equal(monday.getHours(), 10); assert.equal(monday.getMinutes(), 30);
  const nextWeek = new Date(nextRunAt(friday.toISOString(), 'weekly', new Date(2026, 9, 12, 9)));
  assert.equal(nextWeek.getDate(), 16); assert.equal(nextWeek.getHours(), 10);
  assert.equal(nextRunAt(friday.toISOString(), 'none', friday), null);
});

test('malformed persistence is reported without overwriting user data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'daylight-invalid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'store.json');
  await fs.writeFile(filename, '{broken');
  await assert.rejects(createApp({ dataDir: directory, codexInfo: { available: false, version: null } }));
  assert.equal(await fs.readFile(filename, 'utf8'), '{broken');
  const malformed = JSON.stringify({ version: 1, tasks: [{ id: 'broken' }], projects: [], runs: [], notifications: [] });
  await fs.writeFile(filename, malformed);
  await assert.rejects(createApp({ dataDir: directory, codexInfo: { available: false, version: null } }), /malformed/);
  assert.equal(await fs.readFile(filename, 'utf8'), malformed);
});
