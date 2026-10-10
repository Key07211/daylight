'use strict';

const { createUpdateController } = require('./update-controller.cjs');
const RELEASES = 'https://github.com/Key07211/daylight/releases/latest';

function createDesktopUpdates({ app, shell, getWindow, service, getMcpStatus = () => ({}), smoke = false, updater }) {
  const mode = smoke || !app.isPackaged || process.platform !== 'win32' ? 'disabled'
    : process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installed';
  let editing = true;
  let preparing = false;
  let disposed = false;
  if (mode === 'installed') {
    updater ||= require('electron-updater').autoUpdater;
    updater.disableWebInstaller = true;
    updater.autoRunAppAfterInstall = true;
  }

  async function releaseInstall() {
    preparing = false;
    service.setUpdatePending(false);
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      await window.webContents.executeJavaScript('document.body.inert = false').catch(() => {});
    }
  }

  function getBlockers() {
    const reasons = [];
    if (editing) reasons.push('editing');
    if (service.scheduler.activeRun) reasons.push('running');
    if (getMcpStatus().checking) reasons.push('mcp');
    return reasons;
  }

  async function prepareInstall() {
    const blockers = getBlockers();
    if (blockers.length) return blockers;
    const window = getWindow();
    if (!window || window.isDestroyed()) return ['editing'];
    // This gate and the scheduler share one event loop: no new write or run can
    // enter after the final active-run check, including an in-flight HTTP body.
    preparing = true;
    service.setUpdatePending(true);
    const ready = await window.webContents.executeJavaScript(`(() => {
      if (document.documentElement.dataset.updateBusy !== 'false') return false;
      document.body.inert = true;
      return true;
    })()`);
    if (!ready) return ['editing'];
    // Connected bridges release the executable before NSIS replaces the files.
    while (service.pendingUpdateBridges > 0) {
      if (disposed) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (disposed) return false;
    return getBlockers().length ? getBlockers() : true;
  }

  const controller = createUpdateController({
    updater, mode, currentVersion: app.getVersion(), getBlockers, prepareInstall, releaseInstall,
    notify: status => {
      const window = getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('daylight:update-status-changed', status);
    },
    install: () => {
      if (disposed || !preparing || getBlockers().length) return false;
      // Silent NSIS installation + forced relaunch. No countdown/second prompt.
      updater.quitAndInstall(true, true);
      return true;
    },
    portableCheck: async () => {
      const response = await fetch('https://api.github.com/repos/Key07211/daylight/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Daylight' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('Release check failed');
      const release = await response.json();
      if (release.draft || release.prerelease) return null;
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
      const portable = release.assets?.some(asset => asset.name === `Daylight-Portable-${version}.zip`);
      return portable ? { version, releaseNotes: release.body } : null;
    },
    openPortable: () => shell.openExternal(RELEASES),
  });

  return {
    ...controller,
    isPreparing: () => preparing,
    setEditing(value) {
      if (typeof value !== 'boolean') throw new TypeError('Editing must be true or false.');
      editing = value;
      void controller.resume();
    },
    rendererLoading() { editing = true; },
    dispose() { disposed = true; controller.dispose(); },
  };
}

module.exports = { createDesktopUpdates };
