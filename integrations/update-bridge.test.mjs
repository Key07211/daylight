import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.mjs';

async function until(predicate, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for bridge state');
    await delay(30);
  }
}

function bridge(t, url) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], {
    env: { ...process.env, DAYLIGHT_URL: url }, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let buffered = '';
  let sequence = 0;
  const messages = new Map();
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim()) {
        const message = JSON.parse(line);
        if (message.id !== undefined) messages.set(message.id, message);
      }
    }
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const call = async (method, params = {}) => {
    const id = ++sequence;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    await until(() => messages.has(id) || child.exitCode !== null, 5000);
    assert.ok(messages.has(id), `Bridge exited before ${method}: ${stderr}`);
    const message = messages.get(id);
    messages.delete(id);
    assert.equal(message.error, undefined, JSON.stringify(message.error));
    return message.result;
  };
  const initialize = async () => {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'isolated-update-test', version: '1.0.0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    assert.equal((await call('tools/list')).tools.length, 14);
  };
  return { child, call, initialize, get stderr() { return stderr; } };
}

test('the MCP bridge registers, exits cleanly for an update, and a fresh bridge reconnects after release', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'daylight-update-bridge-'));
  const app = await createApp({ dataDir: directory, startScheduler: false, codexInfo: { available: false } });
  const url = await app.listen(0);
  t.after(async () => {
    await app.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const first = bridge(t, url);
  await first.initialize();
  await until(() => app.pendingUpdateBridges === 1);
  assert.equal(first.child.exitCode, null);
  app.setUpdatePending(true);
  await until(() => first.child.exitCode !== null);
  assert.equal(first.child.exitCode, 0, first.stderr);
  assert.equal(app.pendingUpdateBridges, 0);
  assert.equal((await fetch(`${url}/api/bootstrap`)).status, 200, 'Only the bridge exits; the Daylight service remains alive');
  app.setUpdatePending(false);
  const second = bridge(t, url);
  await second.initialize();
  await until(() => app.pendingUpdateBridges === 1);
  const listed = await second.call('tools/call', { name: 'daylight_list_tasks', arguments: {} });
  assert.equal(listed.isError, undefined);
  assert.deepEqual(JSON.parse(listed.content[0].text).tasks, []);
});

test('an older or temporarily unavailable update endpoint does not terminate the bridge', { timeout: 15000 }, async (t) => {
  let polls = 0;
  const server = createServer((request, response) => {
    if (request.url.startsWith('/api/update-state')) polls += 1;
    response.writeHead(polls < 2 ? 404 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'No update state available' }));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => { server.close(resolveClose); server.closeIdleConnections(); }));
  const connection = bridge(t, `http://127.0.0.1:${server.address().port}`);
  await connection.initialize();
  await until(() => polls >= 2);
  assert.equal(connection.child.exitCode, null);
  assert.equal((await connection.call('tools/list')).tools.length, 14);
});
