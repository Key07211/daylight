import fs from 'node:fs';
import path from 'node:path';

export const emptyData = () => ({
  version: 1, tasks: [], projects: [], notifications: [], runs: [],
  settings: { desktopNotifications: false }, deliveredReminders: {},
});

function validData(data) {
  if (!data || data.version !== 1 || !['tasks', 'projects', 'notifications', 'runs'].every(key => Array.isArray(data[key]))) return false;
  const date = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return data.tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.notes === 'string'
    && typeof task.completed === 'boolean' && date(task.reminderAt) && date(task.dueAt)
    && task.automation && typeof task.automation.enabled === 'boolean' && typeof task.automation.prompt === 'string'
    && typeof task.automation.workspace === 'string' && date(task.automation.runAt)
    && ['none', 'daily', 'weekdays', 'weekly'].includes(task.automation.repeat)
    && ['read-only', 'workspace-write'].includes(task.automation.sandbox))
    && data.projects.every(item => item && typeof item.id === 'string' && typeof item.name === 'string')
    && data.notifications.every(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.read === 'boolean')
    && data.runs.every(item => item && typeof item.id === 'string' && ['running', 'succeeded', 'failed', 'cancelled'].includes(item.status))
    && (!data.settings || typeof data.settings.desktopNotifications === 'boolean')
    && (!data.deliveredReminders || (typeof data.deliveredReminders === 'object' && !Array.isArray(data.deliveredReminders)));
}

export function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'store.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!validData(data)) {
      throw new Error('Unsupported or malformed Daylight data file. Restore a valid backup before starting.');
    }
    data.settings = { ...emptyData().settings, ...data.settings };
    data.deliveredReminders ??= {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = emptyData();
  }
  function save() {
    const temporary = `${filename}.${process.pid}.tmp`;
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filename);
  }
  save();
  return { data, save, filename };
}
