import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import asar from '@electron/asar';
import yaml from 'js-yaml';

// Read/extract only: the installer is never executed and no registry is touched.
const root = fileURLToPath(new URL('../', import.meta.url));
const packageInfo = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const installer = path.resolve(process.argv[2] || path.join(root, 'release', `Daylight-Setup-${packageInfo.version}.exe`));
const unpacked = path.resolve(process.argv[3] || path.join(root, 'release', 'win-unpacked'));
const runtime = path.join(root, '.runtime');
const output = path.join(runtime, 'installer-payload-report.json');
await fs.mkdir(runtime, { recursive: true });
const scratch = await fs.mkdtemp(path.join(runtime, 'nsis-payload-'));
const runFile = promisify(execFile);
// The generic 7z.exe is created by an install script. Architecture-specific
// binaries are present even when CI installs dependencies with --ignore-scripts.
async function resolveSevenZip() {
  if (process.env.DAYLIGHT_7ZIP) return path.resolve(process.env.DAYLIGHT_7ZIP);
  const vendor = path.join(root, 'node_modules', 'electron-winstaller', 'vendor');
  const candidates = process.platform === 'win32' ? [
    path.join(vendor, process.arch === 'arm64' ? '7z-arm64.exe' : '7z-x64.exe'),
    path.join(vendor, '7z.exe'),
    ...(process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, '7-Zip', '7z.exe')] : []),
  ] : [];
  const executableNames = process.platform === 'win32' ? ['7z.exe', '7za.exe'] : ['7z', '7zz', '7za'];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const filename of executableNames) candidates.push(path.join(directory.replace(/^"|"$/g, ''), filename));
  }
  for (const filename of candidates) {
    if ((await fs.stat(filename).catch(() => null))?.isFile()) return path.resolve(filename);
  }
  throw new Error('7-Zip is unavailable. Install packaging dependencies or set DAYLIGHT_7ZIP to the 7-Zip executable.');
}
let sevenZip;
const normalize = value => value.replaceAll('\\', '/');
const archivePaths = listing => [...listing.matchAll(/^Path = (.+)$/gm)].map(match => match[1].trim());
const run7zip = async args => (await runFile(sevenZip, args, { windowsHide: true, timeout: 90000, maxBuffer: 12 * 1024 * 1024 })).stdout;
const sha256 = filename => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(filename).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
});

try {
  sevenZip = await resolveSevenZip();
  for (const filename of [installer, sevenZip, path.join(unpacked, 'Daylight.exe'), path.join(unpacked, 'resources', 'app.asar')]) {
    assert.ok((await fs.stat(filename)).isFile(), `Required file is missing: ${filename}`);
  }
  const listing = await run7zip(['l', '-slt', installer]);
  assert.match(listing, /^Type = Nsis$/m, 'Expected an NSIS installer');
  const payloadEntry = archivePaths(listing).find(entry => normalize(entry) === '$PLUGINSDIR/app-64.7z');
  assert.ok(payloadEntry, 'Installer does not contain the expected x64 application payload');
  // Extract precisely one known entry, flattened into our newly created directory.
  await run7zip(['e', '-y', '-bb0', `-o${scratch}`, installer, payloadEntry]);
  const payload = path.join(scratch, 'app-64.7z');
  assert.ok((await fs.stat(payload)).isFile());
  const payloadEntries = archivePaths(await run7zip(['l', '-slt', payload]));
  const required = ['Daylight.exe', 'resources/app.asar', 'resources/app-update.yml'];
  const exactEntries = required.map(name => {
    const entry = payloadEntries.find(candidate => normalize(candidate) === name);
    assert.ok(entry, `Missing application payload entry: ${name}`);
    return entry;
  });
  const extracted = path.join(scratch, 'application');
  await fs.mkdir(extracted);
  await run7zip(['x', '-y', '-bb0', `-o${extracted}`, payload, ...exactEntries]);
  const files = [];
  for (const relative of required) {
    const inside = path.join(extracted, ...relative.split('/'));
    const expected = path.join(unpacked, ...relative.split('/'));
    const [payloadHash, unpackedHash] = await Promise.all([sha256(inside), sha256(expected)]);
    assert.equal(payloadHash, unpackedHash, `Installer payload differs from smoke-tested app: ${relative}`);
    files.push({ path: relative, sha256: payloadHash, byteLength: (await fs.stat(inside)).size });
  }
  const embeddedArchive = path.join(extracted, 'resources', 'app.asar');
  const embeddedFiles = new Set(asar.listPackage(embeddedArchive).map(entry => normalize(entry).replace(/^\//, '')));
  for (const filename of ['desktop/update-controller.cjs', 'desktop/update-service.cjs', 'node_modules/electron-updater/package.json', 'node_modules/electron-updater/out/main.js']) {
    assert.ok(embeddedFiles.has(filename), `Installer is missing updater dependency: ${filename}`);
  }
  const embeddedPackage = JSON.parse(asar.extractFile(embeddedArchive, 'package.json').toString('utf8'));
  assert.equal(embeddedPackage.version, packageInfo.version);
  assert.ok(embeddedPackage.dependencies?.['electron-updater'], 'Installer updater must be a production dependency');
  const updaterConfig = yaml.load(await fs.readFile(path.join(extracted, 'resources', 'app-update.yml'), 'utf8'));
  assert.equal(updaterConfig?.provider, 'github', 'Installed updater must use GitHub Releases');
  assert.equal(updaterConfig.owner, 'Key07211', 'Installed updater owner must match the public repository');
  assert.equal(updaterConfig.repo, 'daylight', 'Installed updater repository must match the public repository');
  assert.notEqual(updaterConfig.private, true, 'Public updates must not need embedded credentials');
  const report = { ok: true, version: embeddedPackage.version, installer, installerSha256: await sha256(installer),
    payloadEntry: normalize(payloadEntry), payloadMatchesUnpacked: true, unpacked, files, sevenZip,
    updater: { provider: updaterConfig.provider, owner: updaterConfig.owner, repo: updaterConfig.repo,
      configIncluded: true, productionDependency: true, controllerIncluded: true, serviceIncluded: true },
    installerExecuted: false, registryModified: false, currentAppModified: false };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
} catch (error) {
  await fs.writeFile(output, JSON.stringify({ ok: false, error: error.message, installer, installerExecuted: false }, null, 2));
  throw error;
} finally {
  // Verify the actual absolute target before the only recursive removal in this helper.
  const realRuntime = await fs.realpath(runtime);
  const realScratch = await fs.realpath(scratch);
  const relative = path.relative(realRuntime, realScratch);
  assert.ok(relative.startsWith('nsis-payload-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'Unsafe extraction cleanup target');
  await fs.rm(realScratch, { recursive: true, force: true });
}
