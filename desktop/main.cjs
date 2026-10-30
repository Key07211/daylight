const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, nativeTheme, dialog, shell, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveCodex } = require('./codex-path.cjs');
const { createDesktopMcp } = require('./mcp-controller.cjs');
const { createClaudeConnection } = require('./claude-connection.cjs');
const { createDesktopUpdates } = require('./update-service.cjs');
const { createDesktopNotifications } = require('./notification-service.cjs');

app.setName('Daylight');
app.setAppUserModelId('com.daylight.tasks');
const smokeArg = process.argv.indexOf('--smoke-test');
const smokeOutput = smokeArg >= 0 ? process.argv[smokeArg + 1] : null;
if (smokeArg >= 0 && (!smokeOutput || !path.isAbsolute(smokeOutput))) {
  console.error('--smoke-test requires an absolute JSON output path.');
  app.exit(1);
}
const smoke = Boolean(smokeOutput);
const profileDir = smoke
  ? path.join(path.dirname(smokeOutput), 'daylight-smoke-profile')
  : path.join(app.getPath('appData'), 'Daylight');
app.setPath('userData', profileDir);
const dataDir = path.join(app.getPath('userData'), 'data');
const windowPreferencesPath = path.join(app.getPath('userData'), 'window-preferences.json');
const shutdownLogPath = path.join(app.getPath('userData'), 'logs', 'shutdown.log');
// Quitting must never leave a process holding the single-instance lock.
const shutdownDeadlineMs = 10000;
const parsedPort = Number(process.env.DAYLIGHT_PORT || 4317);
const port = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535 ? parsedPort : 4317;
const allowedExternalHosts = new Set(['learn.chatgpt.com', 'developers.openai.com', 'www.figma.com', 'www.electronjs.org']);
let service;
let window;
let tray;
let origin;
let codexCommand;
let mcp;
let claude;
let updates;
let desktopNotifications;
let quitting = false;
let shutdownStarted = false;
let startupClaimed = false;
let smokeDetails = {};

function writeSmoke(result) {
  if (!smoke) return;
  fs.mkdirSync(path.dirname(smokeOutput), { recursive: true });
  smokeDetails = { ...smokeDetails, ...result };
  fs.writeFileSync(smokeOutput, JSON.stringify({ ...smokeDetails, version: app.getVersion(), dataPath: dataDir, executable: process.execPath }, null, 2));
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function allowedExternal(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && allowedExternalHosts.has(url.hostname);
  } catch { return false; }
}

function localUrl(value) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

function verifiedSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !localUrl(event.senderFrame.url)) {
    throw new Error('This desktop action is available only inside Daylight.');
  }
}

function autoLaunch() {
  return app.isPackaged && !smoke && app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin;
}

function readWindowPreferences() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowPreferencesPath, 'utf8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch { return {}; }
}

function savedAlwaysOnTop() {
  return readWindowPreferences().alwaysOnTop === true;
}

// 'tray' keeps reminders and schedules running after the window closes; 'quit' stops the app.
function savedCloseAction() {
  return readWindowPreferences().closeAction === 'quit' ? 'quit' : 'tray';
}

