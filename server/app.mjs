import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createScheduler, detectCodex } from './scheduler.mjs';
import { createWeatherService } from './weather.mjs';
import { HttpError, object, taskInput, projectInput, settingsInput } from './validation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function respond(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Use Content-Type: application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new HttpError(413, 'The request body is too large.');
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Request body must contain valid JSON.'); }
}
function lookup(items, id, label) {
  const item = items.find(value => value.id === id);
  if (!item) throw new HttpError(404, `${label} not found.`);
  return item;
}

export async function createApp(options = {}) {
  const now = options.now || (() => new Date());
  const weather = createWeatherService({ fetch: options.weatherFetch, now });
  const store = createStore(options.dataDir || process.env.DAYLIGHT_DATA_DIR || path.join(root, 'data'));
  const distDir = path.resolve(options.distDir || path.join(root, 'dist'));
  const command = options.codexCommand || process.env.CODEX_BIN || 'codex';
  const codex = options.codexInfo || await detectCodex(command);
  const csrfToken = randomBytes(32).toString('hex');
  const scheduler = createScheduler({ store, codex, command, now, spawn: options.spawn, notify: options.notify,
    intervalMs: options.intervalMs, timeoutMs: options.timeoutMs });
  const configuredOrigins = options.allowedOrigins || (process.env.DAYLIGHT_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').filter(Boolean);
  const iso = () => now().toISOString();

  function validateRequest(request, response) {
    const port = request.socket.localPort;
    const validHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    if (!validHosts.has(request.headers.host)) throw new HttpError(403, 'Requests must use this local Daylight server.');
    const allowedOrigins = new Set([...configuredOrigins, ...[...validHosts].map(host => `http://${host}`)]);
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'This request origin is not allowed.');
    if (request.headers['sec-fetch-site'] === 'cross-site' && (!origin || !allowedOrigins.has(origin))) throw new HttpError(403, 'Cross-site requests are not allowed.');
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
  }
  const server = http.createServer(async (request, response) => {
    try {
      validateRequest(request, response);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      const method = request.method;
      if (method === 'OPTIONS') {
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Daylight-Token' });
        return response.end();
      }
      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
        const relative = pathname.replace(/^[/\\]+/, '');
        let file = path.resolve(distDir, relative);
        if (file !== distDir && !file.startsWith(distDir + path.sep)) throw new HttpError(403, 'Invalid file path.');
        let stat;
        try { stat = fs.statSync(file); } catch { /* SPA routes use index.html. */ }
        if (!stat?.isFile()) {
          if (path.extname(relative)) throw new HttpError(404, 'File not found.');
          file = path.join(distDir, 'index.html');
          try { stat = fs.statSync(file); } catch { throw new HttpError(503, 'The frontend is not built yet. Run npm run build, or use npm run dev.'); }
        }
        response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size,
          'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
        if (method === 'HEAD') return response.end();
        const stream = fs.createReadStream(file);
        stream.on('error', () => response.destroy());
        return stream.pipe(response);
      }
      const data = store.data;
      if (method === 'GET') {
        if (pathname === '/api/weather') return respond(response, 200, await weather.getWeather(url.searchParams));
        if (pathname === '/api/weather/locations') return respond(response, 200, await weather.searchLocations(url.searchParams));
        if (pathname === '/api/weather/location') return respond(response, 200, await weather.getLocation(url.searchParams));
        if (pathname === '/api/bootstrap') return respond(response, 200, {
          tasks: data.tasks, projects: data.projects, notifications: data.notifications, runs: data.runs,
          settings: data.settings, csrfToken, codex, serverTime: iso(),
        });
        if (pathname === '/api/notifications') return respond(response, 200, data.notifications);
        if (pathname === '/api/runs') return respond(response, 200, data.runs);
        if (pathname === '/api/tasks') return respond(response, 200, data.tasks);
        if (pathname === '/api/projects') return respond(response, 200, data.projects);
        if (pathname === '/api/export') {
          response.setHeader('Content-Disposition', 'attachment; filename="daylight-backup.json"');
          return respond(response, 200, data);
        }
        const match = pathname.match(/^\/api\/runs\/([^/]+)$/);
        if (match) return respond(response, 200, lookup(data.runs, match[1], 'Run'));
        throw new HttpError(404, 'API endpoint not found.');
      }
      if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw new HttpError(405, 'Method not allowed.');
      const suppliedToken = Buffer.from(request.headers['x-daylight-token'] || '');
      const expectedToken = Buffer.from(csrfToken);
      if (suppliedToken.length !== expectedToken.length || !timingSafeEqual(suppliedToken, expectedToken)) throw new HttpError(403, 'Missing or invalid Daylight token. Reload the app and try again.');
      const input = await body(request);
      if (pathname === '/api/tasks' && method === 'POST') {
        const task = { ...taskInput(input, null, data.projects), id: randomUUID(), createdAt: iso(), updatedAt: iso() };
        data.tasks.unshift(task); store.save(); return respond(response, 201, task);
      }
      let match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (match) {
        const task = lookup(data.tasks, match[1], 'Task');
        if (method === 'PATCH') { Object.assign(task, taskInput(input, task, data.projects), { updatedAt: iso() }); store.save(); return respond(response, 200, task); }
        if (method === 'DELETE') { data.tasks = data.tasks.filter(item => item.id !== task.id); delete data.deliveredReminders[task.id]; store.save(); return respond(response, 200, { ok: true }); }
      }
      match = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
      if (match && method === 'POST') return respond(response, 202, scheduler.startRun(lookup(data.tasks, match[1], 'Task')));
      if (pathname === '/api/projects' && method === 'POST') {
        const project = { ...projectInput(input), id: randomUUID(), createdAt: iso() };
        data.projects.push(project); store.save(); return respond(response, 201, project);
      }
      match = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (match && method === 'DELETE') {
        lookup(data.projects, match[1], 'Project');
        data.projects = data.projects.filter(project => project.id !== match[1]);
        for (const task of data.tasks) if (task.projectId === match[1]) { task.projectId = null; task.updatedAt = iso(); }
        store.save(); return respond(response, 200, { ok: true });
      }
      if (pathname === '/api/notifications/read-all' && method === 'POST') {
        for (const item of data.notifications) item.read = true;
        store.save(); return respond(response, 200, { ok: true });
      }
      match = pathname.match(/^\/api\/notifications\/([^/]+)$/);
      if (match && method === 'PATCH') {
        const item = lookup(data.notifications, match[1], 'Notification');
        if (typeof input.read !== 'boolean') throw new HttpError(400, 'Read must be true or false.');
        item.read = input.read; store.save(); return respond(response, 200, item);
      }
      match = pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
      if (match && method === 'POST') return respond(response, 200, scheduler.cancelRun(match[1]));
      if (pathname === '/api/settings' && method === 'PATCH') {
        Object.assign(data.settings, settingsInput(input)); store.save(); return respond(response, 200, data.settings);
      }
      throw new HttpError(404, 'API endpoint not found.');
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof HttpError) && !(error instanceof URIError)) console.error('[Daylight]', error);
      respond(response, error instanceof URIError ? 400 : error.status || 500,
        { error: error instanceof URIError ? 'Malformed URL.' : error.status ? error.message : 'An unexpected server error occurred.' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  let listening = false;
  return {
    server, store, scheduler, codex,
    async listen(port = Number(process.env.DAYLIGHT_PORT || 4317)) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
      listening = true;
      if (options.startScheduler !== false) scheduler.start();
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      scheduler.stop();
      if (listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      listening = false;
    },
  };
}

export async function start(options) {
  const app = await createApp(options);
  const url = await app.listen(options?.port);
  return { ...app, url };
}
