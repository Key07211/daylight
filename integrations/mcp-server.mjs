import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dateTime = z.string().datetime({ offset: true }).nullable();
const taskId = z.string().min(1).max(200);
const automation = z.object({
  enabled: z.boolean().optional(),
  prompt: z.string().max(30000).optional(),
  workspace: z.string().max(4096).optional(),
  runAt: dateTime.optional(),
  repeat: z.enum(['none', 'daily', 'weekdays', 'weekly']).optional(),
  sandbox: z.enum(['read-only', 'workspace-write']).optional(),
}).strict();

const taskFields = {
  title: z.string().trim().min(1).max(240).describe('Task title.'),
  notes: z.string().max(30000).optional(),
  projectId: z.string().nullable().optional().describe('Existing project ID, or null for inbox.'),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  dueAt: dateTime.optional().describe('ISO timestamp with timezone; null clears the due date.'),
  reminderAt: dateTime.optional().describe('ISO timestamp with timezone; null clears the reminder.'),
  completed: z.boolean().optional(),
  automation: automation.optional().describe('Codex schedule. Set enabled only when the user requests automatic runs. Defaults to read-only sandbox.'),
};

export function localBaseUrl(value = process.env.DAYLIGHT_URL || 'http://127.0.0.1:4317') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('DAYLIGHT_URL must be a local HTTP origin, for example http://127.0.0.1:4317.');
  }
  return url.origin;
}

export function createDaylightServer({ baseUrl = localBaseUrl() } = {}) {
  const origin = localBaseUrl(baseUrl);
  const server = new McpServer({ name: 'daylight', version: '1.0.0' });

  async function request(path, { method = 'GET', body, token } = {}) {
    let response;
    try {
      response = await fetch(`${origin}${path}`, {
        method,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { 'X-Daylight-Token': token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new Error(`Cannot reach Daylight at ${origin}. Start the local app with Start-Daylight.cmd. ${error.message}`);
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`Daylight returned a non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(result.error || result.message || `Daylight request failed (HTTP ${response.status}).`);
    return result;
  }

  async function mutate(path, method, body = {}) {
    const { csrfToken } = await request('/api/bootstrap');
    if (!csrfToken) throw new Error('Daylight did not return a local write token. Check the running app version.');
    return request(path, { method, body, token: csrfToken });
  }

  function tool(name, description, inputSchema, action, annotations = {}) {
    server.registerTool(name, {
      description,
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...annotations },
    }, async (input) => {
      try {
        const result = await action(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    });
  }

  const readOnly = { readOnlyHint: true, idempotentHint: true };
  tool('daylight_status', 'Read Daylight local service settings and Codex CLI readiness. Does not execute Codex.', {}, async () => {
    const { settings, codex } = await request('/api/bootstrap');
    return { serviceUrl: origin, settings, codex };
  }, readOnly);

  tool('daylight_list_tasks', 'List local tasks; optionally filter by status, project, priority, text or due-date bounds. Date bounds are inclusive. Returns stable IDs for editing.', {
    completed: z.boolean().optional(),
    projectId: z.string().nullable().optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    query: z.string().optional(),
    dueAfter: dateTime.optional(),
    dueBefore: dateTime.optional(),
  }, async (input) => {
    const { tasks } = await request('/api/bootstrap');
    const query = input.query?.toLocaleLowerCase();
    return { tasks: tasks.filter((task) =>
      (input.completed === undefined || task.completed === input.completed)
      && (input.projectId === undefined || (task.projectId ?? null) === input.projectId)
      && (!input.priority || task.priority === input.priority)
      && (!query || `${task.title}\n${task.notes || ''}`.toLocaleLowerCase().includes(query))
      && (!input.dueAfter || (task.dueAt && Date.parse(task.dueAt) >= Date.parse(input.dueAfter)))
      && (!input.dueBefore || (task.dueAt && Date.parse(task.dueAt) <= Date.parse(input.dueBefore)))
    ) };
  }, readOnly);

  tool('daylight_add_task', 'Create a local task with an optional reminder or Codex schedule. Scheduling future Codex runs can consume the user’s Codex allowance. Date fields must include a timezone.', taskFields,
    (input) => mutate('/api/tasks', 'POST', input));

  tool('daylight_update_task', 'Update specified task fields by ID; omitted fields stay unchanged. Use completed to complete/reopen; null clears a date/project. Enabling automation schedules local Codex execution.', {
    id: taskId,
    ...taskFields,
    title: taskFields.title.optional(),
  }, ({ id, ...patch }) => {
    if (!Object.keys(patch).length) throw new Error('Provide at least one field to update.');
    return mutate(`/api/tasks/${encodeURIComponent(id)}`, 'PATCH', patch);
  }, { idempotentHint: true });

  tool('daylight_delete_task', 'Permanently delete a task by ID. Only delete tasks the user asked to remove.', { id: taskId },
    ({ id }) => mutate(`/api/tasks/${encodeURIComponent(id)}`, 'DELETE'), { destructiveHint: true, idempotentHint: true });

  tool('daylight_list_projects', 'List available projects and their IDs.', {}, async () => {
    const { projects } = await request('/api/bootstrap');
    return { projects };
  }, readOnly);

  tool('daylight_add_project', 'Create a project to organize local tasks.', {
    name: z.string().trim().min(1).max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Optional six-digit CSS hex color.'),
  }, (input) => mutate('/api/projects', 'POST', input));

  tool('daylight_list_runs', 'Read Codex run history and results without starting any jobs.', {}, () => request('/api/runs'), readOnly);

  tool('daylight_run_task', 'Immediately execute a task’s configured Codex prompt locally. Requires user intent to run this task, a configured workspace, and an authenticated Codex CLI. May consume Codex allowance and edit the workspace when its sandbox is workspace-write.', { id: taskId },
    ({ id }) => mutate(`/api/tasks/${encodeURIComponent(id)}/run`, 'POST', {}), { openWorldHint: true });

  tool('daylight_cancel_run', 'Stop an active Codex run by its run ID. Already-produced files and output are kept.', { id: taskId },
    ({ id }) => mutate(`/api/runs/${encodeURIComponent(id)}/cancel`, 'POST', {}), { destructiveHint: true });

  tool('daylight_update_settings', 'Enable or disable local Windows desktop reminders. In-app notifications are retained in either case.', { desktopNotifications: z.boolean() },
    (input) => mutate('/api/settings', 'PATCH', input), { idempotentHint: true });

  tool('daylight_list_notifications', 'List reminder and run-result notifications.', {}, () => request('/api/notifications'), readOnly);

  tool('daylight_mark_notification', 'Mark an existing notification as read or unread.', { id: taskId, read: z.boolean() },
    ({ id, read }) => mutate(`/api/notifications/${encodeURIComponent(id)}`, 'PATCH', { read }), { idempotentHint: true });

  tool('daylight_export', 'Read the full local task export for a user-requested backup. Does not write a backup file.', {}, () => request('/api/export'), readOnly);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDaylightServer();
  await server.connect(new StdioServerTransport());
}
