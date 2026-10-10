'use strict';

// Runs the real Electron HTTP downloader against a loopback server. Installation
// is spied on and additionally blocked at its execution hooks. No real app,
// registry, task store, Codex configuration, or user update cache is accessed.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const yaml = require('js-yaml');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor, getNetSession } = require('electron-updater/out/electronHttpExecutor');
const { createUpdateController } = require('./update-controller.cjs');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const runDirectory = fs.mkdtempSync(path.join(runtime, 'update-download-'));
const electronProfile = path.join(runDirectory, 'electron-profile');
fs.mkdirSync(electronProfile);
app.setName('Daylight isolated update download check');
app.setPath('userData', electronProfile);
app.disableHardwareAcceleration();
const fixtureOnly = process.argv.includes('--fixture');
const reportPath = path.join(runtime, fixtureOnly ? 'update-download-fixture.json' : 'update-download-smoke.json');
const report = { fixtureOnly, isolated: true, installerExecuted: false, appRestarted: false, externalRequests: 0, checks: [], scenarios: [] };
let service;
const controllers = [];
const watchdog = setTimeout(() => {
  console.error('Real updater smoke exceeded 120 seconds; no installer was executed.');
  app.exit(1);
}, 120000);

async function hashFile(filename) {
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('base64');
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function run() {
  await app.whenReady();
  const packageInfo = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  const version = packageInfo.version;
  assert.notEqual(version, '0.3.0', 'A newer build is required to simulate updating from 0.3.0');
  const installerName = `Daylight-Setup-${version}.exe`;
  let installerPath = path.join(root, 'release', installerName);
  let manifest;
  if (fixtureOnly) {
    installerPath = path.join(runDirectory, installerName);
    const fixture = Buffer.alloc(2 * 1024 * 1024, 23);
    fixture.write('MZ');
    await fsp.writeFile(installerPath, fixture);
    const sha512 = await hashFile(installerPath);
    manifest = { version, files: [{ url: installerName, sha512, size: fixture.length }], path: installerName, sha512, releaseDate: new Date().toISOString() };
  } else {
    const { verifyUpdateRelease } = await import(pathToFileURL(path.join(root, 'scripts', 'verify-update-release.mjs')).href);
    await verifyUpdateRelease();
    manifest = yaml.load(await fsp.readFile(path.join(root, 'release', 'latest.yml'), 'utf8'));
    report.checks.push('built-installer-and-update-metadata-verified');
  }
  const installerSize = (await fsp.stat(installerPath)).size;
  const installerSha512 = await hashFile(installerPath);
  assert.equal(manifest.files[0].sha512, installerSha512);
  assert.equal(manifest.files[0].size, installerSize);
  report.version = version;
  report.installerSize = installerSize;
  report.installerSha512 = installerSha512;
  const requests = { good: { metadata: 0, installer: 0 }, tampered: { metadata: 0, installer: 0 } };
  const corruptManifest = structuredClone(manifest);
  corruptManifest.sha512 = Buffer.alloc(64).toString('base64');
  corruptManifest.files[0].sha512 = corruptManifest.sha512;
  const manifests = { good: yaml.dump(manifest), tampered: yaml.dump(corruptManifest) };
  service = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const match = /^\/(good|tampered)\/([^/]+)$/.exec(pathname);
    if (request.method !== 'GET' || !match) {
      response.writeHead(404).end();
      return;
    }
    const [, scenario, filename] = match;
    if (filename === 'latest.yml') {
      requests[scenario].metadata += 1;
      response.writeHead(200, { 'Content-Type': 'text/yaml', 'Cache-Control': 'no-store' });
      response.end(manifests[scenario]);
    } else if (filename === installerName) {
      requests[scenario].installer += 1;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installerSize, 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(installerPath);
      stream.once('error', () => response.destroy());
      response.once('close', () => stream.destroy());
      stream.pipe(response);
    } else response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    service.once('error', reject);
    service.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${service.address().port}`;
  const netSession = getNetSession();
  await netSession.setProxy({ mode: 'direct' });
  netSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = new URL(details.url).origin === origin;
    if (!allowed) report.externalRequests += 1;
    callback({ cancel: !allowed });
  });

  for (const scenario of ['good', 'tampered']) {
    const scenarioRoot = path.join(runDirectory, scenario);
    const userDataPath = path.join(scenarioRoot, 'profile');
    const baseCachePath = path.join(scenarioRoot, 'cache');
    const configPath = path.join(scenarioRoot, 'app-update.yml');
    await fsp.mkdir(userDataPath, { recursive: true });
    await fsp.writeFile(configPath, yaml.dump({ provider: 'generic', url: `${origin}/${scenario}/`, updaterCacheDirName: 'isolated-updater' }));
    const forbidden = () => { throw new Error('Smoke safety guard: an installer or app restart must never execute'); };
    const adapter = {
      version: '0.3.0', name: 'Daylight isolated updater', isPackaged: true,
      appUpdateConfigPath: configPath, userDataPath, baseCachePath,
      whenReady: () => app.whenReady(), quit: forbidden, relaunch: forbidden, onQuit: forbidden,
    };
    const updater = new NsisUpdater(undefined, adapter);
    updater.httpExecutor = new ElectronHttpExecutor();
    updater.logger = null;
    updater.disableWebInstaller = true;
    // This check covers full download integrity; delta downloads require a real
    // previous installation and are deliberately outside this isolated check.
    updater.disableDifferentialDownload = true;
    updater.doInstall = forbidden;
    updater.spawnLog = forbidden;
    const installCalls = [];
    updater.quitAndInstall = (...args) => { installCalls.push({ args, at: performance.now() }); };
    const errors = [];
    const states = [];
    let downloadedAt = null;
    updater.on('error', error => errors.push(error.code || error.message));
    updater.on('update-downloaded', () => { downloadedAt = performance.now(); });
    const controller = createUpdateController({ updater, currentVersion: '0.3.0', notify: state => states.push(state) });
    controllers.push(controller);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    await controller.check();
    assert.equal(controller.getStatus().state, 'available', `${scenario}: real updater must discover the release`);
    assert.equal(controller.getStatus().version, version);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(requests[scenario].metadata > 0);
    assert.equal(requests[scenario].installer, 0, 'Checking must not download the installer before a click');
    assert.equal(installCalls.length, 0);
    await controller.download();
    assert.equal(requests[scenario].installer, 1, 'The requested installer must be fetched once over loopback');
    const result = { scenario, metadataRequests: requests[scenario].metadata, installerRequests: requests[scenario].installer, state: controller.getStatus().state };
    if (scenario === 'good') {
      assert.equal(controller.getStatus().state, 'installing');
      assert.equal(errors.length, 0, `Unexpected update errors: ${errors.join(', ')}`);
      assert.equal(installCalls.length, 1);
      assert.deepEqual(installCalls[0].args, [true, true], 'Verified download must immediately request silent install and restart');
      assert.ok(downloadedAt !== null);
      const restartDelayMs = installCalls[0].at - downloadedAt;
      assert.ok(restartDelayMs >= 0 && restartDelayMs < 1000, 'There must be no countdown after download verification');
      assert.ok(states.some(state => state.progress?.percent > 0), 'Real download progress must reach the controller');
      assert.ok(inside(baseCachePath, updater.installerPath), 'Download must remain in this test cache');
      assert.equal(await hashFile(updater.installerPath), installerSha512, 'Downloaded installer must exactly match the built file');
      Object.assign(result, { restartDelayMs: Math.round(restartDelayMs), installArguments: installCalls[0].args, downloadedHashVerified: true, progressObserved: true });
      report.checks.push('check-does-not-download', 'explicit-download-uses-real-http', 'sha512-and-cache-verified', 'immediate-silent-install-and-restart-requested');
    } else {
      assert.equal(controller.getStatus().state, 'error');
      assert.equal(controller.getStatus().errorCode, 'download_failed');
      assert.ok(errors.includes('ERR_CHECKSUM_MISMATCH'), `Expected checksum failure, received: ${errors.join(', ')}`);
      assert.equal(downloadedAt, null, 'Unverified download must not emit completion');
      assert.equal(installCalls.length, 0, 'Unverified download must never install');
      assert.equal(updater.installerPath, null, 'Unverified installer must not remain ready to run');
      result.checksumRejected = true;
      report.checks.push('tampered-sha512-rejected-before-install');
    }
    controller.dispose();
    report.scenarios.push(result);
    assert.ok(inside(runDirectory, baseCachePath), 'Only an isolated test cache can be removed');
    await fsp.rm(baseCachePath, { recursive: true, force: true });
  }
  assert.equal(report.externalRequests, 0);
  report.passed = true;
}

run().catch(error => {
  report.passed = false;
  report.error = error.stack || error.message;
}).finally(async () => {
  clearTimeout(watchdog);
  for (const controller of controllers) controller.dispose();
  if (service) {
    service.closeAllConnections();
    await new Promise(resolve => service.close(resolve));
  }
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
});
