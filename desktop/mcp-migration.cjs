const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const TOML = require('@iarna/toml');

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_BRIDGE_BYTES = 256 * 1024;
const paths = value => /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\') ? path.win32 : path;
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && paths(left).normalize(left).toLowerCase() === paths(right).normalize(right).toLowerCase();
const refusal = reason => ({ migrated: false, reason });

function codexConfigPath(env = process.env, home = os.homedir()) {
  return path.resolve(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
}
function boundedFile(filename, limit) {
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > limit) throw new Error('Unsupported migration input.');
  return fs.readFileSync(filename);
}
function packageIdentity(filename, source = false) {
  const value = JSON.parse(boundedFile(filename, MAX_BRIDGE_BYTES).toString('utf8'));
  return value.name === 'daylight-local-tasks' && value.main === 'desktop/main.cjs'
    && (!source || value.build?.appId === 'com.daylight.tasks');
}

// This is deliberately narrower than a name match. Never execute an unknown
// registered command to decide whether it belongs to Daylight.
function isVerifiedSourceRegistration(registration, desired, installedRuntime) {
  if (!installedRuntime || registration?.name !== 'daylight' || !registration.enabled || registration.disabled_reason) return false;
  const old = registration.transport;
  if (old?.type !== 'stdio' || !Array.isArray(old.args) || old.args.length !== 1
      || !Array.isArray(desired.args) || desired.args.length !== 1
      || typeof old.command !== 'string' || typeof old.args[0] !== 'string'
      || typeof desired.command !== 'string' || typeof desired.args[0] !== 'string') return false;
  if (old.env?.ELECTRON_RUN_AS_NODE !== '1' || desired.env?.ELECTRON_RUN_AS_NODE !== '1'
      || old.env?.DAYLIGHT_URL !== desired.env?.DAYLIGHT_URL
      || Object.entries(desired.env || {}).some(([key, value]) => old.env?.[key] !== value)) return false;
  try {
    const origin = new URL(desired.env.DAYLIGHT_URL);
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)
        || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false;
    const sourcePath = paths(old.args[0]), targetPath = paths(desired.command);
    if (![old.command, old.args[0]].every(value => sourcePath.isAbsolute(value))
        || ![desired.command, desired.args[0]].every(value => targetPath.isAbsolute(value))) return false;
    const sourceRoot = sourcePath.dirname(sourcePath.dirname(old.args[0]));
    const targetRoot = targetPath.dirname(desired.command);
    if (!samePath(old.args[0], sourcePath.join(sourceRoot, 'integrations', 'mcp-server.mjs'))
        || !samePath(old.command, sourcePath.join(sourceRoot, 'node_modules', 'electron', 'dist', 'electron.exe'))
        || targetPath.basename(desired.command).toLowerCase() !== 'daylight.exe'
        || !samePath(desired.args[0], targetPath.join(targetRoot, 'resources', 'app.asar', 'integrations', 'mcp-server.mjs'))) return false;
    if (!fs.statSync(old.command).isFile() || !fs.statSync(desired.command).isFile()) return false;
    if (!packageIdentity(sourcePath.join(sourceRoot, 'package.json'), true)
        || !packageIdentity(targetPath.join(targetRoot, 'resources', 'app.asar', 'package.json'))) return false;
    const previousBridge = boundedFile(old.args[0], MAX_BRIDGE_BYTES);
    const packagedBridge = boundedFile(desired.args[0], MAX_BRIDGE_BYTES);
    return previousBridge.length > 0 && previousBridge.equals(packagedBridge);
  } catch { return false; }
}

