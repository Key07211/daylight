import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import TOML from '@iarna/toml';
import { createApp } from '../server/app.mjs';
import { detectCodex } from '../server/scheduler.mjs';
import codexPath from './codex-path.cjs';

// Real Codex CLI + packaged Electron/ASAR, with an isolated CODEX_HOME and data.
// No registration, task, or preference in the user's profile is changed.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.runtime');
await fs.mkdir(runtime, { recursive: true });
const scratch = await fs.mkdtemp(path.join(runtime, 'mcp-migration-smoke-'));
const executable = path.resolve(process.argv[2] || path.join(root, 'release', 'win-unpacked', 'Daylight.exe'));
const bridge = path.join(path.dirname(executable), 'resources', 'app.asar', 'integrations', 'mcp-server.mjs');
const runFile = promisify(execFile);
let service;
try {
  const codex = await codexPath.resolveCodex(detectCodex);
  assert.equal(codex.info.available, true, 'This integration check needs the local Codex CLI.');
  service = await createApp({ dataDir: path.join(scratch, 'data'), distDir: path.join(root, 'dist'),
    codexCommand: codex.command, codexInfo: codex.info, startScheduler: false });
  const origin = await service.listen(0);
  const source = path.join(scratch, 'source');
  const oldExe = path.join(source, 'node_modules', 'electron', 'dist', 'electron.exe');
  const oldBridge = path.join(source, 'integrations', 'mcp-server.mjs');
  await fs.mkdir(path.dirname(oldExe), { recursive: true });
  await fs.mkdir(path.dirname(oldBridge), { recursive: true });
  await fs.writeFile(oldExe, 'identity fixture: never executed');
  await fs.copyFile(path.join(root, 'integrations', 'mcp-server.mjs'), oldBridge);
  await fs.copyFile(path.join(root, 'package.json'), path.join(source, 'package.json'));
  const configPath = path.join(scratch, 'config.toml');
  const config = { model: 'gpt-5', mcp_servers: { daylight: {
    command: oldExe, args: [oldBridge], enabled: true, disabled_tools: ['daylight_delete_task'],
    startup_timeout_sec: 20, tool_timeout_sec: 30,
    env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: origin, DAYLIGHT_FIXTURE_MARKER: 'preserve me' },
  } } };
  const before = `# Preserve this custom comment.\n${TOML.stringify(config)}`;
  await fs.writeFile(configPath, before);
  const runner = path.join(scratch, 'runner.cjs');
  const outputPath = path.join(scratch, 'result.json');
  await fs.writeFile(runner, `const fs=require('node:fs');
const {createDesktopMcp}=require(${JSON.stringify(path.join(path.dirname(executable), 'resources', 'app.asar', 'desktop', 'mcp-controller.cjs'))});
const manager=createDesktopMcp(${JSON.stringify({ codexCommand: codex.command, command: executable, bridge, origin, preferencesPath: path.join(scratch, 'preferences.json'), installedRuntime: true })});
(async()=>{const original=fs.readFileSync(${JSON.stringify(configPath)});const before=await manager.check();const checkPreserved=original.equals(fs.readFileSync(${JSON.stringify(configPath)}));if(!checkPreserved)throw new Error('Read-only check changed configuration');const after=await manager.start();fs.writeFileSync(${JSON.stringify(outputPath)},JSON.stringify({before,checkPreserved,after}));if(after.state!=='ready')process.exitCode=1;})().catch(()=>{process.exitCode=1});`);
  await runFile(executable, [runner], { windowsHide: true, timeout: 60000,
    env: { ...process.env, CODEX_HOME: scratch, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(result.before.state, 'conflict', 'Read-only check must not migrate');
  assert.equal(result.checkPreserved, true, 'Read-only check must leave config bytes unchanged');
  assert.equal(result.after.state, 'ready');
  assert.equal(result.after.toolCount, 13, 'Disabled tool must stay excluded');
  const after = await fs.readFile(configPath, 'utf8');
  const expected = structuredClone(config);
  expected.mcp_servers.daylight.command = executable;
  expected.mcp_servers.daylight.args = [bridge];
  assert.deepEqual(TOML.parse(after), expected);
  assert.ok(after.startsWith('# Preserve this custom comment.\n'));
  const backup = (await fs.readdir(scratch)).filter(name => name.startsWith('config.toml.daylight-backup-'));
  assert.equal(backup.length, 1);
  assert.equal(await fs.readFile(path.join(scratch, backup[0]), 'utf8'), before);
  assert.equal((await fs.readdir(scratch)).some(name => /\.lock$|\.tmp$/.test(name)), false);
  const report = { ok: true, realCodexCli: true, packagedAsar: true, readOnlyCheckPreserved: true,
    sourceToInstalledMigration: true, preservedPolicies: true, exactBackup: true,
    verifiedTools: result.after.toolCount, testDisabledTools: ['daylight_delete_task'],
    realUserConfigModified: false, realTasksModified: false };
  await fs.writeFile(path.join(runtime, 'mcp-migration-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await service?.close();
  const relative = path.relative(runtime, scratch);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await fs.rm(scratch, { recursive: true, force: true });
}
