import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError, validateWorkspace } from './validation.mjs';

const MAX_LOG = 128 * 1024;
export async function detectCodex(command = process.env.CODEX_BIN || 'codex') {
  return new Promise(resolve => {
    execFile(command, ['--version'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? { available: false, version: null } : { available: true, version: stdout.trim().slice(0, 200) });
    });
  });
}

export function nativeNotification(notification) {
  if (process.platform !== 'win32') return;
  const script = fileURLToPath(new URL('./notify.ps1', import.meta.url));
  const child = nodeSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Title', notification.title.slice(0, 200), '-Body', notification.body.slice(0, 500)],
  { windowsHide: true, shell: false, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

// Advancing from the original date avoids a backlog of missed runs after sleep.
// setDate preserves the wall-clock time in the computer's local timezone.
export function nextRunAt(runAt, repeat, now) {
  if (repeat === 'none') return null;
  const next = new Date(runAt);
  do {
    next.setDate(next.getDate() + (repeat === 'weekly' ? 7 : 1));
    if (repeat === 'weekdays') while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
  } while (next <= now);
  return next.toISOString();
}

export function createScheduler({ store, codex, command = process.env.CODEX_BIN || 'codex', spawn = nodeSpawn,
  now = () => new Date(), notify = nativeNotification, timeoutMs = 30 * 60 * 1000, intervalMs = 5000 }) {
  let active = null;
  let interval = null;
  let stopped = false;
  let updatePending = false;
  const iso = () => now().toISOString();
  for (const run of store.data.runs) {
    if (run.status === 'running') {
      run.status = 'failed'; run.finishedAt = iso(); run.error = 'Daylight restarted before this run finished. The task was not automatically repeated.';
    }
  }
  store.save();

  function notification(task, type, title, body) {
    const item = { id: randomUUID(), taskId: task.id, title, body, type, createdAt: iso(), read: false };
    store.data.notifications.unshift(item);
    store.data.notifications.splice(500);
    store.save();
    if (store.data.settings.desktopNotifications) {
      try { notify(item); } catch { /* A desktop notification must never stop a schedule. */ }
    }
    return item;
  }
  function advanceSchedule(task) {
    const next = nextRunAt(task.automation.runAt, task.automation.repeat, now());
    task.automation.runAt = next;
    if (!next) task.automation.enabled = false;
    task.updatedAt = iso();
  }
  function runRecord(task, trigger) {
    const run = { id: randomUUID(), taskId: task.id, taskTitle: task.title, status: 'running', startedAt: iso(),
      finishedAt: null, output: '', error: null, trigger };
    store.data.runs.unshift(run);
    store.data.runs.splice(100);
    return run;
  }

  function startRun(task, trigger = 'manual') {
    if (active) throw new HttpError(409, 'A Codex run is already in progress. Wait for it to finish or cancel it.');
    if (stopped) throw new HttpError(503, 'Daylight is shutting down.');
    if (updatePending) throw new HttpError(503, 'Daylight is installing an update. Try again after it restarts.');
    if (task.completed) throw new HttpError(409, 'Reopen the task before running Codex.');
    if (!codex.available) throw new HttpError(503, 'Codex CLI was not found. Install or sign in to Codex, then restart Daylight.');
    const workspace = validateWorkspace(task.automation.workspace);
    if (!task.automation.prompt.trim()) throw new HttpError(400, 'Add a Codex prompt before running the task.');
    const run = runRecord(task, trigger);
    if (trigger === 'schedule') advanceSchedule(task);
    store.save();
    const context = { run, child: null, timer: null, flushTimer: null };
    active = context;
    const flush = () => { if (context.flushTimer) clearTimeout(context.flushTimer); context.flushTimer = null; store.save(); };
    const append = data => {
      const text = String(data).replace(/\u001b\[[0-9;]*m/g, '');
      run.output += text;
      if (run.output.length > MAX_LOG) run.output = '[Earlier output truncated]\n' + run.output.slice(-MAX_LOG);
      if (!context.flushTimer) { context.flushTimer = setTimeout(flush, 500); context.flushTimer.unref?.(); }
    };
    const finish = (status, error = null) => {
      if (run.status !== 'running') return;
      run.status = status; run.error = error; run.finishedAt = iso();
      clearTimeout(context.timer);
      flush();
      const titles = { succeeded: 'Codex 已完成', failed: 'Codex 执行失败', cancelled: 'Codex 已取消' };
      const bodies = {
        succeeded: 'Codex 任务已完成，打开执行记录查看输出。',
        failed: '执行未能完成，打开执行记录查看详细原因。',
        cancelled: '本次执行已取消，已产生的输出和文件会保留。',
      };
      notification(task, status === 'succeeded' ? 'success' : 'error',
        `${titles[status]}：${task.title}`, bodies[status]);
    };
    context.finish = finish;
    try {
      const child = spawn(command, ['exec', '--skip-git-repo-check', '--color', 'never', '-s', task.automation.sandbox,
        '-C', workspace, '-'], { cwd: workspace, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      context.child = child;
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.stdin?.on('error', error => append(`\nInput closed: ${error.message}\n`));
      child.on('error', error => { finish('failed', `Unable to start Codex: ${error.message}`); if (active === context) active = null; });
      child.on('close', (code, signal) => {
        finish(code === 0 ? 'succeeded' : 'failed', code === 0 ? null : `Codex exited ${signal ? `with signal ${signal}` : `with code ${code}`}.`);
        clearTimeout(context.timer);
        flush();
        if (active === context) active = null;
      });
      child.stdin?.end(task.automation.prompt);
      context.timer = setTimeout(() => { finish('failed', 'Codex exceeded the 30-minute run limit.'); kill(context); }, timeoutMs);
      context.timer.unref?.();
    } catch (error) {
      finish('failed', `Unable to start Codex: ${error.message}`);
      active = null;
    }
    return run;
  }
  function kill(context) {
    if (!context.child) return;
    if (process.platform === 'win32' && spawn === nodeSpawn && context.child.pid) {
      const killer = nodeSpawn('taskkill.exe', ['/pid', String(context.child.pid), '/t', '/f'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => context.child.kill());
    } else context.child.kill();
  }
  function cancelRun(id) {
    const run = store.data.runs.find(item => item.id === id);
    if (!run) throw new HttpError(404, 'Run not found.');
    if (run.status !== 'running') throw new HttpError(409, 'This run is no longer running.');
    if (active?.run.id !== id) throw new HttpError(409, 'The run process is no longer available.');
    active.finish('cancelled', 'Cancelled by you.');
    kill(active);
    return run;
  }
  function tick() {
    if (stopped) return;
    const current = now();
    for (const task of store.data.tasks) {
      if (task.completed) continue;
      if (task.reminderAt && new Date(task.reminderAt) <= current && store.data.deliveredReminders[task.id] !== task.reminderAt) {
        store.data.deliveredReminders[task.id] = task.reminderAt;
        notification(task, 'reminder', task.title, task.notes.trim().slice(0, 500) || '这项任务的提醒时间到了。');
      }
    }
    if (active || updatePending) return;
    const task = store.data.tasks.filter(item => !item.completed && item.automation.enabled && item.automation.runAt && new Date(item.automation.runAt) <= current)
      .sort((a, b) => a.automation.runAt.localeCompare(b.automation.runAt))[0];
    if (task) {
      try { startRun(task, 'schedule'); }
      catch (error) {
        const run = runRecord(task, 'schedule');
        run.status = 'failed'; run.error = error.message; run.finishedAt = iso();
        advanceSchedule(task);
        notification(task, 'error', `Codex 无法启动：${task.title}`, '未能启动 Codex，打开执行记录查看详细原因。');
      }
    }
  }
  return {
    tick, startRun, cancelRun, get activeRun() { return active?.run ?? null; },
    setUpdatePending(value) { updatePending = value === true; },
    start() { if (!interval) { stopped = false; tick(); interval = setInterval(tick, intervalMs); interval.unref?.(); } },
    stop() {
      stopped = true; clearInterval(interval); interval = null;
      if (active) { active.finish('cancelled', 'Daylight was shut down.'); kill(active); }
    },
  };
}
