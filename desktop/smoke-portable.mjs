import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Runs the actual self-extracting launcher, without installing it or touching
// the normal Daylight profile. Reports and screenshots survive profile cleanup.
const root = fileURLToPath(new URL('../', import.meta.url));
const packageInfo = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const executable = path.resolve(process.argv[2] || path.join(root, 'release', `Daylight-Portable-${packageInfo.version}.exe`));
const runtime = path.join(root, '.runtime');
const output = path.join(runtime, 'portable-smoke.json');
const timeoutMs = 150000;
const runFile = promisify(execFile);
await fs.mkdir(runtime, { recursive: true });
const runDir = await fs.mkdtemp(path.join(runtime, 'portable-smoke-'));
const reportPath = path.join(runDir, 'desktop-smoke.json');
const logPath = path.join(runDir, 'portable-process.log');
const profileDir = path.join(runDir, 'daylight-smoke-profile');
const dataDir = path.join(profileDir, 'data');
const preferencesPath = path.join(profileDir, 'window-preferences.json');
let phase = 'prepare', processStarted = false, processClosed = false, profileCleaned = false;
let failure, report, expectedChecks = [], port;

function normalized(value) {
  const result = path.resolve(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const assigned = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return assigned;
}

async function runPortable() {
  const env = { ...process.env, DAYLIGHT_PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;
  // The launcher must supply its own portable environment, not inherit one
  // from the shell that invokes this verification script.
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  let log = '';
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, ['--smoke-test', reportPath], {
        cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      processStarted = Boolean(child.pid);
      let settled = false, stopReason, closeDeadline;
      const append = chunk => { log = (log + chunk.toString()).slice(-100000); };
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(closeDeadline);
        process.removeListener('SIGINT', interrupted);
        process.removeListener('SIGTERM', interrupted);
        error ? reject(error) : resolve();
      };
      const stop = async reason => {
        if (settled || stopReason) return;
        stopReason = reason;
        // Only this launcher PID and its descendants may be terminated.
        closeDeadline = setTimeout(() => finish(new Error(`${reason.message} Process closure could not be confirmed; the isolated profile was retained.`)), 16000);
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          if (process.platform === 'win32') {
            await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => child.kill());
          } else child.kill('SIGKILL');
        }
      };
      const interrupted = () => void stop(new Error('Portable smoke was interrupted.'));
      const timer = setTimeout(() => void stop(new Error(`Portable smoke exceeded ${timeoutMs / 1000} seconds. See ${logPath}`)), timeoutMs);
      process.once('SIGINT', interrupted);
      process.once('SIGTERM', interrupted);
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.once('error', error => { stopReason ||= error; });
      child.once('close', code => {
        // The NSIS portable launcher uses ExecWait for the inner Electron app,
        // then removes its extraction directory before returning its exit code.
        processClosed = true;
        finish(stopReason || (code === 0 ? null : new Error(`Portable launcher exited ${code}. See ${logPath}`)));
      });
    });
  } finally {
    await fs.writeFile(logPath, log);
  }
}

