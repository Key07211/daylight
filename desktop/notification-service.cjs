'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');

const APP_ID = 'com.daylight.tasks';
const WINDOWS_SETTINGS = 'ms-settings:notifications';
const SYSTEM_STATES = new Map([
  ['Enabled', 'enabled'],
  ['DisabledForApplication', 'disabled-application'],
  ['DisabledForUser', 'disabled-user'],
  ['DisabledByGroupPolicy', 'disabled-policy'],
  ['DisabledByManifest', 'disabled-manifest'],
]);

// ToastNotifier.Setting is a read-only, app-specific Windows API. Never change
// notification registry values or Focus Assist / Do Not Disturb on the user's behalf.
const SETTING_QUERY = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
  [Windows.UI.Notifications.ToastNotifier, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
  $setting = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').get_Setting()
  $setting.ToString()
} catch { 'Unknown' }
`;

function readWindowsNotificationSetting({ run = execFile, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.resolve('unknown');
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise(resolve => {
    const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SETTING_QUERY, 'utf16le').toString('base64')];
    run(executable, args, { windowsHide: true, shell: false, timeout: 4000, maxBuffer: 4096, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? 'unknown' : SYSTEM_STATES.get(String(stdout).trim()) || 'unknown');
    });
  });
}

function createDesktopNotifications({ app, Notification, shell, icon, smoke = false,
  getEnabled = () => false, onActivate = () => {}, onStatusChange = () => {},
  platform = process.platform, portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
  readSystemSetting = readWindowsNotificationSetting, now = Date.now,
  deliveryWaitMs = 1600, allowNative = true }) {
  const mode = smoke ? 'disabled' : platform !== 'win32' ? 'unsupported'
    : !app.isPackaged ? 'development' : portable ? 'portable' : 'installed';
  let supported = false;
  // Keep non-installed runtimes usable, but allow isolated previews to opt out.
  // Smoke tests must never register an executable or deliver a real system toast.
  if (!smoke && allowNative && platform === 'win32') {
    try { supported = Notification.isSupported(); } catch { /* Capability unknown. */ }
  }
  let systemState = 'unknown';
  let checkedAt = 0;
  let checking;
  let disposed = false;
  let sequence = 0;
  let lastDelivery = { state: 'none', kind: null, at: null, error: null };
  const active = new Set();
  const pending = new Set();

  function snapshot() {
    const enabled = getEnabled() === true;
    const blocked = systemState.startsWith('disabled-');
    const state = disposed || mode === 'disabled' || !allowNative ? 'disabled'
      : !supported ? 'unsupported' : !enabled ? 'off' : blocked ? 'blocked'
          : systemState === 'enabled' ? 'ready' : 'unknown';
    return { appId: APP_ID, mode, supported, enabled, systemState, state,
      canOpenSettings: platform === 'win32' && allowNative && !smoke && !disposed,
      lastDelivery: { ...lastDelivery } };
  }

  function publish() {
    if (disposed) return;
    try { onStatusChange(snapshot()); } catch { /* Renderer can be navigating. */ }
  }

  async function getStatus({ refresh = true } = {}) {
    if (disposed || !supported) return snapshot();
    if (checking) return checking;
    if (!refresh && checkedAt && now() - checkedAt < 5000) return snapshot();
    checking = (async () => {
      try {
        const value = await readSystemSetting();
        systemState = ['enabled', ...SYSTEM_STATES.values()].includes(value) ? value : 'unknown';
      } catch { systemState = 'unknown'; }
      checkedAt = now();
      publish();
      return snapshot();
    })();
    try { return await checking; } finally { checking = null; }
  }

  function activate(taskId) {
    if (disposed) return;
    try { onActivate(taskId); } catch { /* Deleted tasks or a closing window are harmless. */ }
  }

  // Persistent Action Center notifications can outlive their JS object or process.
  // Instance clicks below also select the task; a cold activation only focuses the app.
  if (supported && typeof Notification.handleActivation === 'function') {
    try { Notification.handleActivation(() => activate(null)); } catch { /* Instance clicks still work. */ }
  }

  async function send(item, kind = 'reminder') {
    const status = await getStatus({ refresh: false });
    // Check the live preference again after the asynchronous Windows query.
    if (disposed || !supported || getEnabled() !== true || status.state === 'blocked') return snapshot();
    const attempt = ++sequence;
    const at = new Date(now()).toISOString();
    lastDelivery = { state: 'requested', kind, at, error: null };
    publish();
    let toast;
    let finish;
    let timer;
    const response = new Promise(resolve => {
      finish = () => { clearTimeout(timer); pending.delete(finish); resolve(snapshot()); };
      pending.add(finish);
      timer = setTimeout(finish, deliveryWaitMs);
    });
    function record(state, error = null) {
      if (disposed) return;
      if (attempt === sequence) {
        lastDelivery = { state, kind, at, error };
        publish();
      }
      finish();
    }
    try {
      toast = new Notification({
        title: typeof item?.title === 'string' ? item.title.slice(0, 200) : 'Daylight',
        body: typeof item?.body === 'string' ? item.body.slice(0, 500) : '',
        icon, silent: false, urgency: 'normal', timeoutType: 'default',
      });
      active.add(toast);
      // Bounded references keep callbacks alive after a banner times out, while
      // the global activation handler still works for older Action Center items.
      if (active.size > 500) {
        const oldest = active.values().next().value;
        active.delete(oldest);
        oldest.removeAllListeners();
      }
      toast.on('show', () => record('shown'));
      toast.on('failed', (_event, error) => {
        active.delete(toast);
        record('failed', typeof error === 'string' ? error.slice(0, 300) : 'Windows could not display this notification.');
      });
      toast.on('click', () => {
        activate(typeof item?.taskId === 'string' ? item.taskId : null);
        active.delete(toast);
      });
      toast.on('close', details => {
        if (details?.reason === 'userCanceled' || details?.reason === 'applicationHidden') active.delete(toast);
      });
      toast.show();
    } catch (error) {
      if (toast) active.delete(toast);
      record('failed', error instanceof Error ? error.message.slice(0, 300) : 'Windows could not display this notification.');
    }
    return response;
  }

  function sendTest(language = 'zh') {
    if (language !== 'zh' && language !== 'en') throw new TypeError('Notification language must be zh or en.');
    const previousAttempt = sequence;
    return send(language === 'en'
      ? { title: 'Daylight', body: 'Your reminders can appear here. Click to return to Daylight.' }
      : { title: 'Daylight · 日光清单', body: '你的任务提醒会出现在这里。点击通知，返回日光清单。' }, 'test')
      // First delivery may create the application's Windows notification entry.
      // Refresh only this explicit test action, not every scheduled reminder.
      .then(status => sequence > previousAttempt ? getStatus() : status);
  }

  async function openSettings() {
    if (!snapshot().canOpenSettings) return { opened: false };
    await shell.openExternal(WINDOWS_SETTINGS);
    return { opened: true };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const finish of pending) finish();
    for (const toast of active) toast.removeAllListeners();
    active.clear();
    // Do not call toast.close(): exiting Daylight should not erase unread Windows alerts.
  }

  return { getStatus, send, sendTest, openSettings, dispose };
}

module.exports = { APP_ID, createDesktopNotifications, readWindowsNotificationSetting };
