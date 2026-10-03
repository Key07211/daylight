import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createMcpConnection, probeDaylight } from '../desktop/mcp-connection.cjs';

const desired = {
  codexCommand: 'C:\\Codex App\\codex.exe',
  command: 'C:\\Daylight App\\Daylight.exe',
  args: ['C:\\Daylight App\\resources\\app.asar\\integrations\\mcp-server.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: 'http://127.0.0.1:4317' },
};
function registration(overrides = {}) {
  return { name: 'daylight', enabled: true, disabled_reason: null,
    transport: { type: 'stdio', command: desired.command, args: [...desired.args], env: { ...desired.env }, env_vars: [], cwd: null },
    enabled_tools: null, disabled_tools: null, startup_timeout_sec: null, tool_timeout_sec: null, ...overrides };
}
function missing() {
  return Object.assign(new Error('CLI failed'), { code: 1, stderr: "Error: No MCP server named 'daylight' found.\n" });
}
function fixture(initial = null, options = {}) {
  let entry = initial;
  const calls = [];
  const probes = [];
  const runCommand = async (command, args, settings) => {
    calls.push({ command, args, settings });
    if (args[1] === 'get') {
      if (!entry) throw missing();
      return { stdout: JSON.stringify(entry) };
    }
    assert.equal(args[1], 'add');
    entry = registration();
    return { stdout: 'Added global MCP server daylight. secret-diagnostic' };
  };
  const probe = async input => {
    probes.push(input);
    return { toolCount: 14, serviceUrl: desired.env.DAYLIGHT_URL };
  };
  const manager = createMcpConnection({ ...desired, runCommand, probe, now: () => new Date('2026-10-02T18:00:00Z'), ...options });
  return { manager, calls, probes, get entry() { return entry; }, set entry(value) { entry = value; } };
}

test('read-only missing check never registers or probes', async () => {
  const { manager, calls, probes } = fixture();
  const status = await manager.check();
  assert.equal(status.state, 'missing');
  assert.equal(status.registered, false);
  assert.equal(status.checkedAt, '2026-10-02T18:00:00.000Z');
  assert.deepEqual(calls[0].args, ['mcp', 'get', 'daylight', '--json']);
  assert.equal(calls.length, 1);
  assert.equal(probes.length, 0);
});

test('ensure registers once using literal argv with spaced paths, reads back, and tests health', async () => {
  const { manager, calls, probes } = fixture();
  const status = await manager.ensure();
  assert.equal(status.state, 'ready');
  assert.equal(status.registered, true);
  assert.equal(status.toolCount, 14);
  assert.deepEqual(calls.find(call => call.args[1] === 'add').args, [
    'mcp', 'add', 'daylight', '--env', 'ELECTRON_RUN_AS_NODE=1', '--env', 'DAYLIGHT_URL=http://127.0.0.1:4317',
    '--', desired.command, ...desired.args,
  ]);
  assert.ok(calls.every(call => call.command === desired.codexCommand && call.settings.shell === false && call.settings.windowsHide));
  assert.equal(probes.length, 1);
  assert.equal(probes[0].command, desired.command);
  assert.equal(JSON.stringify(status).includes('secret'), false);
  await manager.ensure();
  assert.equal(calls.filter(call => call.args[1] === 'add').length, 1);
  const copy = manager.getStatus();
  copy.state = 'error';
  assert.equal(manager.getStatus().state, 'ready');
});

test('matching entry preserves extra environment, cwd and all policies without add', async () => {
  const entry = registration({ enabled_tools: ['daylight_status'], disabled_tools: ['daylight_delete_task'] });
  entry.transport.env.SECRET = 'never-print';
  entry.transport.cwd = 'C:\\Personal Workspace';
  const { manager, calls, probes } = fixture(entry);
  assert.equal((await manager.ensure()).state, 'ready');
  assert.equal(calls.length, 1);
  assert.equal(probes[0].env.SECRET, 'never-print');
  assert.deepEqual(probes[0].registration.disabled_tools, ['daylight_delete_task']);
  assert.equal(JSON.stringify(manager.getStatus()).includes('never-print'), false);
});

test('unrelated and stale owned registrations are conflicts and never overwritten or started', async () => {
  for (const entry of [
    registration({ transport: { type: 'streamable_http', url: 'https://other.example' } }),
    registration({ transport: { ...registration().transport, command: 'other-app' } }),
    registration({ transport: { ...registration().transport, env: { ...desired.env, DAYLIGHT_URL: 'http://127.0.0.1:14320' } } }),
  ]) {
    const { manager, calls, probes } = fixture(entry);
    const result = await manager.ensure();
    assert.equal(result.state, 'conflict');
    assert.equal(result.registered, true);
    assert.equal(calls.length, 1);
    assert.equal(probes.length, 0);
  }
});

test('disabled or policy-disabled entries remain disabled', async () => {
  for (const entry of [registration({ enabled: false }), registration({ disabled_reason: 'blocked by policy' })]) {
    const { manager, calls, probes } = fixture(entry);
    assert.equal((await manager.ensure()).state, 'disabled');
    assert.equal(calls.length, 1);
    assert.equal(probes.length, 0);
  }
});

test('missing CLI and config errors are distinguished and never trigger registration', async () => {
  for (const [error, expected] of [
    [Object.assign(new Error('secret path'), { code: 'ENOENT' }), 'unavailable'],
    [Object.assign(new Error('secret token'), { code: 1, stderr: 'Failed parsing config: secret-token' }), 'error'],
  ]) {
    let count = 0;
    const { manager } = fixture(null, { runCommand: async () => { count += 1; throw error; } });
    const result = await manager.ensure();
    assert.equal(result.state, expected);
    assert.equal(count, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  const { manager, probes } = fixture(null, { runCommand: async () => ({ stdout: 'not json secret' }) });
  assert.equal((await manager.ensure()).state, 'error');
  assert.equal(probes.length, 0);
});

test('bridge offline or wrong endpoint never reports ready but retains registered state', async () => {
  for (const probe of [
    async () => { throw new Error('secret internal error'); },
    async () => ({ toolCount: 14, serviceUrl: 'http://127.0.0.1:1234' }),
    async () => ({ toolCount: 0, serviceUrl: desired.env.DAYLIGHT_URL }),
  ]) {
    const { manager, calls } = fixture(registration(), { probe });
    const result = await manager.ensure();
    assert.equal(result.state, 'error');
    assert.equal(result.registered, true);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('concurrent checks and ensure calls share one registration and probe', async () => {
  const { manager, calls, probes } = fixture();
  const results = await Promise.all([manager.check(), manager.ensure(), manager.ensure(), manager.check()]);
  assert.ok(results.every(result => result.state === 'ready'));
  assert.equal(calls.filter(call => call.args[1] === 'add').length, 1);
  assert.equal(probes.length, 1);
});

test('entry appearing just before registration is rechecked and protected', async () => {
  let gets = 0;
  const { manager } = fixture(null, { runCommand: async (_command, args) => {
    assert.equal(args[1], 'get');
    if (++gets === 1) throw missing();
    return { stdout: JSON.stringify(registration({ enabled: false })) };
  } });
  assert.equal((await manager.ensure()).state, 'disabled');
  assert.equal(gets, 2);
});

test('failed add and missing readback do not report success or start the bridge', async () => {
  for (const failAdd of [true, false]) {
    let probes = 0;
    let adds = 0;
    const manager = createMcpConnection({ ...desired, runCommand: async (_command, args) => {
      if (args[1] === 'get') throw missing();
      adds += 1;
      if (failAdd) throw new Error('secret registration failure');
      return { stdout: 'Successfully added server' };
    }, probe: async () => { probes += 1; } });
    const result = await manager.ensure();
    assert.equal(result.state, 'error');
    assert.equal(result.registered, false);
    assert.equal(adds, 1);
    assert.equal(probes, 0);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('real probe timeout closes a bridge which never handshakes', async () => {
  const started = Date.now();
  await assert.rejects(probeDaylight({ command: process.execPath,
    args: ['-e', "process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));"],
    env: {}, registration: registration(), timeoutMs: 100,
  }));
  assert.ok(Date.now() - started < 5000);
});

test('real MCP probe initializes, lists permitted tools and calls read-only status against fixture service', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ settings: {}, codex: { available: true } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const serviceUrl = `http://127.0.0.1:${server.address().port}`;
  const result = await probeDaylight({ command: process.execPath,
    args: [fileURLToPath(new URL('../integrations/mcp-server.mjs', import.meta.url))],
    env: { DAYLIGHT_URL: serviceUrl },
    registration: registration({ enabled_tools: ['daylight_status', 'daylight_list_tasks'], disabled_tools: ['daylight_list_tasks'] }),
  });
  assert.deepEqual(result, { toolCount: 1, serviceUrl });
  assert.deepEqual(requests, [{ method: 'GET', path: '/api/bootstrap' }]);
});

test('disabled status tool prevents even the read-only probe call', async () => {
  await assert.rejects(probeDaylight({ command: process.execPath,
    args: [fileURLToPath(new URL('../integrations/mcp-server.mjs', import.meta.url))],
    env: { DAYLIGHT_URL: 'http://127.0.0.1:1' },
    registration: registration({ disabled_tools: ['daylight_status'] }),
  }), /status tool is unavailable/);
});

function previousSource() {
  const entry = registration({ enabled_tools: ['daylight_status'], disabled_tools: ['daylight_delete_task'] });
  entry.transport.command = 'C:\\Old Daylight\\node_modules\\electron\\dist\\electron.exe';
  entry.transport.args = ['C:\\Old Daylight\\integrations\\mcp-server.mjs'];
  entry.transport.env.EXTRA = 'preserve-fixture-value';
  entry.transport.cwd = 'C:\\Existing workspace';
  return entry;
}

test('read-only check refuses to migrate; ensure migrates once, reads CLI back and probes with preserved policies', async () => {
  const source = previousSource();
  let migrations = 0;
  const value = fixture(source, { migrate: async input => {
    migrations++;
    assert.deepEqual(input.registration, source);
    value.entry = { ...source, transport: { ...source.transport, command: input.desired.command, args: input.desired.args } };
    return { migrated: true, backupPath: 'isolated-fixture-backup' };
  } });
  assert.equal((await value.manager.check()).state, 'conflict');
  assert.equal(migrations, 0);
  assert.equal((await value.manager.ensure()).state, 'ready');
  assert.equal(migrations, 1);
  assert.equal(value.calls.filter(call => call.args[1] === 'get').length, 3);
  assert.equal(value.calls.some(call => call.args[1] === 'add' || call.args[1] === 'remove'), false);
  assert.equal(value.probes.length, 1);
  assert.deepEqual(value.probes[0].registration.disabled_tools, source.disabled_tools);
  assert.deepEqual(value.probes[0].registration.enabled_tools, source.enabled_tools);
  assert.equal(value.probes[0].registration.transport.cwd, source.transport.cwd);
  assert.equal(value.probes[0].env.EXTRA, 'preserve-fixture-value');
  await value.manager.ensure();
  assert.equal(migrations, 1, 'An already migrated runtime must not be migrated again');
});

test('matching, disabled and policy-disabled entries never call the migration callback', async () => {
  for (const entry of [registration(), { ...previousSource(), enabled: false }, { ...previousSource(), disabled_reason: 'policy' }]) {
    let migrations = 0;
    const value = fixture(entry, { migrate: async () => { migrations++; return { migrated: true }; } });
    const state = await value.manager.ensure();
    assert.equal(state.state, entry.enabled && !entry.disabled_reason ? 'ready' : 'disabled');
    assert.equal(migrations, 0);
  }
});

test('migration refusal or failure never falls back to destructive CLI replacement or starts a bridge', async () => {
  for (const fail of [false, true]) {
    const value = fixture(previousSource(), { migrate: async () => {
      if (fail) throw new Error('private-config-value');
      return { migrated: false, reason: 'changed' };
    } });
    const result = await value.manager.ensure();
    assert.equal(result.state, fail ? 'error' : 'conflict');
    assert.equal(result.registered, true);
    assert.equal(value.calls.length, 1);
    assert.equal(value.probes.length, 0);
    assert.equal(JSON.stringify(result).includes('private-config-value'), false);
  }
});

test('migration success requires matching CLI readback before any health probe', async () => {
  const value = fixture(previousSource(), { migrate: async () => ({ migrated: true }) });
  assert.equal((await value.manager.ensure()).state, 'conflict');
  assert.equal(value.calls.length, 2);
  assert.equal(value.probes.length, 0);
  let gets = 0;
  const unreadable = fixture(previousSource(), {
    migrate: async () => ({ migrated: true }),
    runCommand: async () => {
      if (++gets === 1) return { stdout: JSON.stringify(previousSource()) };
      throw new Error('private-readback-error');
    },
  });
  const status = await unreadable.manager.ensure();
  assert.equal(status.state, 'error');
  assert.equal(status.registered, true);
  assert.equal(unreadable.probes.length, 0);
  assert.equal(JSON.stringify(status).includes('private-readback-error'), false);
});

test('concurrent ensure requests share one migration and respect a newly disabled readback', async () => {
  let migrations = 0;
  const value = fixture(previousSource(), { migrate: async input => {
    migrations++;
    value.entry = registration({ enabled: false, transport: { ...input.registration.transport, command: input.desired.command, args: input.desired.args } });
    return { migrated: true };
  } });
  const replies = await Promise.all([value.manager.ensure(), value.manager.ensure(), value.manager.check()]);
  assert.ok(replies.every(reply => reply.state === 'disabled'));
  assert.equal(migrations, 1);
  assert.equal(value.probes.length, 0);
  assert.equal(value.calls.some(call => call.args[1] !== 'get'), false);
});