// A small location scanner, not a TOML parser. Full-document parsing below
// validates syntax and semantics; tokens only identify the two string spans.
// Strings and comments are opaque, including multiline strings containing fake
// table headers. Unusual inline/dotted layouts are left untouched.
function tokensOf(text) {
  const tokens = [];
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < text.length) {
    const start = index, char = text[index];
    if (char === '\r' || char === '\n') {
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      tokens.push({ kind: 'newline', start, end: index }); continue;
    }
    if (/\s/.test(char)) { index++; continue; }
    if (char === '#') { while (index < text.length && !/[\r\n]/.test(text[index])) index++; continue; }
    if (char === '"' || char === "'") {
      const triple = text.slice(index, index + 3) === char.repeat(3);
      index += triple ? 3 : 1;
      while (index < text.length) {
        if (char === '"' && text[index] === '\\') { index += 2; continue; }
        if (triple && text.slice(index, index + 3) === char.repeat(3)) {
          while (text[index] === char) index++;
          break;
        }
        if (!triple && text[index] === char) { index++; break; }
        index++;
      }
      tokens.push({ kind: 'string', start, end: index, text: text.slice(start, index) }); continue;
    }
    if ('[]=.,{}'.includes(char)) { tokens.push({ kind: char, start, end: ++index, text: char }); continue; }
    while (index < text.length && !/[\s#"'\[\]=.,{}]/.test(text[index])) index++;
    tokens.push({ kind: 'bare', start, end: index, text: text.slice(start, index) });
  }
  return tokens;
}
function keyParts(tokens) {
  const parts = [];
  let expectKey = true;
  for (const token of tokens) {
    if (expectKey && ['bare', 'string'].includes(token.kind)) {
      parts.push(token.kind === 'string' ? TOML.parse(`key = ${token.text}`).key : token.text);
    } else if (expectKey || token.kind !== '.') return null;
    expectKey = !expectKey;
  }
  return expectKey ? null : parts;
}
function valueSpans(text) {
  const tokens = tokensOf(text), spans = {};
  let index = 0, selected = false;
  while (index < tokens.length) {
    if (tokens[index].kind === 'newline') { index++; continue; }
    if (tokens[index].kind === '[') {
      const start = ++index;
      while (index < tokens.length && tokens[index].kind !== 'newline') index++;
      const line = tokens.slice(start, index);
      const keys = line.at(-1)?.kind === ']' ? keyParts(line.slice(0, -1)) : null;
      selected = keys?.length === 2 && keys[0] === 'mcp_servers' && keys[1] === 'daylight';
      continue;
    }
    const start = index;
    while (index < tokens.length && !['=', 'newline'].includes(tokens[index].kind)) index++;
    if (tokens[index]?.kind !== '=') { index++; continue; }
    const keys = keyParts(tokens.slice(start, index));
    const valueStart = ++index;
    let depth = 0;
    while (index < tokens.length) {
      const kind = tokens[index].kind;
      if (kind === 'newline' && depth === 0) break;
      if (kind === '[' || kind === '{') depth++;
      if (kind === ']' || kind === '}') depth--;
      index++;
    }
    if (!selected || keys?.length !== 1 || !['command', 'args'].includes(keys[0])) continue;
    const value = tokens.slice(valueStart, index).filter(token => token.kind !== 'newline');
    const token = keys[0] === 'command' && value.length === 1 && value[0].kind === 'string' ? value[0]
      : keys[0] === 'args' && value[0]?.kind === '[' && value[1]?.kind === 'string'
        && (value.length === 3 && value[2].kind === ']' || value.length === 4 && value[2].kind === ',' && value[3].kind === ']') ? value[1] : null;
    if (!token || spans[keys[0]]) return null;
    spans[keys[0]] = token;
  }
  return spans.command && spans.args ? spans : null;
}

function registrationMatchesConfig(entry, registration) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const transport = registration.transport;
  return entry.enabled !== false && !entry.disabled_reason
    && entry.command === transport.command && isDeepStrictEqual(entry.args, transport.args)
    && isDeepStrictEqual(entry.env || {}, transport.env || {})
    && isDeepStrictEqual(entry.env_vars || [], transport.env_vars || [])
    && (entry.cwd ?? null) === (transport.cwd ?? null)
    && ['enabled_tools', 'disabled_tools', 'startup_timeout_sec', 'tool_timeout_sec'].every(key => isDeepStrictEqual(entry[key] ?? null, registration[key] ?? null));
}

