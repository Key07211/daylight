import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';
import { codexConfigPath, isVerifiedSourceRegistration, migrateSourceRegistration, patchRegistration } from '../desktop/mcp-migration.cjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-mcp-migration-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('daylight-mcp-migration-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const source = path.join(directory, 'Source checkout');
  const installed = path.join(directory, 'Installed app');
  const previous = { command: path.join(source, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(source, 'integrations', 'mcp-server.mjs')] };
  const desired = { command: path.join(installed, 'Daylight.exe'),
    args: [path.join(installed, 'resources', 'app.asar', 'integrations', 'mcp-server.mjs')],
    env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: 'http://127.0.0.1:4317' } };
  const write = (filename, content) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content); };
  write(previous.command, 'fixture-electron');
  write(desired.command, 'fixture-installed-electron');
  const manifest = { name: 'daylight-local-tasks', version: '0.2.1', main: 'desktop/main.cjs' };
  write(path.join(source, 'package.json'), JSON.stringify({ ...manifest, build: { appId: 'com.daylight.tasks' } }));
  write(path.join(installed, 'resources', 'app.asar', 'package.json'), JSON.stringify({ ...manifest, version: '0.3.0' }));
  const bridge = 'export function createDaylightServer() { return "fixture-identical-bridge"; }\n';
  write(previous.args[0], bridge); write(desired.args[0], bridge);
  const registration = { name: 'daylight', enabled: true, disabled_reason: null,
    transport: { type: 'stdio', ...previous, env: { ...desired.env, PRIVATE_FIXTURE: 'never-print-fixture' },
      env_vars: ['PRESERVE_EXISTING_ENV'], cwd: path.join(directory, 'Existing workspace') },
    enabled_tools: ['daylight_status', 'daylight_list_tasks'], disabled_tools: ['daylight_delete_task'],
    startup_timeout_sec: 30.5, tool_timeout_sec: 60 };
  const configPath = path.join(directory, 'custom codex home', 'config.toml');
  const text = `# Existing global preferences must remain byte-for-byte intact.
model = "example-model"
approval_policy = "on-request"
notes = """
[mcp_servers.daylight]
command = "fake-header-inside-a-string"
"""

[mcp_servers.other]
command = "unrelated-server"
args = ["--existing"]
env = { TOKEN = "unrelated-fixture-token" }

[mcp_servers.daylight] # Keep comments and ordering.
command = ${JSON.stringify(previous.command)} # existing command comment
args = [
  ${JSON.stringify(previous.args[0])}, # bridge comment must survive
]
enabled = true
required = true
cwd = ${JSON.stringify(registration.transport.cwd)}
env_vars = ["PRESERVE_EXISTING_ENV"]
enabled_tools = ["daylight_status", "daylight_list_tasks"]
disabled_tools = ["daylight_delete_task"]
startup_timeout_sec = 30.5
tool_timeout_sec = 60

[mcp_servers.daylight.env]
ELECTRON_RUN_AS_NODE = "1"
DAYLIGHT_URL = "http://127.0.0.1:4317"
PRIVATE_FIXTURE = "never-print-fixture"

[mcp_servers.daylight.tool_approvals]
daylight_delete_task = "prompt"
daylight_status = "approve"

[projects.example]
trust_level = "untrusted"
`;
  write(configPath, text);
  const migrate = overrides => migrateSourceRegistration({ registration, desired, installedRuntime: true, configPath, ...overrides });
  return { directory, source, installed, previous, desired, registration, configPath, text, migrate, write };
}

