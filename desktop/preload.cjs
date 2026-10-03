const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daylightDesktop', Object.freeze({
  claimStartup: () => ipcRenderer.invoke('daylight:claim-startup'),
  getInfo: () => ipcRenderer.invoke('daylight:get-info'),
  setTheme: theme => ipcRenderer.invoke('daylight:set-theme', theme),
  setAlwaysOnTop: enabled => ipcRenderer.invoke('daylight:set-always-on-top', enabled),
  setAutoLaunch: enabled => ipcRenderer.invoke('daylight:set-auto-launch', enabled),
  openDataFolder: () => ipcRenderer.invoke('daylight:open-data-folder'),
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
}));
