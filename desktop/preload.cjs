const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daylightDesktop', Object.freeze({
  claimStartup: () => ipcRenderer.invoke('daylight:claim-startup'),
  getInfo: () => ipcRenderer.invoke('daylight:get-info'),
  setTheme: theme => ipcRenderer.invoke('daylight:set-theme', theme),
  setAlwaysOnTop: enabled => ipcRenderer.invoke('daylight:set-always-on-top', enabled),
  setCloseAction: action => ipcRenderer.invoke('daylight:set-close-action', action),
  setAutoLaunch: enabled => ipcRenderer.invoke('daylight:set-auto-launch', enabled),
  openDataFolder: () => ipcRenderer.invoke('daylight:open-data-folder'),
  getNotificationStatus: () => ipcRenderer.invoke('daylight:notification-status'),
  testNotification: language => ipcRenderer.invoke('daylight:test-notification', language),
  openNotificationSettings: () => ipcRenderer.invoke('daylight:notification-settings'),
  onNotificationStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('A status callback is required.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('daylight:notification-status-changed', listener);
    return () => ipcRenderer.removeListener('daylight:notification-status-changed', listener);
  },
  installMcp: () => ipcRenderer.invoke('daylight:install-mcp'),
  getMcpStatus: () => ipcRenderer.invoke('daylight:mcp-status'),
  checkMcp: () => ipcRenderer.invoke('daylight:check-mcp'),
  setMcpAutoConnect: enabled => ipcRenderer.invoke('daylight:set-mcp-auto-connect', enabled),
  onMcpStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('A status callback is required.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('daylight:mcp-status-changed', listener);
    return () => ipcRenderer.removeListener('daylight:mcp-status-changed', listener);
  },
  connectClaude: () => ipcRenderer.invoke('daylight:connect-claude'),
  getClaudeStatus: () => ipcRenderer.invoke('daylight:claude-status'),
  checkClaude: () => ipcRenderer.invoke('daylight:check-claude'),
  setClaudeAutoConnect: enabled => ipcRenderer.invoke('daylight:set-claude-auto-connect', enabled),
  onClaudeStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('A status callback is required.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('daylight:claude-status-changed', listener);
    return () => ipcRenderer.removeListener('daylight:claude-status-changed', listener);
  },
  getUpdateStatus: () => ipcRenderer.invoke('daylight:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('daylight:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('daylight:download-update'),
  setUpdateEditing: editing => ipcRenderer.invoke('daylight:update-editing', editing),
  onUpdateStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('A status callback is required.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('daylight:update-status-changed', listener);
    return () => ipcRenderer.removeListener('daylight:update-status-changed', listener);
  },
}));
