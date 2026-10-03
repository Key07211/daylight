const fs = require('node:fs');
const path = require('node:path');
const { createMcpConnection } = require('./mcp-connection.cjs');
const { migrateSourceRegistration } = require('./mcp-migration.cjs');

function createDesktopMcp({ codexCommand, command, bridge, origin, preferencesPath,
  defaultAutoConnect = true, disabled = false, preview = false, installedRuntime = false, configPath,
  notify = () => {}, manager }) {
  let autoConnect = defaultAutoConnect;
  try { const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8')); if (typeof saved.autoConnect === 'boolean') autoConnect = saved.autoConnect; } catch {}
  const connection = disabled ? null : manager || createMcpConnection({
    codexCommand, command, args: [bridge], env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: origin },
    ...(installedRuntime ? { migrate: input => migrateSourceRegistration({ ...input, installedRuntime, ...(configPath ? { configPath } : {}) }) } : {}),
  });
  let snapshot = { state: disabled ? 'unavailable' : 'missing', registered: false, toolCount: 0, serviceUrl: origin, checkedAt: null };
  let pending = 0;
  let revision = 0;
  const getStatus = () => ({ ...snapshot, revision, checking: pending > 0, autoConnect, canConfigure: !disabled, preview });
  const publish = () => { revision++; notify(getStatus()); return getStatus(); };
  async function refresh(connect = false) {
    if (!connection) return getStatus();
    pending++; publish();
    try { snapshot = await (connect ? connection.ensure() : connection.check()); }
    catch { snapshot = { ...snapshot, state: 'error', checkedAt: new Date().toISOString() }; }
    finally { pending--; publish(); }
    return getStatus();
  }
  async function setAutoConnect(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Auto-connect must be true or false.');
    if (disabled) throw new Error('Codex configuration is disabled in smoke tests.');
    const temporary = `${preferencesPath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    try {
      fs.writeFileSync(temporary, JSON.stringify({ autoConnect: enabled }, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, preferencesPath);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    autoConnect = enabled; publish();
    return enabled ? refresh(true) : getStatus();
  }
  return { getStatus, check: () => refresh(false), connect: () => refresh(true), setAutoConnect,
    start: () => refresh(autoConnect) };
}
module.exports = { createDesktopMcp };
