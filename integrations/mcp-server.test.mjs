import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { localBaseUrl } from './mcp-server.mjs';
import { createApp } from '../server/app.mjs';

test('MCP accepts loopback origins and refuses remote URLs or injected paths', () => {
  assert.equal(localBaseUrl('http://127.0.0.1:9999'), 'http://127.0.0.1:9999');
  assert.equal(localBaseUrl('http://localhost:4317/'), 'http://localhost:4317');
  for (const value of ['https://example.com', 'http://example.com', 'file:///tmp/store', 'http://127.0.0.1:4317/api', 'http://user:pass@localhost:4317', 'http://localhost:4317/?x=y']) {
    assert.throws(() => localBaseUrl(value), /local HTTP origin/);
  }
});

test('MCP stdio protocol, filtered reads, tokenized writes, error reporting and run dispatch', async (t) => {
  const tasks = [
    { id: 'a', title: 'Read notes', notes: 'convex optimization', completed: false, projectId: 'p', priority: 'high', dueAt: '2026-10-05T17:00:00Z' },
    { id: 'b', title: 'Completed task', completed: true, projectId: null, priority: 'low', dueAt: null },
  ];
  const writes = [];
  const api = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const respond = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') {
      if (req.headers['x-daylight-token'] !== 'test-token') return respond({ error: 'Missing write token' }, 403);
      writes.push({ method: req.method, url: req.url, body });
    }
    if (req.url === '/api/bootstrap') return respond({ tasks, projects: [{ id: 'p', name: 'Study' }], settings: {}, codex: { available: true }, csrfToken: 'test-token' });
    if (req.url === '/api/tasks' && req.method === 'POST') return respond({ id: 'new', ...body });
    if (req.url === '/api/tasks/missing') return respond({ error: 'Task does not exist' }, 404);
    if (req.url === '/api/tasks/a/run') return respond({ id: 'run-1', status: 'running' }, 202);
    if (req.url.startsWith('/api/tasks/')) return respond({ id: req.url.split('/').at(-1), ...body });
    if (req.url === '/api/runs') return respond([{ id: 'run-1', status: 'completed' }]);
    if (req.url === '/api/notifications') return respond([]);
    if (req.url.startsWith('/api/notifications/')) return respond(body);
    if (req.url === '/api/export') return respond({ version: 1, tasks });
    return respond({ error: 'Not found' }, 404);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => api.close(resolve)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))],
    env: { ...process.env, DAYLIGHT_URL: `http://127.0.0.1:${api.address().port}` },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'daylight-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const json = result => JSON.parse(result.content[0].text);

  const catalog = await client.listTools();
  assert.equal(catalog.tools.length, 14);
  assert.equal(catalog.tools.find(tool => tool.name === 'daylight_delete_task').annotations.destructiveHint, true);
  assert.equal(catalog.tools.find(tool => tool.name === 'daylight_list_tasks').annotations.readOnlyHint, true);

  const filtered = json(await call('daylight_list_tasks', { completed: false, query: 'CONVEX', dueBefore: '2026-10-06T00:00:00+00:00' }));
  assert.deepEqual(filtered.tasks.map(task => task.id), ['a']);
  const inbox = json(await call('daylight_list_tasks', { projectId: null }));
  assert.deepEqual(inbox.tasks.map(task => task.id), ['b']);

  const status = json(await call('daylight_status'));
  assert.equal(status.codex.available, true);
  assert.equal('csrfToken' in status, false);

  const added = json(await call('daylight_add_task', { title: 'Test from Codex', reminderAt: '2026-10-05T17:00:00-07:00', automation: { enabled: false, sandbox: 'read-only' } }));
  assert.equal(added.title, 'Test from Codex');
  assert.equal(writes.at(-1).method, 'POST');

  await call('daylight_update_task', { id: 'a', completed: false, reminderAt: null });
  assert.deepEqual(writes.at(-1), { method: 'PATCH', url: '/api/tasks/a', body: { completed: false, reminderAt: null } });
  const noChanges = await call('daylight_update_task', { id: 'a' });
  assert.equal(noChanges.isError, true);
  const invalidDate = await call('daylight_add_task', { title: 'Invalid', dueAt: 'tomorrow' });
  assert.equal(invalidDate.isError, true);
  const missing = await call('daylight_delete_task', { id: 'missing' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /does not exist/);

  const run = json(await call('daylight_run_task', { id: 'a' }));
  assert.equal(run.status, 'running');
  assert.deepEqual(writes.at(-1), { method: 'POST', url: '/api/tasks/a/run', body: {} });
  assert.equal(json(await call('daylight_list_runs')).length, 1);
  await call('daylight_mark_notification', { id: 'notice-1', read: true });
  assert.deepEqual(writes.at(-1).body, { read: true });
  assert.equal(json(await call('daylight_export')).tasks.length, 2);
});

test('MCP writes match the actual Daylight API, including JSON DELETE and settings', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'daylight-mcp-test-'));
  const app = await createApp({ dataDir, codexInfo: { available: false }, startScheduler: false });
  const baseUrl = await app.listen(0);
  const client = new Client({ name: 'daylight-api-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await app.close();
    await unlink(join(dataDir, 'store.json'));
    await rmdir(dataDir);
  });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))],
    env: { ...process.env, DAYLIGHT_URL: baseUrl },
    stderr: 'pipe',
  }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const project = await call('daylight_add_project', { name: 'Test project', color: '#889977' });
  const task = await call('daylight_add_task', { title: 'Test real API', projectId: project.id, dueAt: '2026-10-05T10:00:00-07:00' });
  assert.equal(task.dueAt, '2026-10-05T17:00:00.000Z');
  assert.equal(task.automation.sandbox, 'read-only');
  const updated = await call('daylight_update_task', { id: task.id, completed: true, dueAt: null });
  assert.equal(updated.completed, true);
  assert.equal(updated.dueAt, null);
  assert.equal((await call('daylight_update_settings', { desktopNotifications: false })).desktopNotifications, false);
  assert.equal((await call('daylight_export')).tasks.length, 1);
  assert.deepEqual(await call('daylight_delete_task', { id: task.id }), { ok: true });
  assert.equal((await call('daylight_list_tasks')).tasks.length, 0);
});