function saveWindowPreferences(changes) {
  fs.mkdirSync(path.dirname(windowPreferencesPath), { recursive: true });
  const temporaryPath = `${windowPreferencesPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({ ...readWindowPreferences(), ...changes }, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, windowPreferencesPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function setupIpc() {
  ipcMain.handle('daylight:claim-startup', event => {
    verifiedSender(event);
    const first = !startupClaimed;
    startupClaimed = true;
    return first;
  });
  ipcMain.handle('daylight:set-theme', (event, theme) => {
    verifiedSender(event);
    if (theme !== 'day' && theme !== 'night') throw new Error('Theme must be day or night.');
    nativeTheme.themeSource = theme === 'night' ? 'dark' : 'light';
    window.setBackgroundColor(theme === 'night' ? '#101827' : '#f7f5ef');
    return { theme };
  });
  ipcMain.handle('daylight:get-info', event => {
    verifiedSender(event);
    return { version: app.getVersion(), dataPath: dataDir, autoLaunch: Boolean(autoLaunch()),
      alwaysOnTop: window.isAlwaysOnTop(), closeAction: savedCloseAction(), isPackaged: app.isPackaged };
  });
  ipcMain.handle('daylight:set-always-on-top', (event, enabled) => {
    verifiedSender(event);
    if (typeof enabled !== 'boolean') throw new Error('Always-on-top must be true or false.');
    const previous = window.isAlwaysOnTop();
    try {
      window.setAlwaysOnTop(enabled);
      const alwaysOnTop = window.isAlwaysOnTop();
      saveWindowPreferences({ alwaysOnTop });
      return { alwaysOnTop };
    } catch (error) {
      window.setAlwaysOnTop(previous);
      throw error;
    }
  });
  ipcMain.handle('daylight:set-close-action', (event, action) => {
    verifiedSender(event);
    if (action !== 'tray' && action !== 'quit') throw new Error('Close action must be tray or quit.');
    saveWindowPreferences({ closeAction: action });
    return { closeAction: savedCloseAction() };
  });
  ipcMain.handle('daylight:set-auto-launch', (event, enabled) => {
    verifiedSender(event);
    if (typeof enabled !== 'boolean') throw new Error('Auto-launch must be true or false.');
    if (!app.isPackaged || smoke || process.env.PORTABLE_EXECUTABLE_DIR) throw new Error('请先安装 Daylight，再设置登录时启动。');
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] });
    return { autoLaunch: Boolean(autoLaunch()) };
  });
  ipcMain.handle('daylight:open-data-folder', async event => {
    verifiedSender(event);
    const error = await shell.openPath(dataDir);
    if (error) throw new Error(error);
  });
  ipcMain.handle('daylight:install-mcp', async event => {
    verifiedSender(event);
    if (updates.isPreparing()) throw new Error('Daylight is restarting to install an update.');
    if (process.env.PORTABLE_EXECUTABLE_DIR) throw new Error('请先安装 Daylight，再添加稳定的 Codex MCP 连接。');
    return mcp.connect();
  });
  ipcMain.handle('daylight:mcp-status', event => { verifiedSender(event); return mcp.getStatus(); });
  ipcMain.handle('daylight:check-mcp', event => {
    verifiedSender(event);
    if (updates.isPreparing()) throw new Error('Daylight is restarting to install an update.');
    return mcp.check();
  });
  ipcMain.handle('daylight:set-mcp-auto-connect', (event, enabled) => {
    verifiedSender(event);
    if (updates.isPreparing()) throw new Error('Daylight is restarting to install an update.');
    return mcp.setAutoConnect(enabled);
  });
  ipcMain.handle('daylight:connect-claude', async event => {
    verifiedSender(event);
    if (updates.isPreparing()) throw new Error('Daylight is restarting to install an update.');
    if (process.env.PORTABLE_EXECUTABLE_DIR) throw new Error('请先安装 Daylight，再添加稳定的 Claude MCP 连接。');
    return claude.connect();
  });
  ipcMain.handle('daylight:claude-status', event => { verifiedSender(event); return claude.getStatus(); });
  ipcMain.handle('daylight:check-claude', event => {
    verifiedSender(event);
    if (updates.isPreparing()) throw new Error('Daylight is restarting to install an update.');
    return claude.check();
  });
  ipcMain.handle('daylight:set-claude-auto-connect', (event, enabled) => {
    verifiedSender(event);
    if (updates.isPreparing()) throw new Error('Daylight is restarting to install an update.');
    return claude.setAutoConnect(enabled);
  });
  ipcMain.handle('daylight:update-status', event => { verifiedSender(event); return updates.getStatus(); });
  ipcMain.handle('daylight:check-updates', event => { verifiedSender(event); return updates.check(); });
  ipcMain.handle('daylight:download-update', event => { verifiedSender(event); return updates.download(); });
  ipcMain.handle('daylight:update-editing', (event, value) => {
    verifiedSender(event);
    updates.setEditing(value);
  });
  ipcMain.handle('daylight:notification-status', event => { verifiedSender(event); return desktopNotifications.getStatus(); });
  ipcMain.handle('daylight:test-notification', (event, language) => {
    verifiedSender(event);
    return desktopNotifications.sendTest(language);
  });
  ipcMain.handle('daylight:notification-settings', event => { verifiedSender(event); return desktopNotifications.openSettings(); });
}

function nativeReminder(item) {
  void desktopNotifications?.send(item).catch(console.error);
}

async function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 680,
    title: 'Daylight · 日光清单', backgroundColor: '#f6f6f2', icon,
    // The hidden smoke renderer needs a compositor; production waits for first show.
    show: false, paintWhenInitiallyHidden: smoke, autoHideMenuBar: true, alwaysOnTop: savedAlwaysOnTop(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      backgroundThrottling: !smoke,
      devTools: !app.isPackaged,
    },
  });
  window.removeMenu();
  window.webContents.on('did-start-loading', () => updates.rendererLoading());
  window.webContents.on('render-process-gone', () => updates.rendererLoading());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal(url)) shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!localUrl(url)) {
      event.preventDefault();
      if (allowedExternal(url)) shell.openExternal(url).catch(console.error);
    }
  });
  window.webContents.on('will-redirect', (event, url) => { if (!localUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => {
    if (quitting) return;
    if (savedCloseAction() === 'quit') { event.preventDefault(); window.hide(); app.quit(); return; }
    if (tray) { event.preventDefault(); window.hide(); }
  });

  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('Daylight · 日光清单 — 提醒与 Codex 调度');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开日光清单', click: showWindow },
    { label: '打开数据文件夹', click: () => shell.openPath(dataDir) },
    { type: 'separator' },
    { label: '退出 Daylight', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  await window.loadURL(origin);
  const startingTheme = await window.webContents.executeJavaScript('document.documentElement.dataset.theme');
  window.setBackgroundColor(startingTheme === 'night' ? '#101a2a' : '#f6f5ee');
  if (!smoke && !process.argv.includes('--hidden')) showWindow();
}

async function runSmoke() {
  const response = await fetch(`${origin}/api/bootstrap`);
  const state = await response.json();
  const readyExpression = "['今天', '设置与连接', '新建任务'].every(text => document.body.innerText.includes(text)) && Boolean(document.querySelector('button.window-pin'))";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await window.webContents.executeJavaScript(readyExpression)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const renderer = await window.webContents.executeJavaScript(`(async () => ({
    title: document.title,
    content: document.body.innerText,
    info: await window.daylightDesktop.getInfo(),
    pinButtonAvailable: Boolean(document.querySelector('button[aria-label="置顶窗口"], button[aria-label="取消窗口置顶"]')),
    cornerNotesRemoved: !document.querySelector('.local-note, .sidebar-foot, .main-footer, .daily-quote, .right-footer')
      && !['安心留在本地', '你的计划，你的空间。', '给每一天，留一点日光。', '数据保存在本机 · 无需云同步'].some(text => document.body.innerText.includes(text)),
    nodeUnavailable: typeof window.require === 'undefined' && typeof window.process === 'undefined',
    bridgeMethods: Object.keys(window.daylightDesktop)
  }))()`);
  const rendererLoaded = ['今天', '设置与连接', '新建任务'].every(text => renderer.content.includes(text));
  const initialPinStateMatches = renderer.info.alwaysOnTop === window.isAlwaysOnTop()
    && renderer.info.alwaysOnTop === savedAlwaysOnTop();
  const invalidPinRejected = await window.webContents.executeJavaScript(`(async () => {
    try { await window.daylightDesktop.setAlwaysOnTop('true'); return false; }
    catch { return true; }
  })()`);
  const invalidPinPreservedState = window.isAlwaysOnTop() === renderer.info.alwaysOnTop;
  const pinned = await window.webContents.executeJavaScript('window.daylightDesktop.setAlwaysOnTop(true)');
  const pinEnabled = pinned.alwaysOnTop === true && window.isAlwaysOnTop() && savedAlwaysOnTop();
  const unpinned = await window.webContents.executeJavaScript('window.daylightDesktop.setAlwaysOnTop(false)');
  const pinDisabled = unpinned.alwaysOnTop === false && !window.isAlwaysOnTop() && !savedAlwaysOnTop();
  const pinning = { initialPinStateMatches, invalidPinRejected, invalidPinPreservedState, pinEnabled, pinDisabled };
  const closeDefaultsToTray = renderer.info.closeAction === 'tray' && savedCloseAction() === 'tray';
  const invalidCloseActionRejected = await window.webContents.executeJavaScript(`(async () => {
    try { await window.daylightDesktop.setCloseAction('exit'); return false; }
    catch { return true; }
  })()`) && savedCloseAction() === 'tray';
  const quitChosen = await window.webContents.executeJavaScript("window.daylightDesktop.setCloseAction('quit')");
  const closeQuitSaved = quitChosen.closeAction === 'quit' && savedCloseAction() === 'quit'
    && readWindowPreferences().alwaysOnTop === savedAlwaysOnTop() && 'alwaysOnTop' in readWindowPreferences();
  // Back to the tray before the UI checks so nothing in them can quit the smoke run.
  const trayChosen = await window.webContents.executeJavaScript("window.daylightDesktop.setCloseAction('tray')");
  const closeTrayRestored = trayChosen.closeAction === 'tray' && savedCloseAction() === 'tray';
  const closing = { closeDefaultsToTray, invalidCloseActionRejected, closeQuitSaved, closeTrayRestored };
  const updateSafety = await window.webContents.executeJavaScript(`(async () => {
    const status = await window.daylightDesktop.getUpdateStatus();
    const checked = await window.daylightDesktop.checkForUpdates();
    const downloaded = await window.daylightDesktop.downloadUpdate();
    let invalidEditingRejected = false;
    try { await window.daylightDesktop.setUpdateEditing('false'); } catch { invalidEditingRejected = true; }
    return { disabledInSmoke: status.mode === 'disabled' && status.state === 'disabled',
      noUpdateWork: checked.state === 'disabled' && downloaded.state === 'disabled',
      invalidEditingRejected };
  })()`);
  const notificationSafety = await window.webContents.executeJavaScript(`(async () => {
    const status = await window.daylightDesktop.getNotificationStatus();
    const sent = await window.daylightDesktop.testNotification('en');
    const settings = await window.daylightDesktop.openNotificationSettings();
    let invalidLanguageRejected = false;
    try { await window.daylightDesktop.testNotification({title:'untrusted'}); } catch { invalidLanguageRejected = true; }
    return { disabledInSmoke: status.state === 'disabled', noToastSent: sent.lastDelivery.state === 'none',
      noSettingsOpened: !settings.opened, invalidLanguageRejected };
  })()`);
  const interfaceChecks = await require('./ui-smoke.cjs')(window, origin, smokeOutput);
  const ok = response.ok && Array.isArray(state.tasks) && Boolean(state.csrfToken)
    && renderer.nodeUnavailable && rendererLoaded && Boolean(renderer.info.dataPath)
    && renderer.pinButtonAvailable && renderer.cornerNotesRemoved
    && Object.values(pinning).every(Boolean) && Object.values(closing).every(Boolean) && Object.values(updateSafety).every(Boolean)
    && Object.values(notificationSafety).every(Boolean) && Object.values(interfaceChecks.checks).every(Boolean);
  const screenshotPath = smokeOutput.replace(/\.json$/i, '') + '.png';
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  writeSmoke({ ok, origin, apiAvailable: response.ok, rendererLoaded,
    title: renderer.title, renderedText: renderer.content.slice(0, 2000), nativeInfo: renderer.info, nodeUnavailable: renderer.nodeUnavailable,
    bridgeMethods: renderer.bridgeMethods, codex: state.codex, pinning, closing, interfaceChecks, updateSafety, notificationSafety,
    pinButtonAvailable: renderer.pinButtonAvailable, cornerNotesRemoved: renderer.cornerNotesRemoved, screenshotPath,
    windowSecurity: window.webContents.getLastWebPreferences(), trayAvailable: Boolean(tray),
    notificationsEnabled: state.settings.desktopNotifications, packaged: app.isPackaged });
  if (!ok) throw new Error('Desktop smoke assertions failed.');
  app.quit();
}

async function boot() {
  await app.whenReady();
  const { createApp } = await import(pathToFileURL(path.join(app.getAppPath(), 'server', 'app.mjs')).href);
  const { detectCodex } = await import(pathToFileURL(path.join(app.getAppPath(), 'server', 'scheduler.mjs')).href);
  const codex = await resolveCodex(detectCodex);
  codexCommand = codex.command;
  // Electron registers the current executable when checking native support.
  // A source preview must not replace the installed app's Windows shortcut.
  desktopNotifications = createDesktopNotifications({ app, Notification, shell, smoke, allowNative: app.isPackaged,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    getEnabled: () => service?.store.data.settings.desktopNotifications === true,
    onActivate: showWindow,
    onStatusChange: status => { if (window && !window.isDestroyed()) window.webContents.send('daylight:notification-status-changed', status); } });
  service = await createApp({ dataDir, distDir: path.join(app.getAppPath(), 'dist'),
    codexCommand: codex.command, codexInfo: codex.info, notify: nativeReminder,
    allowedOrigins: [], startScheduler: !smoke });
  origin = await service.listen(port);
  mcp = createDesktopMcp({ codexCommand, command: process.execPath,
    bridge: path.join(app.getAppPath(), 'integrations', 'mcp-server.mjs'), origin,
    preferencesPath: path.join(profileDir, 'mcp-preferences.json'), defaultAutoConnect: !smoke,
    disabled: smoke || Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    installedRuntime: app.isPackaged && !smoke && !process.env.PORTABLE_EXECUTABLE_DIR,
    notify: status => { if (window && !window.isDestroyed()) window.webContents.send('daylight:mcp-status-changed', status); } });
  const bridge = path.join(app.getAppPath(), 'integrations', 'mcp-server.mjs');
  const claudeDisabled = smoke || Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  claude = createDesktopMcp({ origin, preferencesPath: path.join(profileDir, 'claude-mcp-preferences.json'),
    defaultAutoConnect: !smoke, disabled: claudeDisabled,
    manager: claudeDisabled ? undefined : createClaudeConnection({ command: process.execPath, args: [bridge],
      env: { ELECTRON_RUN_AS_NODE: '1', DAYLIGHT_URL: origin } }),
    notify: status => { if (window && !window.isDestroyed()) window.webContents.send('daylight:claude-status-changed', status); } });
  updates = createDesktopUpdates({ app, shell, service, smoke, getWindow: () => window,
    getMcpStatus: () => ({ checking: mcp.getStatus().checking || claude.getStatus().checking }) });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!localUrl(details.url)) return callback({});
    callback({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
    } });
  });
  setupIpc();
  await createWindow();
  updates.start();
  if (!smoke) { void mcp.start(); void claude.start(); }
  if (!smoke && !app.isPackaged && process.argv.includes('--demo-weather')) {
    await require('./demo.cjs')({ window, origin, profileDir, root: app.getAppPath(), mcp });
  }
  if (smoke) await runSmoke();
}

app.on('window-all-closed', () => { /* Tray keeps the local service available. */ });
app.on('activate', showWindow);
// Each quit step is logged so a stuck exit shows where it stopped.
function logShutdown(step) {
  try {
    fs.mkdirSync(path.dirname(shutdownLogPath), { recursive: true });
    if (fs.existsSync(shutdownLogPath) && fs.statSync(shutdownLogPath).size > 256 * 1024) fs.rmSync(shutdownLogPath);
    fs.appendFileSync(shutdownLogPath, `${new Date().toISOString()} pid=${process.pid} ${step}\n`);
  } catch { /* Logging must never block quitting. */ }
}

app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  logShutdown('quit requested');
  setTimeout(() => {
    logShutdown(`still running after ${shutdownDeadlineMs} ms; forcing exit`);
    app.exit(0);
  }, shutdownDeadlineMs);
  updates?.dispose();
  const hadRun = Boolean(service?.scheduler.activeRun);
  Promise.resolve(service?.close()).catch(error => logShutdown(`local service close failed: ${error.message}`)).finally(async () => {
    logShutdown('local service closed');
    if (hadRun) await new Promise(resolve => setTimeout(resolve, 1000));
    desktopNotifications?.dispose();
    tray?.destroy();
    quitting = true;
    logShutdown('closing windows');
    app.quit();
  });
});
app.on('will-quit', () => logShutdown('windows closed'));
app.on('quit', (_event, code) => logShutdown(`quit (code ${code})`));

function secondInstance() {
  if (!shutdownStarted) { showWindow(); return; }
  // A launch during a stuck quit: finish the old process and start a fresh one.
  logShutdown('launched again while quitting; restarting');
  app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: process.argv.slice(1).filter(arg => arg !== '--hidden') });
  app.exit(0);
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', secondInstance);
  boot().catch(async error => {
    const message = error.code === 'EADDRINUSE'
      ? `本地端口 ${port} 已被占用。请先退出已运行的 Daylight 网页服务或其他占用该端口的程序，然后重新打开。`
      : `Daylight 启动失败：${error.message}`;
    writeSmoke({ ok: false, error: message });
    if (!smoke) dialog.showErrorBox('Daylight 无法启动', message);
    await service?.close().catch(() => {});
    quitting = true;
    app.exit(1);
  });
}