function patchRegistration(text, registration, desired) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = TOML.parse(source);
  if (!registrationMatchesConfig(parsed.mcp_servers?.daylight, registration)) return null;
  const spans = valueSpans(text);
  if (!spans) return null;
  const edits = [ { ...spans.command, replacement: JSON.stringify(desired.command) },
    { ...spans.args, replacement: JSON.stringify(desired.args[0]) } ].sort((left, right) => right.start - left.start);
  let updated = text;
  for (const edit of edits) updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
  const expected = TOML.parse(source);
  expected.mcp_servers.daylight.command = desired.command;
  expected.mcp_servers.daylight.args = [...desired.args];
  const actual = TOML.parse(updated.charCodeAt(0) === 0xfeff ? updated.slice(1) : updated);
  if (!isDeepStrictEqual(actual, expected)) throw new Error('Migration would change unrelated configuration.');
  return updated;
}

function unchangedConfig(filename, original, originalStat, originalRealPath) {
  try {
    const stat = fs.lstatSync(filename);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && stat.dev === originalStat.dev && stat.ino === originalStat.ino
      && stat.size === originalStat.size && stat.mtimeMs === originalStat.mtimeMs && stat.ctimeMs === originalStat.ctimeMs
      && samePath(fs.realpathSync(filename), originalRealPath) && fs.readFileSync(filename).equals(original);
  } catch { return false; }
}
function writeExclusive(filename, bytes, mode) {
  const handle = fs.openSync(filename, 'wx', mode);
  try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}

/** Only the caller's verified source registration can migrate to installed Daylight.
 * No CLI add/remove call is used. A refusal leaves config.toml byte-identical.
 * beforeCommit is an optional test seam for deterministic concurrent-edit checks.
 */
function migrateSourceRegistration({ registration, desired, installedRuntime = false,
  configPath = codexConfigPath(), beforeCommit } = {}) {
  if (!isVerifiedSourceRegistration(registration, desired, installedRuntime)) return refusal('unrecognized');
  const filename = path.resolve(configPath);
  let lockHandle, lockStat, temporary, backupPath;
  const lockPath = `${filename}.daylight-migration.lock`;
  try {
    const originalStat = fs.lstatSync(filename);
    if (!originalStat.isFile() || originalStat.isSymbolicLink() || originalStat.nlink !== 1 || originalStat.size > MAX_CONFIG_BYTES) return refusal('unsupported-config');
    const originalRealPath = fs.realpathSync(filename);
    try { lockHandle = fs.openSync(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return refusal('busy'); throw error; }
    lockStat = fs.fstatSync(lockHandle);
    const original = fs.readFileSync(filename);
    if (!unchangedConfig(filename, original, originalStat, originalRealPath)) return refusal('changed');
    const text = original.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(original)) return refusal('unsupported-config');
    const updated = patchRegistration(text, registration, desired);
    if (!updated) return refusal('config-mismatch');
    const nonce = crypto.randomUUID();
    backupPath = `${filename}.daylight-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${nonce}`;
    temporary = `${filename}.daylight-${nonce}.tmp`;
    writeExclusive(backupPath, original, 0o600);
    writeExclusive(temporary, Buffer.from(updated, 'utf8'), originalStat.mode & 0o777);
    beforeCommit?.();
    // Keep final compare and rename synchronous, with no asynchronous gap.
    // External editors do not honor our lock; their changes must win this check.
    if (!unchangedConfig(filename, original, originalStat, originalRealPath)) return refusal('changed');
    fs.renameSync(temporary, filename);
    temporary = null;
    return { migrated: true, backupPath };
  } catch { return refusal('unavailable'); }
  finally {
    if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
    if (lockHandle !== undefined) {
      try { fs.closeSync(lockHandle); } catch {}
      try {
        const current = fs.lstatSync(lockPath);
        if (!current.isSymbolicLink() && current.dev === lockStat.dev && current.ino === lockStat.ino) fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

module.exports = { codexConfigPath, isVerifiedSourceRegistration, migrateSourceRegistration, patchRegistration };
