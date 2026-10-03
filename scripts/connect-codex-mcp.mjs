import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMcpConnection } from '../desktop/mcp-connection.cjs';
import { resolveCodex } from '../desktop/codex-path.cjs';
import { detectCodex } from '../server/scheduler.mjs';

function validatePort(port) {
  if ((typeof port !== 'number' && typeof port !== 'string') || !/^\d+$/.test(String(port))
      || !Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535.');
  }
  return Number(port);
}

export function parseArguments(argv) {
  if (!argv.length) return { port: 4317 };
  if (argv.length !== 2 || argv[0] !== '--port') throw new Error('Usage: node scripts/connect-codex-mcp.mjs [--port 4317]');
  return { port: validatePort(argv[1]) };
}

// Dependency injection keeps tests isolated from the user's Codex configuration.
export async function connectCodexMcp({ port = 4317, nodeCommand = process.execPath,
  bridge = fileURLToPath(new URL('../integrations/mcp-server.mjs', import.meta.url)),
  resolve = resolveCodex, detect = detectCodex, createConnection = createMcpConnection } = {}) {
  const serviceUrl = `http://127.0.0.1:${validatePort(port)}`;
  const codex = await resolve(detect);
  if (!codex.info?.available) return { state: 'unavailable', registered: false, toolCount: 0,
    serviceUrl, checkedAt: new Date().toISOString() };
  const connection = createConnection({ codexCommand: codex.command, command: nodeCommand,
    args: [bridge], env: { DAYLIGHT_URL: serviceUrl } });
  return connection.ensure();
}

export async function runCli(argv = process.argv.slice(2), {
  connect = connectCodexMcp, write = line => process.stdout.write(`${line}\n`),
  writeError = line => process.stderr.write(`${line}\n`),
} = {}) {
  let options;
  try { options = parseArguments(argv); }
  catch (error) { writeError(error.message); return 1; }
  let status;
  try { status = await connect(options); }
  catch { writeError('Unable to check the Daylight connection. Check the local service and Codex installation, then retry.'); return 1; }
  if (status.state === 'ready') {
    write(`Daylight MCP is verified: ${status.toolCount} tools at ${status.serviceUrl}.`);
    write('Keep the Daylight local service running. Open a new Codex chat to use its tools.');
    return 0;
  }
  if (status.state === 'conflict') {
    writeError("An existing 'daylight' connection has different settings, possibly the desktop Electron connection. It was kept unchanged, including its tool permissions. Use that desktop connection or review it in Codex MCP settings.");
  } else if (status.state === 'disabled') {
    writeError('Daylight is disabled in Codex. The registration was kept unchanged. Enable it in Codex MCP settings, then retry.');
  } else if (status.state === 'unavailable') {
    writeError('Codex CLI is unavailable. Install or update local Codex, then retry.');
  } else if (status.registered) {
    writeError('Daylight is registered, but its MCP health check failed. Keep the matching local service running, then retry.');
  } else {
    writeError('Daylight MCP could not be registered and verified. Check the local service and Codex settings, then retry.');
  }
  return 1;
}

if (process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli();
}
