import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createClaudeConnection, claudeTargets } from '../desktop/claude-connection.cjs';
import { createApp } from '../server/app.mjs';

const desired = {
  command: 'C:\\Daylight App\\Daylight.exe',
  args: ['C:\\Daylight App\\resources\\app.asar\\integrations\\mcp-server.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: 'http://127.0.0.1:4317' },
};

function fixture(t, { code = true, desktop = true, toolCount = 14 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-claude-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const codePath = path.join(directory, 'home', '.claude.json');
  const desktopPath = path.join(directory, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  if (code) fs.mkdirSync(path.join(directory, 'home', '.claude'), { recursive: true });
  if (desktop) fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
  const probes = [];
  const targets = () => [
    { id: 'code', label: 'Claude Code', configPath: codePath, entryType: 'stdio', installed: code },
    { id: 'desktop', label: 'Claude Desktop', configPath: desktopPath, installed: desktop },
  ];
  const probe = async input => {
    probes.push(input);
    if (!toolCount) throw new Error('down');
    return { toolCount, serviceUrl: desired.env.DAYLIGHT_URL };
  };
  const manager = createClaudeConnection({ ...desired, targets, probe, now: () => new Date('2026-10-14T03:00:00Z') });
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { directory, codePath, desktopPath, probes, manager, read };
}

test('Claude targets cover Claude Code, the roaming Claude Desktop profile and the Store package', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-claude-targets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { USERPROFILE: path.join(root, 'user'), APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local') };
  let [code, desktop] = claudeTargets(env, { platform: 'win32' });
  assert.equal(code.configPath, path.join(env.USERPROFILE, '.claude.json'));
  assert.equal(code.entryType, 'stdio');
  assert.equal(code.installed, false);
  assert.equal(desktop.configPath, path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json'));
  assert.equal(desktop.installed, false);

  fs.mkdirSync(path.join(env.USERPROFILE, '.claude'), { recursive: true });
  const store = path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
  fs.mkdirSync(store, { recursive: true });
  [code, desktop] = claudeTargets(env, { platform: 'win32' });
  assert.equal(code.installed, true);
  assert.equal(desktop.configPath, path.join(store, 'claude_desktop_config.json'));
  assert.equal(desktop.installed, true);

  const custom = path.join(root, 'claude-config');
  fs.mkdirSync(custom);
  [code] = claudeTargets({ ...env, CLAUDE_CONFIG_DIR: custom }, { platform: 'win32' });
  assert.equal(code.configPath, path.join(custom, '.claude.json'));
});

test('without Claude installed nothing is written and the state is unavailable', async t => {
  const { manager, codePath, desktopPath, probes } = fixture(t, { code: false, desktop: false });
  const status = await manager.ensure();
  assert.equal(status.state, 'unavailable');
  assert.equal(status.registered, false);
  assert.deepEqual(status.clients.map(client => client.state), ['unavailable', 'unavailable']);
  assert.equal(fs.existsSync(codePath), false);
  assert.equal(fs.existsSync(desktopPath), false);
  assert.equal(probes.length, 0);
});

test('check is read-only; ensure registers both clients, preserves other settings and verifies once', async t => {
  const { manager, codePath, desktopPath, probes, read } = fixture(t);
  const codeOriginal = { numStartups: 7, projects: { 'C:\\work': { allowedTools: [] } }, mcpServers: { other: { type: 'stdio', command: 'x', args: [] } } };
  fs.writeFileSync(codePath, JSON.stringify(codeOriginal));
  fs.writeFileSync(desktopPath, JSON.stringify({ globalShortcut: 'Ctrl+Space' }));

  const checked = await manager.check();
  assert.equal(checked.state, 'missing');
  assert.equal(probes.length, 0);
  assert.deepEqual(read(codePath), codeOriginal);

  const status = await manager.ensure();
  assert.equal(status.state, 'ready');
  assert.equal(status.toolCount, 14);
  assert.deepEqual(status.clients.map(client => [client.id, client.state]), [['code', 'ready'], ['desktop', 'ready']]);
  assert.equal(probes.length, 1);
  assert.equal(probes[0].command, desired.command);
  assert.deepEqual(probes[0].args, desired.args);

  const code = read(codePath);
  assert.equal(code.numStartups, 7);
  assert.deepEqual(code.projects, codeOriginal.projects);
  assert.deepEqual(code.mcpServers.other, codeOriginal.mcpServers.other);
  assert.deepEqual(code.mcpServers.daylight, { type: 'stdio', ...desired });
  const desktop = read(desktopPath);
  assert.equal(desktop.globalShortcut, 'Ctrl+Space');
  assert.deepEqual(desktop.mcpServers.daylight, desired);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${codePath}.daylight-backup`, 'utf8')), codeOriginal);

  const before = fs.readFileSync(codePath, 'utf8');
  const again = await manager.ensure();
  assert.equal(again.state, 'ready');
  assert.equal(again.clients.some(client => client.changed), false);
  assert.equal(fs.readFileSync(codePath, 'utf8'), before);
});

test('a missing config file is created only for an installed client', async t => {
  const { manager, codePath, desktopPath, read } = fixture(t, { desktop: false });
  const status = await manager.ensure();
  assert.equal(status.state, 'ready');
  assert.deepEqual(read(codePath), { mcpServers: { daylight: { type: 'stdio', ...desired } } });
  assert.equal(fs.existsSync(desktopPath), false);
  assert.equal(fs.existsSync(`${codePath}.daylight-backup`), false);
});

test('a different daylight entry is a conflict and is never replaced', async t => {
  const { manager, codePath, desktopPath, read, probes } = fixture(t, { desktop: false });
  const foreign = { mcpServers: { daylight: { command: 'npx', args: ['some-other-daylight'] } } };
  fs.writeFileSync(codePath, JSON.stringify(foreign));
  const status = await manager.ensure();
  assert.equal(status.state, 'conflict');
  assert.deepEqual(read(codePath), foreign);
  assert.equal(probes.length, 0);
  assert.equal(fs.existsSync(desktopPath), false);
});

test('an older Daylight bridge entry is repointed and its extra environment kept', async t => {
  const { manager, desktopPath, read } = fixture(t, { code: false });
  fs.writeFileSync(desktopPath, JSON.stringify({ mcpServers: { daylight: {
    command: 'C:\\src\\daylight\\node_modules\\electron\\dist\\electron.exe',
    args: ['C:\\src\\daylight\\integrations\\mcp-server.mjs'],
    env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: 'http://127.0.0.1:4317', EXTRA: 'kept' },
  } } }));
  assert.equal((await manager.check()).state, 'conflict');
  const status = await manager.ensure();
  assert.equal(status.state, 'ready');
  assert.deepEqual(read(desktopPath).mcpServers.daylight, { ...desired, env: { ...desired.env, EXTRA: 'kept' } });
});

test('unreadable configuration is left untouched and reported', async t => {
  const { manager, codePath } = fixture(t, { desktop: false });
  fs.writeFileSync(codePath, '{ not json');
  const status = await manager.ensure();
  assert.equal(status.state, 'error');
  assert.equal(fs.readFileSync(codePath, 'utf8'), '{ not json');
});

test('a failed health check is not reported as ready', async t => {
  const { manager } = fixture(t, { toolCount: 0 });
  const status = await manager.ensure();
  assert.equal(status.state, 'error');
  assert.equal(status.registered, true);
  assert.ok(status.clients.every(client => client.state === 'error'));
});

test('end to end: the registered entry lets a Claude client add and complete a real task', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-claude-e2e-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = await createApp({ dataDir: path.join(directory, 'data'), distDir: path.join(directory, 'dist'),
    codexInfo: { available: false }, startScheduler: false, allowedOrigins: [] });
  const origin = await service.listen(0);
  t.after(() => service.close());
  const configPath = path.join(directory, 'claude_desktop_config.json');
  const bridge = fileURLToPath(new URL('../integrations/mcp-server.mjs', import.meta.url));
  const manager = createClaudeConnection({ command: process.execPath, args: [bridge], env: { DAYLIGHT_URL: origin },
    targets: () => [{ id: 'desktop', label: 'Claude Desktop', configPath, installed: true }] });
  const status = await manager.ensure();
  assert.equal(status.state, 'ready', status.message);
  assert.equal(status.toolCount, 14);

  // Launch the server exactly as Claude Desktop would from its config file.
  const entry = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.daylight;
  const transport = new StdioClientTransport({ command: entry.command, args: entry.args, env: { ...process.env, ...entry.env }, stderr: 'pipe' });
  const client = new Client({ name: 'claude-ai', version: '0.1.0' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.match(client.getInstructions(), /local Windows to-do list/);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const time = await call('daylight_status');
  assert.ok(time.timeZone && Number.isInteger(time.utcOffsetMinutes) && time.serverTime);
  const added = await call('daylight_add_task', { title: '整理阅读笔记', priority: 'high', dueAt: '2026-10-15T20:00:00+08:00' });
  assert.equal(service.store.data.tasks[0].title, '整理阅读笔记');
  await call('daylight_update_task', { id: added.id, completed: true });
  assert.equal(service.store.data.tasks.find(task => task.id === added.id).completed, true);
});
