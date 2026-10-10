import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import asar from '@electron/asar';
import yaml from 'js-yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../server/app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = path.resolve(process.argv[2] || path.join(root, 'release', 'win-unpacked', 'Daylight.exe'));
const runtime = path.join(root, '.runtime');
const output = path.join(runtime, 'desktop-smoke-packaged.json');
const runFile = promisify(execFile);
const guiTimeoutMs = 120000;
await fs.mkdir(runtime, { recursive: true });
const runDir = await fs.mkdtemp(path.join(runtime, 'packaged-smoke-'));
const childOutput = path.join(runDir, 'desktop-smoke.json');
const logPath = path.join(runDir, 'desktop-process.log');
const profileDir = path.join(runDir, 'daylight-smoke-profile');
const preferencesPath = path.join(profileDir, 'window-preferences.json');
let phase = 'archive';

function isInside(parent, value) {
  const relative = path.relative(path.resolve(parent), path.resolve(value));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stopOwnedChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Scope termination to this exact spawned PID and its descendants, never an image name.
    await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => child.kill());
  } else child.kill('SIGKILL');
}
async function runGui(port) {
  const env = { ...process.env, DAYLIGHT_PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;
  let log = '';
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, ['--smoke-test', childOutput], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
      let settled = false, stopping = null;
      const append = chunk => { log = (log + chunk.toString()).slice(-100000); };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        process.removeListener('SIGINT', interrupted);
        process.removeListener('SIGTERM', interrupted);
        error ? reject(error) : resolve();
      };
      const stop = async reason => {
        if (stopping || settled) return;
        stopping = reason;
        await stopOwnedChild(child);
        finish(reason);
      };
      const interrupted = () => void stop(new Error('Packaged smoke interrupted; its process tree was stopped.'));
      const timer = setTimeout(() => void stop(new Error(`Packaged UI smoke exceeded ${guiTimeoutMs / 1000} seconds. See ${logPath}`)), guiTimeoutMs);
      process.once('SIGINT', interrupted);
      process.once('SIGTERM', interrupted);
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.once('error', finish);
      child.once('close', code => finish(stopping || (code === 0 ? null : new Error(`Packaged app exited ${code}. See ${logPath}\n${log.slice(-4000)}`))));
    });
  } finally {
    await fs.writeFile(logPath, log);
  }
}

