const fs = require('node:fs');
const path = require('node:path');

function codexCandidates(env = process.env) {
  if (env.CODEX_BIN) return [env.CODEX_BIN];
  const candidates = [];
  if (env.LOCALAPPDATA) {
    const installed = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const versions = fs.readdirSync(installed, { withFileTypes: true }).filter(item => item.isDirectory())
        .map(item => ({ directory: path.join(installed, item.name), modified: fs.statSync(path.join(installed, item.name)).mtimeMs }))
        .sort((a, b) => b.modified - a.modified);
      for (const version of versions) candidates.push(path.join(version.directory, 'codex.exe'));
    } catch { /* Codex desktop is optional. */ }
    candidates.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'codex.exe'));
  }
  if (env.APPDATA) {
    const npm = path.join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex');
    const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const platform = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
    candidates.push(path.join(npm, 'vendor', target, 'codex', 'codex.exe'));
    candidates.push(path.join(npm, 'node_modules', '@openai', platform, 'vendor', target, 'codex', 'codex.exe'));
  }
  if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, '.local', 'bin', 'codex.exe'));
  return [...new Set(candidates.filter(candidate => fs.existsSync(candidate))), 'codex'];
}

async function resolveCodex(detect, env = process.env) {
  const candidates = codexCandidates(env);
  for (const command of candidates) {
    const info = await detect(command);
    if (info.available) return { command, info };
  }
  return { command: candidates[0] || 'codex', info: { available: false, version: null } };
}

module.exports = { codexCandidates, resolveCodex };
