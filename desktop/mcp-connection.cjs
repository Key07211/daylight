const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const execFileAsync = promisify(execFile);

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Daylight MCP requires a local HTTP origin.');
  }
  return url.origin;
}

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (/^[a-z]:[\\/]/i.test(left) && /^[a-z]:[\\/]/i.test(right)) {
    return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
  }
  return left === right;
}

function effectiveTools(tools, registration) {
  const allowed = registration.enabled_tools;
  const denied = registration.disabled_tools || [];
  return tools.filter(tool => (!Array.isArray(allowed) || allowed.includes(tool.name)) && !denied.includes(tool.name));
}

// Only the status tool is called. No tasks or settings are modified by this probe.
async function probeDaylight({ command, args, env, registration, timeoutMs = 12000, signal }) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  if (signal?.aborted) throw new Error('MCP probe cancelled.');
  const transport = new StdioClientTransport({ command, args, env, stderr: 'pipe',
    ...(registration.transport.cwd ? { cwd: registration.transport.cwd } : {}) });
  // Drain diagnostics without recording or returning potentially sensitive data.
  transport.stderr?.resume();
  const client = new Client({ name: 'daylight-connection-check', version: '1.0.0' });
  let timer;
  let cancel;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport, { timeout: timeoutMs });
        let cursor;
        const tools = [];
        for (let page = 0; page < 10; page += 1) {
          const result = await client.listTools(cursor ? { cursor } : {}, { timeout: timeoutMs });
          tools.push(...result.tools);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error('Unexpected MCP catalog pagination.');
        const visible = effectiveTools(tools, registration);
        if (!visible.some(tool => tool.name === 'daylight_status')) throw new Error('Daylight status tool is unavailable.');
        const status = await client.callTool({ name: 'daylight_status', arguments: {} }, undefined, { timeout: timeoutMs });
        if (status.isError) throw new Error('Daylight status check failed.');
        const payload = status.content?.find(item => item.type === 'text')?.text;
        const body = JSON.parse(payload);
        return { toolCount: visible.length, serviceUrl: localOrigin(body.serviceUrl) };
      })(),
      new Promise((_, reject) => {
        cancel = () => reject(new Error('MCP probe cancelled.'));
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(cancel, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

/**
 * check() is read-only; ensure() registers a missing server, then verifies it.
 * Existing entries are never replaced with `codex mcp add`, which discards
 * hidden tool policies. An explicitly installed runtime may supply the narrow
 * source-registration migration; it must preserve all environment and policies.
 * runCommand has the execFileAsync signature. probe is injectable for tests.
 */
function createMcpConnection({ codexCommand = 'codex', command, args = [], env = {}, serverName = 'daylight',
  runCommand = execFileAsync, probe = probeDaylight, migrate, timeoutMs = 12000, now = () => new Date() } = {}) {
  if (!command || typeof command !== 'string' || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')
      || !/^[a-zA-Z0-9_-]+$/.test(serverName) || !env || Object.values(env).some(value => typeof value !== 'string')) {
    throw new Error('Invalid Daylight MCP connection configuration.');
  }
  const desired = { command, args: [...args], env: { ...env } };
  const serviceUrl = localOrigin(desired.env.DAYLIGHT_URL);
  let last = { state: 'missing', registered: false, toolCount: 0, serviceUrl, checkedAt: null, message: 'Connection has not been checked.' };
  let flight = null;
  let ensureRequested = false;

  const snapshot = () => ({ ...last });
  function publish(state, registered, message, toolCount = 0) {
    const date = new Date(now());
    last = { state, registered, toolCount, serviceUrl, checkedAt: (Number.isFinite(date.getTime()) ? date : new Date()).toISOString(), ...(message ? { message } : {}) };
    return snapshot();
  }
  async function cli(argv) {
    return runCommand(codexCommand, argv, { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, shell: false });
  }
  async function inspect() {
    let output;
    try { output = await cli(['mcp', 'get', serverName, '--json']); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES') return { failure: publish('unavailable', false, 'Codex CLI is unavailable.') };
      const diagnostic = String(error.stderr || '').trim();
      if (diagnostic === `Error: No MCP server named '${serverName}' found.`) return { missing: true };
      return { failure: publish('error', false, 'Unable to read Codex MCP configuration. Existing settings were not changed.') };
    }
    try {
      const item = JSON.parse(typeof output === 'string' ? output : output.stdout);
      if (!item || item.name !== serverName || typeof item.enabled !== 'boolean' || !item.transport
          || typeof item.transport.type !== 'string'
          || [item.enabled_tools, item.disabled_tools].some(list => list != null && (!Array.isArray(list) || list.some(name => typeof name !== 'string')))) {
        throw new Error('Invalid registration.');
      }
      return { item };
    } catch { return { failure: publish('error', false, 'Codex returned an unreadable MCP registration. Existing settings were not changed.') }; }
  }
  function configurationState(item) {
    if (!item.enabled || item.disabled_reason) return publish('disabled', true, 'Daylight is disabled in Codex. Enable it in Codex settings to connect.');
    const transport = item.transport;
    if (transport.type !== 'stdio' || !samePath(transport.command, desired.command)
        || !Array.isArray(transport.args) || transport.args.length !== desired.args.length
        || transport.args.some((arg, index) => !samePath(arg, desired.args[index]))
        || Object.entries(desired.env).some(([key, value]) => transport.env?.[key] !== value)) {
      return publish('conflict', true, 'A different Daylight connection already exists in Codex. Update it in Codex settings; the existing entry was not changed.');
    }
    return null;
  }
  async function health(item) {
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        probe({ ...desired, env: { ...(item.transport.env || {}), ...desired.env }, registration: item, timeoutMs, signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Probe timed out.')); }, timeoutMs + 5000); }),
      ]);
      if (!Number.isInteger(result.toolCount) || result.toolCount < 1 || localOrigin(result.serviceUrl) !== serviceUrl) throw new Error('Invalid probe response.');
      return publish('ready', true, undefined, result.toolCount);
    } catch {
      return publish('error', true, 'Registered in Codex, but the Daylight MCP health check failed. Keep Daylight running and retry.');
    } finally { clearTimeout(timer); controller.abort(); }
  }
  async function reconcile(item) {
    const state = configurationState(item);
    if (!state) return health(item);
    if (state.state !== 'conflict' || !ensureRequested || typeof migrate !== 'function') return state;
    let result;
    try { result = await migrate({ registration: item, desired: { ...desired, args: [...desired.args], env: { ...desired.env } } }); }
    catch { return publish('error', true, 'Unable to safely migrate the existing Daylight connection. Retry after checking Codex settings.'); }
    if (!result?.migrated) return state;
    const verified = await inspect();
    if (verified.failure || !verified.item) return publish('error', true, 'Daylight was migrated, but Codex could not confirm the updated connection. Retry the connection check.');
    return configurationState(verified.item) || health(verified.item);
  }
  async function run() {
    const found = await inspect();
    if (found.failure) return found.failure;
    if (found.item) return reconcile(found.item);
    if (!ensureRequested) return publish('missing', false, 'Daylight has not been registered in Codex.');
    // Recheck just before writing: another app may have registered this name.
    const latest = await inspect();
    if (latest.failure) return latest.failure;
    if (latest.item) return reconcile(latest.item);
    const argv = ['mcp', 'add', serverName];
    for (const [key, value] of Object.entries(desired.env)) argv.push('--env', `${key}=${value}`);
    argv.push('--', desired.command, ...desired.args);
    try { await cli(argv); }
    catch (error) {
      return publish(error.code === 'ENOENT' ? 'unavailable' : 'error', false, 'Unable to register Daylight in Codex. Retry after checking the Codex installation.');
    }
    const verified = await inspect();
    if (verified.failure) return verified.failure;
    if (!verified.item) return publish('error', false, 'Codex did not retain the Daylight registration.');
    return configurationState(verified.item) || health(verified.item);
  }
  function start(ensure) {
    if (ensure) ensureRequested = true;
    if (flight) return flight.then(result => ensure && result.state === 'missing' ? start(true) : result);
    flight = run().catch(() => publish('error', false, 'Unable to check the Daylight connection.')).finally(() => {
      flight = null;
      ensureRequested = false;
    });
    return flight;
  }
  return { check: () => start(false), ensure: () => start(true), getStatus: snapshot };
}

module.exports = { createMcpConnection, probeDaylight };