test('verified old source migrates only two string values, preserving every other byte and policy with an exact backup', t => {
  const value = fixture(t);
  const result = value.migrate();
  assert.equal(result.migrated, true);
  assert.deepEqual(fs.readFileSync(result.backupPath), Buffer.from(value.text));
  const actual = fs.readFileSync(value.configPath, 'utf8');
  const expected = value.text.replace(JSON.stringify(value.previous.command), JSON.stringify(value.desired.command))
    .replace(JSON.stringify(value.previous.args[0]), JSON.stringify(value.desired.args[0]));
  assert.equal(actual, expected);
  const parsed = TOML.parse(actual);
  assert.deepEqual(parsed.mcp_servers.daylight.env, value.registration.transport.env);
  assert.deepEqual(parsed.mcp_servers.daylight.disabled_tools, ['daylight_delete_task']);
  assert.deepEqual(parsed.mcp_servers.daylight.tool_approvals, { daylight_delete_task: 'prompt', daylight_status: 'approve' });
  assert.equal(parsed.mcp_servers.other.env.TOKEN, 'unrelated-fixture-token');
  assert.equal(parsed.mcp_servers.daylight.enabled, true);
  assert.ok(!JSON.stringify(result).includes('never-print-fixture'));
  assert.deepEqual(fs.readdirSync(path.dirname(value.configPath)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')), []);
});

test('quoted table keys, BOM, CRLF, literal paths and multiline args retain their surrounding formatting', t => {
  const value = fixture(t);
  const changed = '\ufeff' + value.text.replace('[mcp_servers.daylight] # Keep', '["mcp_servers".\'daylight\'] # Keep')
    .replace(`command = ${JSON.stringify(value.previous.command)}`, `"command" = '${value.previous.command}'`)
    .replace('args = [\n', "'args' = [\n").replaceAll('\n', '\r\n');
  fs.writeFileSync(value.configPath, changed);
  const result = value.migrate();
  assert.equal(result.migrated, true);
  const actual = fs.readFileSync(value.configPath, 'utf8');
  assert.equal(actual, changed.replace(`'${value.previous.command}'`, JSON.stringify(value.desired.command))
    .replace(JSON.stringify(value.previous.args[0]), JSON.stringify(value.desired.args[0])));
  assert.equal(fs.readFileSync(result.backupPath, 'utf8'), changed);
});

test('custom CODEX_HOME is respected without accessing the default home config', t => {
  const value = fixture(t);
  assert.equal(codexConfigPath({ CODEX_HOME: path.dirname(value.configPath) }, path.join(value.directory, 'different home')), value.configPath);
  assert.equal(codexConfigPath({}, value.directory), path.join(value.directory, '.codex', 'config.toml'));
  const previous = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = path.dirname(value.configPath);
    const result = migrateSourceRegistration({ registration: value.registration, desired: value.desired, installedRuntime: true });
    assert.equal(result.migrated, true);
    assert.equal(fs.existsSync(path.join(value.directory, '.codex', 'config.toml')), false);
  } finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
});

test('disabled, policy-disabled, wrong endpoint, extra args and unrelated runtimes remain byte-identical', t => {
  const value = fixture(t);
  const cases = [
    { ...value.registration, enabled: false },
    { ...value.registration, disabled_reason: 'organization policy' },
    { ...value.registration, transport: { type: 'streamable_http', url: 'https://other.invalid' } },
    { ...value.registration, transport: { ...value.registration.transport, command: path.join(value.directory, 'other.exe') } },
    { ...value.registration, transport: { ...value.registration.transport, args: [...value.previous.args, '--extra'] } },
    { ...value.registration, transport: { ...value.registration.transport, env: { ...value.registration.transport.env, DAYLIGHT_URL: 'http://127.0.0.1:14320' } } },
    { ...value.registration, transport: { ...value.registration.transport, env: { ...value.registration.transport.env, ELECTRON_RUN_AS_NODE: '0' } } },
  ];
  for (const registration of cases) {
    assert.equal(value.migrate({ registration }).migrated, false);
    assert.equal(fs.readFileSync(value.configPath, 'utf8'), value.text);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(value.configPath)), ['config.toml']);
});

test('migration is explicitly installed-only and never goes from packaged runtime back to source', t => {
  const value = fixture(t);
  assert.equal(value.migrate({ installedRuntime: false }).migrated, false);
  const packaged = { ...value.registration, transport: { ...value.registration.transport, ...value.desired } };
  assert.equal(value.migrate({ registration: packaged, desired: { ...value.previous, env: value.desired.env } }).migrated, false);
  assert.equal(value.migrate({ desired: { ...value.desired, command: path.join(value.installed, 'Other.exe') } }).migrated, false);
  assert.equal(fs.readFileSync(value.configPath, 'utf8'), value.text);
});

