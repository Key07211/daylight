import { start } from './app.mjs';

try {
  const app = await start();
  console.log(`Daylight is ready at ${app.url}`);
  console.log(`Data: ${app.store.filename}`);
  console.log(app.codex.available ? `Codex: ${app.codex.version}` : 'Codex CLI is unavailable. Task management and reminders are ready.');
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(`Daylight could not start: ${error.message}`);
  process.exitCode = 1;
}
