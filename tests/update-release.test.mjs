import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dump } from 'js-yaml';
import { verifyReleaseTag, verifyUpdateRelease } from '../scripts/verify-update-release.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daylight-update-release-'));
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    assert.ok(relative.startsWith('daylight-update-release-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'Fixture cleanup must stay in its unique temporary directory');
    await fs.rm(root, { recursive: true, force: true });
  });
  const name = 'Daylight-Setup-0.4.0.exe';
  const installer = Buffer.from('MZ isolated release-verifier fixture');
  const sha512 = createHash('sha512').update(installer).digest('base64');
  const manifest = { version: '0.4.0', files: [{ url: name, sha512, size: installer.length }], path: name, sha512, releaseDate: '2026-10-09T12:00:00.000Z' };
  const packagePath = path.join(root, 'package.json');
  await fs.mkdir(path.join(root, 'win-unpacked', 'resources'), { recursive: true });
  await fs.writeFile(packagePath, JSON.stringify({ version: '0.4.0' }));
  await fs.writeFile(path.join(root, name), installer);
  await fs.writeFile(path.join(root, `${name}.blockmap`), gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: [installer.length], checksums: ['fixture'] }] })));
  await fs.writeFile(path.join(root, 'win-unpacked', 'resources', 'app-update.yml'), dump({ provider: 'github', owner: 'Key07211', repo: 'daylight' }));
  const saveManifest = () => fs.writeFile(path.join(root, 'latest.yml'), dump(manifest));
  await saveManifest();
  return { root, name, manifest, saveManifest, verify: () => verifyUpdateRelease({ packagePath, artifactDirectory: root, tag: 'v0.4.0' }) };
}

test('update release verifies metadata, installer content and packaged public feed', async t => {
  const f = await fixture(t);
  const result = await f.verify();
  assert.equal(result.verified, true);
  assert.equal(result.assets.length, 3);
  assert.equal(result.assets[0].name, f.name);
  assert.match(result.assets[0].sha256, /^[a-f0-9]{64}$/);
});

for (const [name, mutate, pattern] of [
  ['wrong version', m => { m.version = '0.3.0'; }, /version differs/],
  ['traversal path', m => { m.files[0].url = '../outside.exe'; }, /exact installer filename/],
  ['remote URL', m => { m.files[0].url = 'https://example.com/installer.exe'; }, /exact installer filename/],
  ['wrong size', m => { m.files[0].size += 1; }, /size differs/],
  ['tampered SHA-512', m => { m.files[0].sha512 = 'invalid'; }, /SHA-512 differs/],
  ['different legacy installer', m => { m.path = 'another.exe'; }, /same installer/],
  ['tampered legacy SHA-512', m => { m.sha512 = 'invalid'; }, /SHA-512 differs/],
  ['extra installer', m => { m.files.push({ ...m.files[0] }); }, /exactly one/],
]) {
  test(`update release rejects ${name}`, async t => {
    const f = await fixture(t);
    mutate(f.manifest);
    await f.saveManifest();
    await assert.rejects(f.verify, pattern);
  });
}

test('update release rejects changed installer bytes even when size matches', async t => {
  const f = await fixture(t);
  const installer = await fs.readFile(path.join(f.root, f.name));
  installer[installer.length - 1] ^= 1;
  await fs.writeFile(path.join(f.root, f.name), installer);
  await assert.rejects(f.verify, /SHA-512 differs/);
});

test('update release rejects a missing blockmap', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.root, `${f.name}.blockmap`));
  await assert.rejects(f.verify, /ENOENT/);
});

test('update release rejects incomplete blockmap coverage', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, `${f.name}.blockmap`), gzipSync(JSON.stringify({ version: '2', files: [{ offset: 0, sizes: [1], checksums: ['fixture'] }] })));
  await assert.rejects(f.verify, /complete installer/);
});

test('update release rejects a foreign packaged update feed', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'win-unpacked', 'resources', 'app-update.yml'), dump({ provider: 'github', owner: 'someone-else', repo: 'daylight' }));
  await assert.rejects(f.verify, /different owner/);
});

test('update release rejects an embedded authentication token', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'win-unpacked', 'resources', 'app-update.yml'), dump({ provider: 'github', owner: 'Key07211', repo: 'daylight', token: 'fixture-value' }));
  await assert.rejects(f.verify, /never be embedded/);
});

test('release tag must exactly match a stable package version', () => {
  verifyReleaseTag('0.4.0', 'v0.4.0');
  assert.throws(() => verifyReleaseTag('0.4.0', 'v0.3.0'), /must match/);
  assert.throws(() => verifyReleaseTag('0.4.0-beta.1', 'v0.4.0-beta.1'), /stable semantic/);
});