test('missing source identity, incorrect app name and mismatched bridge content cannot be adopted', t => {
  const value = fixture(t);
  const manifestPath = path.join(value.source, 'package.json');
  const original = fs.readFileSync(manifestPath);
  fs.unlinkSync(manifestPath);
  assert.equal(value.migrate().migrated, false);
  fs.writeFileSync(manifestPath, original);
  fs.writeFileSync(manifestPath, JSON.stringify({ name: 'other-app', main: 'desktop/main.cjs', build: { appId: 'com.daylight.tasks' } }));
  assert.equal(value.migrate().migrated, false);
  fs.writeFileSync(manifestPath, original);
  fs.appendFileSync(value.previous.args[0], '// different or modified bridge');
  assert.equal(value.migrate().migrated, false);
  assert.equal(fs.readFileSync(value.configPath, 'utf8'), value.text);
});

test('effective CLI policy/environment mismatch with the raw user config refuses migration', t => {
  const value = fixture(t);
  for (const registration of [
    { ...value.registration, disabled_tools: ['daylight_run_task'] },
    { ...value.registration, transport: { ...value.registration.transport, env: { ...value.registration.transport.env, LAYERED_EXTRA: 'project-value' } } },
    { ...value.registration, transport: { ...value.registration.transport, cwd: 'different project cwd' } },
  ]) {
    assert.equal(value.migrate({ registration }).migrated, false);
    assert.equal(fs.readFileSync(value.configPath, 'utf8'), value.text);
  }
});

test('malformed TOML, unsupported inline layout and disabled raw user entry are preserved', t => {
  const value = fixture(t);
  for (const text of [value.text + '\n[mcp_servers.daylight]\n', value.text.replace('enabled = true', 'enabled = false')]) {
    fs.writeFileSync(value.configPath, text);
    assert.equal(value.migrate().migrated, false);
    assert.equal(fs.readFileSync(value.configPath, 'utf8'), text);
  }
  const simple = { ...value.registration, transport: { ...value.registration.transport, env: {}, env_vars: [], cwd: null },
    enabled_tools: null, disabled_tools: null, startup_timeout_sec: null, tool_timeout_sec: null };
  const inline = `mcp_servers = { daylight = { command = ${JSON.stringify(value.previous.command)}, args = [${JSON.stringify(value.previous.args[0])}] } }\n`;
  assert.equal(patchRegistration(inline, simple, value.desired), null);
});

test('a concurrent edit wins, old bytes remain backed up, and no temporary/lock files remain', t => {
  const value = fixture(t);
  const concurrent = value.text + '\n# concurrent editor saved this line\n';
  const result = value.migrate({ beforeCommit: () => fs.writeFileSync(value.configPath, concurrent) });
  assert.deepEqual(result, { migrated: false, reason: 'changed' });
  assert.equal(fs.readFileSync(value.configPath, 'utf8'), concurrent);
  const entries = fs.readdirSync(path.dirname(value.configPath));
  const backups = entries.filter(name => name.startsWith('config.toml.daylight-backup-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(value.configPath), backups[0]), 'utf8'), value.text);
  assert.equal(entries.some(name => name.endsWith('.lock') || name.endsWith('.tmp')), false);
});

test('replacement with identical bytes is still detected through file identity before committing', t => {
  const value = fixture(t);
  const replacement = path.join(path.dirname(value.configPath), 'external-editor.tmp');
  const result = value.migrate({ beforeCommit: () => { fs.writeFileSync(replacement, value.text); fs.renameSync(replacement, value.configPath); } });
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'changed');
  assert.equal(fs.readFileSync(value.configPath, 'utf8'), value.text);
});

test('an existing migration lock and a hard-linked config are left untouched', t => {
  const value = fixture(t);
  const lock = `${value.configPath}.daylight-migration.lock`;
  fs.writeFileSync(lock, 'other process owns this lock');
  assert.equal(value.migrate().reason, 'busy');
  assert.equal(fs.readFileSync(lock, 'utf8'), 'other process owns this lock');
  fs.unlinkSync(lock);
  fs.linkSync(value.configPath, path.join(value.directory, 'config-hard-link.toml'));
  assert.equal(value.migrate().reason, 'unsupported-config');
  assert.equal(fs.readFileSync(value.configPath, 'utf8'), value.text);
});

test('source verification accepts an older package version without relying on its directory name', t => {
  const value = fixture(t);
  assert.equal(isVerifiedSourceRegistration(value.registration, value.desired, true), true);
});
