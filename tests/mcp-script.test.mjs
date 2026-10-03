import test from 'node:test';
import assert from 'node:assert/strict';
import { connectCodexMcp, parseArguments, runCli } from '../scripts/connect-codex-mcp.mjs';
import { createMcpConnection } from '../desktop/mcp-connection.cjs';

test('manual CLI validates the port and accepts only its documented literal arguments', () => {
  assert.deepEqual(parseArguments([]), { port: 4317 });
  for (const port of ['1024', '4317', '65535']) assert.deepEqual(parseArguments(['--port', port]), { port: Number(port) });
  for (const args of [['--port', '80'], ['--port', '65536'], ['--port', '4317;calc'], ['--port', '1e4'],
    ['--port', '-1'], ['--port', 'NaN'], ['--port'], ['--other', '4317'], ['--port', '4317', 'extra']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('manual helper uses detected Codex and Node transport with separate literal args', async () => {
  let received;
  let ensures = 0;
  const detector = () => {};
  const result = await connectCodexMcp({ port: 4318, nodeCommand: 'C:\\Node App\\node.exe',
    bridge: 'C:\\Daylight App\\integrations\\mcp-server.mjs', detect: detector,
    resolve: async detect => { assert.equal(detect, detector); return { command: 'C:\\Codex App\\codex.exe', info: { available: true } }; },
    createConnection: options => { received = options; return { ensure: async () => { ensures++; return { state: 'ready' }; } }; },
  });
  assert.equal(result.state, 'ready');
  assert.equal(ensures, 1);
  assert.deepEqual(received, { codexCommand: 'C:\\Codex App\\codex.exe', command: 'C:\\Node App\\node.exe',
    args: ['C:\\Daylight App\\integrations\\mcp-server.mjs'], env: { DAYLIGHT_URL: 'http://127.0.0.1:4318' } });
});

test('invalid port or missing Codex cannot construct a connection manager', async () => {
  let resolutions = 0;
  const options = { resolve: async () => { resolutions++; return { info: { available: false } }; },
    createConnection: () => { assert.fail('No registration must be attempted'); } };
  for (const port of [null, true, -1, 65536, '1234;anything']) await assert.rejects(connectCodexMcp({ ...options, port }));
  assert.equal(resolutions, 0);
  assert.equal((await connectCodexMcp(options)).state, 'unavailable');
  assert.equal(resolutions, 1);
});

test('manual Node helper preserves an existing Electron registration through the real manager', async () => {
  const calls = [];
  const status = await connectCodexMcp({
    resolve: async () => ({ command: 'fixture-codex', info: { available: true } }),
    createConnection: options => createMcpConnection({ ...options,
      runCommand: async (_command, args) => {
        calls.push(args);
        assert.equal(args[1], 'get', 'The manual helper must never add over an Electron registration');
        return { stdout: JSON.stringify({ name: 'daylight', enabled: true, disabled_reason: null,
          transport: { type: 'stdio', command: 'C:\\Electron\\electron.exe', args: ['C:\\Daylight\\integrations\\mcp-server.mjs'],
            env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: 'http://127.0.0.1:4317' } },
          enabled_tools: ['daylight_status'], disabled_tools: ['daylight_delete_task'] }) };
      }, probe: async () => assert.fail('Different transport must not be started'),
    }),
  });
  assert.equal(status.state, 'conflict');
  assert.equal(status.registered, true);
  assert.equal(calls.length, 1);
});

test('CLI reports failure states honestly and does not expose raw diagnostic messages', async () => {
  for (const state of ['conflict', 'disabled', 'unavailable', 'missing', 'error']) {
    const output = [];
    const code = await runCli([], { connect: async () => ({ state, registered: state === 'error', message: 'secret detail' }),
      write: line => output.push(line), writeError: line => output.push(line) });
    assert.equal(code, 1);
    assert.equal(output.join('\n').includes('secret'), false);
    if (state === 'conflict' || state === 'disabled') assert.match(output.join('\n'), /unchanged/);
    if (state === 'error') assert.match(output.join('\n'), /health check failed/);
  }
});

test('CLI success requires ready status; invalid arguments never call connect', async () => {
  const output = [];
  const ready = await runCli(['--port', '4318'], { connect: async options => {
    assert.deepEqual(options, { port: 4318 });
    return { state: 'ready', toolCount: 14, serviceUrl: 'http://127.0.0.1:4318' };
  }, write: line => output.push(line) });
  assert.equal(ready, 0);
  assert.match(output.join('\n'), /14 tools/);
  assert.match(output.join('\n'), /new Codex chat/);
  assert.equal(await runCli(['--port', 'bad'], { connect: async () => assert.fail('Must not connect'), writeError: () => {} }), 1);
});