try {
  assert.ok((await fs.stat(executable)).isFile(), 'Packaged executable is missing');
  const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
  assert.ok((await fs.stat(archive)).isFile(), 'App must load from resources/app.asar');
  const archiveFiles = new Set(asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
  const requiredFiles = ['package.json', 'dist/index.html', 'desktop/main.cjs', 'desktop/preload.cjs',
    'desktop/ui-smoke.cjs', 'desktop/codex-path.cjs', 'desktop/mcp-controller.cjs', 'desktop/mcp-connection.cjs', 'desktop/mcp-migration.cjs',
    'desktop/update-controller.cjs', 'desktop/update-service.cjs', 'node_modules/electron-updater/package.json', 'node_modules/electron-updater/out/main.js',
    'server/app.mjs', 'server/store.mjs', 'server/scheduler.mjs', 'integrations/mcp-server.mjs'];
  for (const entry of requiredFiles) assert.ok(archiveFiles.has(entry), `Missing packaged dependency: ${entry}`);
  const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const sourcePackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageInfo.version, sourcePackage.version, 'The packaged app must match the current release version');
  assert.ok(packageInfo.dependencies?.['electron-updater'], 'Updater must be a production dependency');
  assert.equal(packageInfo.dependencies['electron-updater'], sourcePackage.dependencies['electron-updater']);
  const updaterConfigPath = path.join(path.dirname(executable), 'resources', 'app-update.yml');
  const updaterConfig = yaml.load(await fs.readFile(updaterConfigPath, 'utf8'));
  assert.equal(updaterConfig?.provider, 'github', 'Packaged updater must use GitHub Releases');
  assert.equal(updaterConfig.owner, 'Key07211', 'Updater owner must match the public repository');
  assert.equal(updaterConfig.repo, 'daylight', 'Updater repository must match the public repository');
  assert.notEqual(updaterConfig.private, true, 'Public releases must not require an embedded GitHub credential');
  const uiSmokeSource = asar.extractFile(archive, 'desktop/ui-smoke.cjs').toString('utf8');
  assert.ok(!/\.\.\/src\//.test(uiSmokeSource), 'Packaged UI smoke must not import unbundled source files');
  const expectedChecks = [...new Set([...uiSmokeSource.matchAll(/checks\.([A-Za-z_]\w*)\s*=/g)].map(match => match[1]))].sort();
  assert.ok(expectedChecks.length >= 99, 'Packaged app is missing the current comprehensive UI checks');
  for (const check of ['startupCompletesAllPhases', 'startupBlocksWorkspaceInteraction', 'startupTrapsFocusAndShortcuts',
    'startupHideEndsWithoutReplay', 'startupReloadDoesNotReplay', 'startupClaimIsProcessScoped',
    'reducedMotionImmediatelyEndsStartup', 'weatherPreviewSurvivesSessionReload']) {
    assert.ok(expectedChecks.includes(check), `Packaged app is missing startup lifecycle check: ${check}`);
  }
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(preferencesPath, JSON.stringify({ alwaysOnTop: true }));

  phase = 'desktop-ui';
  const port = await freePort();
  await runGui(port);
  const report = JSON.parse(await fs.readFile(childOutput, 'utf8'));
  assert.equal(report.ok, true, report.error);
  assert.equal(report.packaged, true);
  assert.equal(report.version, packageInfo.version);
  assert.equal(path.resolve(report.executable).toLowerCase(), executable.toLowerCase());
  assert.equal(report.nativeInfo.isPackaged, true);
  assert.equal(report.nativeInfo.alwaysOnTop, true);
  assert.ok(isInside(profileDir, report.nativeInfo.dataPath), 'UI test must use its isolated profile');
  assert.equal(report.rendererLoaded, true);
  assert.equal(report.nodeUnavailable, true);
  assert.equal(report.notificationsEnabled, false);
  assert.equal(report.pinButtonAvailable, true);
  assert.equal(report.cornerNotesRemoved, true);
  assert.equal(report.windowSecurity.contextIsolation, true);
  assert.equal(report.windowSecurity.nodeIntegration, false);
  assert.equal(report.windowSecurity.sandbox, true);
  assert.deepEqual(Object.keys(report.interfaceChecks?.checks || {}).sort(), expectedChecks, 'Every packaged UI check must execute');
  for (const [name, passed] of Object.entries(report.interfaceChecks.checks)) assert.equal(passed, true, `UI check failed: ${name}`);
  assert.deepEqual(report.bridgeMethods, ['claimStartup', 'getInfo', 'setTheme', 'setAlwaysOnTop', 'setAutoLaunch', 'openDataFolder', 'installMcp', 'getMcpStatus', 'checkMcp', 'setMcpAutoConnect', 'onMcpStatus',
    'getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'setUpdateEditing', 'onUpdateStatus']);
  assert.deepEqual(report.updateSafety, { disabledInSmoke: true, noUpdateWork: true, invalidEditingRejected: true });
  assert.deepEqual(report.pinning, { initialPinStateMatches: true, invalidPinRejected: true, invalidPinPreservedState: true, pinEnabled: true, pinDisabled: true });
  assert.equal(JSON.parse(await fs.readFile(preferencesPath, 'utf8')).alwaysOnTop, false);

  phase = 'packaged-mcp';
  const apiDir = await fs.mkdtemp(path.join(runDir, 'mcp-data-'));
  const api = await createApp({ dataDir: apiDir, codexInfo: { available: false }, startScheduler: false });
  const client = new Client({ name: 'daylight-packaged-smoke', version: '1.0.0' });
  let transport, mcpLog = '', createdId;
  try {
    const apiUrl = await api.listen(0);
    const bridge = path.join(archive, 'integrations', 'mcp-server.mjs');
    transport = new StdioClientTransport({ command: executable, args: [bridge],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: apiUrl }, stderr: 'pipe' });
    transport.stderr?.on('data', chunk => { mcpLog = (mcpLog + chunk.toString()).slice(-30000); });
    await client.connect(transport, { timeout: 20000 });
    const tools = await client.listTools({}, { timeout: 20000 });
    assert.equal(tools.tools.length, 14);
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
      const text = result.content.find(item => item.type === 'text')?.text;
      assert.notEqual(result.isError, true, text);
      assert.ok(text, `${name} must return a JSON result`);
      return JSON.parse(text);
    };
    assert.deepEqual((await call('daylight_list_tasks')).tasks, []);
    const task = await call('daylight_add_task', { title: 'Packaged MCP smoke task', reminderAt: null, automation: { enabled: false } });
    createdId = task.id;
    assert.ok(createdId);
    assert.equal(task.title, 'Packaged MCP smoke task');
    const updated = await call('daylight_update_task', { id: createdId, title: 'Packaged MCP verified', notes: 'Isolated packaging test', priority: 'high' });
    assert.equal(updated.title, 'Packaged MCP verified');
    assert.equal(updated.priority, 'high');
    const completed = await call('daylight_update_task', { id: createdId, completed: true });
    assert.equal(completed.completed, true);
    const readback = await call('daylight_list_tasks', { completed: true });
    assert.equal(readback.tasks.length, 1);
    assert.equal(readback.tasks[0].id, createdId);
    const deleted = await call('daylight_delete_task', { id: createdId });
    assert.equal(deleted.ok, true);
    createdId = null;
    assert.deepEqual((await call('daylight_list_tasks')).tasks, []);
    report.packagedMcp = { ok: true, toolCount: tools.tools.length, runtime: 'Electron ELECTRON_RUN_AS_NODE',
      bridgeInAsar: true, mutationVerified: true, operations: ['create', 'update', 'complete', 'read', 'delete'], isolatedData: true };
  } finally {
    // This is an otherwise-empty temporary store; even a failed test cannot alter real tasks.
    if (createdId) await client.callTool({ name: 'daylight_delete_task', arguments: { id: createdId } }, undefined, { timeout: 5000 }).catch(() => {});
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
    await api.close();
    await fs.writeFile(path.join(runDir, 'mcp-process.log'), mcpLog);
    const realRunDir = await fs.realpath(runDir);
    const realApiDir = await fs.realpath(apiDir);
    assert.ok(isInside(realRunDir, realApiDir), 'Temporary-store cleanup escaped the smoke directory');
    await fs.rm(realApiDir, { recursive: true, force: true });
  }
  report.packagingVerification = { archive, requiredFileCount: requiredFiles.length, expectedUiChecks: expectedChecks.length,
    updater: { configPath: updaterConfigPath, provider: updaterConfig.provider, owner: updaterConfig.owner, repo: updaterConfig.repo,
      productionDependency: true, controllerIncluded: true, serviceIncluded: true },
    guiTimeoutMs, isolatedProfile: profileDir, processLog: logPath, realUserConfigModified: false };
  await fs.writeFile(childOutput, JSON.stringify(report, null, 2));
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, version: report.version, packaged: true, uiChecks: expectedChecks.length,
    nativeInfo: report.nativeInfo, pinning: report.pinning, packagedMcp: report.packagedMcp, report: output }, null, 2));
} catch (error) {
  await fs.writeFile(output, JSON.stringify({ ok: false, phase, error: error.message, executable, runDirectory: runDir, processLog: logPath }, null, 2));
  throw error;
}
