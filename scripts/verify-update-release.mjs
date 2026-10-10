import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { load as loadYaml } from 'js-yaml';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function verifyReleaseTag(version, tag) {
  assert.match(version, stableVersion, 'Only stable semantic versions can use latest.yml');
  if (tag !== undefined) assert.equal(tag, `v${version}`, 'Release tag must match package.json version');
}

async function regularFile(filename) {
  const info = await fs.lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0, `Expected a nonempty regular file: ${path.basename(filename)}`);
  return info;
}

async function digest(filename, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest(encoding);
}

async function readYaml(filename) {
  const info = await regularFile(filename);
  assert.ok(info.size < 1024 * 1024, 'Unexpectedly large update metadata');
  const document = loadYaml(await fs.readFile(filename, 'utf8'));
  assert.ok(document && typeof document === 'object' && !Array.isArray(document), 'Update metadata must be a mapping');
  return document;
}

// This verifies a build before release. It never downloads or executes an installer.
export async function verifyUpdateRelease({
  packagePath = path.join(repositoryRoot, 'package.json'),
  artifactDirectory = path.join(repositoryRoot, 'release'),
  tag,
} = {}) {
  const packageInfo = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  const version = packageInfo.version;
  verifyReleaseTag(version, tag);
  const name = `Daylight-Setup-${version}.exe`;
  const installerPath = path.join(artifactDirectory, name);
  const manifest = await readYaml(path.join(artifactDirectory, 'latest.yml'));
  assert.equal(manifest.version, version, 'Update version differs from package.json');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === 1, 'Expected exactly one Windows x64 installer in latest.yml');
  const file = manifest.files[0];
  assert.equal(file.url, name, 'Update must reference the exact installer filename, without a URL or path');
  assert.equal(manifest.path, name, 'Legacy update path must reference the same installer');
  assert.ok(Number.isSafeInteger(file.size) && file.size > 0, 'Installer size must be a positive integer');
  const installerInfo = await regularFile(installerPath);
  assert.equal(installerInfo.size, file.size, 'Installer size differs from update metadata');
  const sha512 = await digest(installerPath, 'sha512', 'base64');
  assert.equal(file.sha512, sha512, 'Installer SHA-512 differs from update metadata');
  assert.equal(manifest.sha512, sha512, 'Legacy SHA-512 differs from update metadata');
  assert.ok(typeof manifest.releaseDate === 'string' && Number.isFinite(Date.parse(manifest.releaseDate)), 'Missing release date');

  const installerHandle = await fs.open(installerPath, 'r');
  try {
    const header = Buffer.alloc(2);
    await installerHandle.read(header, 0, 2, 0);
    assert.equal(header.toString('ascii'), 'MZ', 'Installer must be a Windows executable');
  } finally {
    await installerHandle.close();
  }

  const blockmapName = `${name}.blockmap`;
  const blockmapPath = path.join(artifactDirectory, blockmapName);
  await regularFile(blockmapPath);
  const blockmap = JSON.parse(gunzipSync(await fs.readFile(blockmapPath), { maxOutputLength: 16 * 1024 * 1024 }));
  assert.equal(blockmap.version, '2', 'Unsupported blockmap version');
  assert.ok(Array.isArray(blockmap.files) && blockmap.files.length === 1, 'Expected one installer blockmap entry');
  const entry = blockmap.files[0];
  assert.equal(entry.offset, 0, 'Installer blockmap must start at zero');
  assert.ok(Array.isArray(entry.sizes) && entry.sizes.length > 0, 'Blockmap has no blocks');
  assert.ok(Array.isArray(entry.checksums) && entry.checksums.length === entry.sizes.length, 'Blockmap checksums do not match blocks');
  assert.ok(entry.sizes.every(size => Number.isSafeInteger(size) && size > 0), 'Invalid blockmap block size');
  assert.ok(entry.checksums.every(value => typeof value === 'string' && value.length > 0), 'Invalid blockmap checksum');
  assert.equal(entry.sizes.reduce((total, size) => total + size, 0), installerInfo.size, 'Blockmap does not cover the complete installer');

  const feed = await readYaml(path.join(artifactDirectory, 'win-unpacked', 'resources', 'app-update.yml'));
  assert.equal(feed.provider, 'github', 'Packaged update provider must be GitHub');
  assert.equal(feed.owner, 'Key07211', 'Packaged updater points at a different owner');
  assert.equal(feed.repo, 'daylight', 'Packaged updater points at a different repository');
  assert.notEqual(feed.private, true, 'Public updates must not require a GitHub token');
  assert.equal(feed.token, undefined, 'A GitHub token must never be embedded in the app');

  const assets = [];
  for (const assetName of [name, blockmapName, 'latest.yml']) {
    const filename = path.join(artifactDirectory, assetName);
    assets.push({ name: assetName, size: (await regularFile(filename)).size, sha256: await digest(filename, 'sha256', 'hex') });
  }
  return { version, tag: `v${version}`, verified: true, provider: 'github', repository: 'Key07211/daylight', installerSha512: sha512, assets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const tag = process.env.DAYLIGHT_RELEASE_TAG || undefined;
    if (process.argv.includes('--check-tag')) {
      const { version } = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
      assert.ok(tag, 'DAYLIGHT_RELEASE_TAG is required for tag verification');
      verifyReleaseTag(version, tag);
      console.log(`Verified release tag ${tag}`);
    } else {
      console.log(JSON.stringify(await verifyUpdateRelease({ tag }), null, 2));
    }
  } catch (error) {
    console.error(`Update release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