async function cleanOwnedProfile() {
  if (processStarted && !processClosed) return;
  const stat = await fs.lstat(profileDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return;
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Refusing to clean a redirected profile');
  const [realRuntime, realRunDir, realProfile] = await Promise.all([fs.realpath(runtime), fs.realpath(runDir), fs.realpath(profileDir)]);
  assert.ok(isInside(realRuntime, realRunDir) && /^portable-smoke-[^\\/]+$/.test(path.relative(realRuntime, realRunDir)), 'Run directory escaped its generated temporary root');
  assert.equal(normalized(realProfile), normalized(path.join(realRunDir, 'daylight-smoke-profile')), 'Profile cleanup escaped the owned run directory');
  // The resolved absolute directory has now been checked; reports are siblings.
  await fs.rm(realProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  profileCleaned = true;
}

try {
  assert.equal(process.platform, 'win32', 'The Windows portable launcher must be tested on Windows');
  assert.ok((await fs.stat(executable)).isFile(), `Portable executable is missing: ${executable}`);
  const source = await fs.readFile(path.join(root, 'desktop', 'ui-smoke.cjs'), 'utf8');
  assert.ok(!/\.\.\/src\//.test(source), 'UI smoke must not depend on unbundled source files');
  expectedChecks = [...new Set([...source.matchAll(/checks\.([A-Za-z_]\w*)\s*=/g)].map(match => match[1]))].sort();
  assert.ok(expectedChecks.length >= 116, 'The current complete UI suite must include at least116 checks');
  for (const name of ['startupCompletesAllPhases', 'startupClaimIsProcessScoped', 'startupDoesNotMutateTasks',
    'weatherPreviewSurvivesSessionReload', 'automaticNightAt19', 'automaticDayAt07', 'mcpSmokeCannotChangeRealConfig']) {
    assert.ok(expectedChecks.includes(name), `Required current UI check is missing: ${name}`);
  }
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(preferencesPath, JSON.stringify({ alwaysOnTop: true }));
  port = await freePort();
  phase = 'portable-ui';
  await runPortable();
  phase = 'verify-report';
  report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.ok, true, report.error);
  assert.equal(report.packaged, true);
  assert.equal(report.version, packageInfo.version);
  assert.equal(report.nativeInfo?.version, packageInfo.version);
  assert.equal(report.nativeInfo?.isPackaged, true);
  assert.equal(report.nativeInfo?.alwaysOnTop, true);
  assert.equal(report.nativeInfo?.autoLaunch, false, 'Smoke mode must not enable native autostart');
  assert.equal(normalized(report.dataPath), normalized(dataDir), 'Main process must use the isolated data directory');
  assert.equal(normalized(report.nativeInfo.dataPath), normalized(dataDir), 'Renderer must use the isolated data directory');
  assert.ok(path.isAbsolute(report.executable), 'The report must identify its actual Electron executable');
  assert.equal(path.basename(report.executable).toLowerCase(), 'daylight.exe');
  assert.notEqual(normalized(report.executable), normalized(executable), 'The portable wrapper must launch its extracted app');
  const origin = new URL(report.origin);
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(Number(origin.port), port);
  for (const key of ['apiAvailable', 'rendererLoaded', 'nodeUnavailable', 'pinButtonAvailable', 'cornerNotesRemoved', 'trayAvailable']) {
    assert.equal(report[key], true, `${key} must be verified`);
  }
  assert.equal(report.notificationsEnabled, false);
  assert.equal(report.windowSecurity?.contextIsolation, true);
  assert.equal(report.windowSecurity?.nodeIntegration, false);
  assert.equal(report.windowSecurity?.sandbox, true);
  assert.deepEqual(Object.keys(report.interfaceChecks?.checks || {}).sort(), expectedChecks, 'Every current UI check must run in the portable payload');
  for (const [name, passed] of Object.entries(report.interfaceChecks.checks)) assert.equal(passed, true, `UI check failed: ${name}`);
  assert.deepEqual(report.bridgeMethods, ['claimStartup', 'getInfo', 'setTheme', 'setAlwaysOnTop', 'setAutoLaunch', 'openDataFolder', 'installMcp', 'getMcpStatus', 'checkMcp', 'setMcpAutoConnect', 'onMcpStatus',
    'getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'setUpdateEditing', 'onUpdateStatus']);
  assert.deepEqual(report.updateSafety, { disabledInSmoke: true, noUpdateWork: true, invalidEditingRejected: true });
  assert.deepEqual(report.pinning, { initialPinStateMatches: true, invalidPinRejected: true, invalidPinPreservedState: true, pinEnabled: true, pinDisabled: true });
  assert.equal(JSON.parse(await fs.readFile(preferencesPath, 'utf8')).alwaysOnTop, false);
  const store = JSON.parse(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'));
  assert.deepEqual(store.tasks, [], 'UI fixtures must be removed from the isolated store');
  assert.deepEqual(store.runs, [], 'Smoke mode must not execute Codex tasks');
  assert.equal(store.settings.desktopNotifications, false);
} catch (error) {
  failure = error;
} finally {
  try { await cleanOwnedProfile(); } catch (error) { failure ||= error; }
}

const summary = {
  ok: !failure, phase: failure ? phase : 'complete', version: report?.version || packageInfo.version,
  executable, packaged: report?.packaged === true, expectedUiChecks: expectedChecks.length,
  passedUiChecks: Object.values(report?.interfaceChecks?.checks || {}).filter(value => value === true).length,
  timeoutMs, processStarted, processClosed, isolatedProfile: profileDir, profileCleaned,
  port, report: reportPath, processLog: logPath,
  nativeBoundary: {
    autoLaunchEnabled: report?.nativeInfo?.autoLaunch ?? null,
    mcpConfigurationUnavailableVerified: report?.interfaceChecks?.checks?.mcpSmokeCannotChangeRealConfig === true,
    updateBridgeAvailable: ['getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'setUpdateEditing', 'onUpdateStatus'].every(method => report?.bridgeMethods?.includes(method)),
    portableSpecificRejectionCallsTested: false,
    note: 'The exposed smoke report verifies autostart is off and MCP configuration is unavailable. Smoke mode also disables these capabilities; portable-only rejection branches are not independently exercised.',
  },
  isolation: { actualUserProfileAccessedByHarness: false, codexConfigAccessedByHarness: false, testMode: '--smoke-test' },
  ...(failure ? { error: failure.message } : {}),
};
await fs.writeFile(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, summary: output }, null, 2));
if (failure) process.exitCode = 1;
