import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function object(value, label = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${label} must be an object.`);
  return value;
}
function string(value, label, maximum, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new HttpError(400, `${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${maximum} characters.`);
  }
  if (value.includes('\0')) throw new HttpError(400, `${label} cannot contain null characters.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be true or false.`);
  return value;
}
function choice(value, options, label) {
  if (!options.includes(value)) throw new HttpError(400, `${label} must be one of: ${options.join(', ')}.`);
  return value;
}
function date(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new HttpError(400, `${label} must be an ISO date with a timezone, or null.`);
  }
  return new Date(value).toISOString();
}
export function validateWorkspace(workspace) {
  if (!workspace || !path.isAbsolute(workspace)) throw new HttpError(400, 'A Codex workspace must be an absolute directory path.');
  try { if (!fs.statSync(workspace).isDirectory()) throw new Error(); }
  catch { throw new HttpError(400, 'The Codex workspace directory does not exist.'); }
  return path.resolve(workspace);
}

export function taskInput(input, existing, projects) {
  object(input);
  const result = { title: '', notes: '', projectId: null, priority: 'medium', dueAt: null, reminderAt: null, completed: false, ...existing };
  const allowed = new Set(['title', 'notes', 'projectId', 'priority', 'dueAt', 'reminderAt', 'completed', 'automation']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new HttpError(400, `Unknown task field: ${key}`);
  if ('title' in input) result.title = string(input.title, 'Title', 240, false).trim();
  if (!result.title) throw new HttpError(400, 'A task title is required.');
  if ('notes' in input) result.notes = string(input.notes, 'Notes', 30000);
  if ('projectId' in input) {
    if (input.projectId !== null && !projects.some(project => project.id === input.projectId)) throw new HttpError(400, 'The selected project does not exist.');
    result.projectId = input.projectId;
  }
  if ('priority' in input) result.priority = choice(input.priority, ['high', 'medium', 'low'], 'Priority');
  if ('dueAt' in input) result.dueAt = date(input.dueAt, 'Due date');
  if ('reminderAt' in input) result.reminderAt = date(input.reminderAt, 'Reminder date');
  if ('completed' in input) result.completed = boolean(input.completed, 'Completed');
  const automation = { enabled: false, prompt: '', workspace: '', runAt: null, repeat: 'none', sandbox: 'read-only', ...existing?.automation };
  if ('automation' in input) {
    const update = object(input.automation, 'Automation');
    for (const key of Object.keys(update)) if (!(key in automation)) throw new HttpError(400, `Unknown automation field: ${key}`);
    if ('enabled' in update) automation.enabled = boolean(update.enabled, 'Automation enabled');
    if ('prompt' in update) automation.prompt = string(update.prompt, 'Codex prompt', 30000);
    if ('workspace' in update) automation.workspace = string(update.workspace, 'Workspace', 4096);
    if ('runAt' in update) automation.runAt = date(update.runAt, 'Run date');
    if ('repeat' in update) automation.repeat = choice(update.repeat, ['none', 'daily', 'weekdays', 'weekly'], 'Repeat');
    if ('sandbox' in update) automation.sandbox = choice(update.sandbox, ['read-only', 'workspace-write'], 'Sandbox');
  }
  if (automation.enabled) {
    if (!automation.prompt.trim()) throw new HttpError(400, 'An enabled automation requires a Codex prompt.');
    if (!automation.runAt) throw new HttpError(400, 'An enabled automation requires a run date.');
    const validateDirectory = !existing?.automation?.enabled || input.automation?.enabled === true
      || (input.automation && Object.hasOwn(input.automation, 'workspace'));
    if (validateDirectory) automation.workspace = validateWorkspace(automation.workspace);
  }
  result.automation = automation;
  return result;
}

export function projectInput(input) {
  object(input);
  const name = string(input.name, 'Project name', 80, false).trim();
  const color = input.color ?? '#6c7b53';
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new HttpError(400, 'Project color must be a six-digit hex color.');
  return { name, color };
}
export function settingsInput(input) {
  object(input);
  for (const key of Object.keys(input)) if (key !== 'desktopNotifications') throw new HttpError(400, `Unsupported setting: ${key}`);
  return 'desktopNotifications' in input ? { desktopNotifications: boolean(input.desktopNotifications, 'Desktop notifications') } : {};
}
